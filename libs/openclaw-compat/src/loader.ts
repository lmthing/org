/**
 * `loadPlugin` — reads a plugin directory's `package.json`
 * (`openclaw.extensions[0]`) and `openclaw.plugin.json` (`id`), transpiles +
 * evaluates the entry file, and calls its `register(api)`.
 *
 * Only the simple `definePluginEntry({ id, register })` shape is supported
 * (an entry whose default export is, or resolves to, `{ id, register }`).
 * A `defineBundledChannelEntry(...)`-style descriptor (identifiable by a
 * `plugin.specifier` field — OpenClaw's own bundled-channel packaging) is
 * detected and rejected with {@link UnsupportedCompatError}; loading those is
 * a later increment (see `../COMPAT.md`).
 *
 * The transpile step reuses the esbuild-transform-then-`new Function`-eval
 * approach from `@lmthing/cli`'s hook loader
 * (`libs/cli/src/app/hooks/loader.ts`) rather than a real module loader,
 * since plugin entries are plain `.ts` files outside any build pipeline.
 */

import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';

import { transform } from 'esbuild';

import {
  applyBundledChannelDescriptor,
  defineBundledChannelEntry,
  definePluginEntry,
  type BundledChannelDescriptor,
} from './plugin-sdk-shim.js';

/**
 * Builtin module shims, merged UNDER any explicit `moduleOverrides` (which
 * still win). They let a real plugin's `import { definePluginEntry } from
 * "openclaw/plugin-sdk/plugin-entry"` / `import { defineBundledChannelEntry }
 * from "openclaw/plugin-sdk/channel-entry-contract"` resolve to our shims even
 * for an as-installed `.openclaw-plugins/` plugin that passes no overrides —
 * this host has no npm-registry egress to resolve the real subpaths.
 */
const BUILTIN_SHIMS: Record<string, unknown> = {
  'openclaw/plugin-sdk/plugin-entry': { definePluginEntry },
  'openclaw/plugin-sdk/channel-entry-contract': { defineBundledChannelEntry },
};

/** The result of a successful {@link loadPlugin} call. */
export interface LoadPluginResult {
  /** The plugin id, from `openclaw.plugin.json#id`. */
  id: string;
}

/** Options accepted by {@link loadPlugin}. */
export interface LoadPluginOptions {
  /**
   * Module overrides keyed by the exact import specifier as written in the
   * entry's source (e.g. `"openclaw/plugin-sdk/plugin-entry"`,
   * `"./src/tavily-search-tool.js"`). When `shimRequire` sees a specifier in
   * this map it returns the override value directly as the module's exports
   * — no real resolution/`require` is attempted. Lets a vendored real entry's
   * imports resolve without installing the real packages (no npm-registry
   * egress needed). Falls back to a real `require` for anything not listed.
   */
  moduleOverrides?: Record<string, unknown>;
}

/**
 * Load the plugin at `dir` and call its `register(api)`.
 *
 * @param dir Absolute or cwd-relative path to the plugin's directory (must
 *   contain `package.json` + `openclaw.plugin.json`).
 * @param api The compat api object, e.g. from {@link createCompatApi}.
 * @param opts Optional {@link LoadPluginOptions} (e.g. `moduleOverrides`).
 */
export async function loadPlugin(dir: string, api: unknown, opts?: LoadPluginOptions): Promise<LoadPluginResult> {
  const absDir = resolve(dir);

  const pkg = (await readJson(join(absDir, 'package.json'))) as Record<string, unknown>;
  const manifest = (await readJson(join(absDir, 'openclaw.plugin.json'))) as Record<string, unknown>;

  const openclawMeta = pkg.openclaw as Record<string, unknown> | undefined;
  const extensions = openclawMeta?.extensions;
  if (!Array.isArray(extensions) || typeof extensions[0] !== 'string' || extensions[0].length === 0) {
    throw new Error(`[openclaw-compat] ${join(absDir, 'package.json')} is missing "openclaw.extensions[0]"`);
  }
  const entryFile = resolve(absDir, extensions[0]);

  const id = manifest.id;
  if (typeof id !== 'string' || id.length === 0) {
    throw new Error(`[openclaw-compat] ${join(absDir, 'openclaw.plugin.json')} is missing "id"`);
  }

  const mod = await importTsAsCjs(entryFile, opts?.moduleOverrides);
  const entry = (mod.default ?? mod) as Record<string, unknown> | undefined;

  // A `definePluginEntry`/`defineBundledChannelEntry` result (both go through
  // our shims → a `{ id, register }` object). Also covers hand-written entries.
  if (entry && typeof entry.register === 'function') {
    await (entry.register as (api: unknown) => unknown)(api);
    return { id };
  }

  // Fallback: a RAW bundled-channel descriptor (has `plugin.specifier` but no
  // `register` — e.g. built against the real SDK without our shim). Apply it
  // the same way `defineBundledChannelEntry`'s generated `register` would:
  // record the channel + run its webhook-mode `registerFull` hook. The
  // socket/native runtime behind `plugin.specifier` is NOT loaded (deferred —
  // Socket-Mode / warm-pod; see COMPAT.md).
  if (isBundledChannelDescriptor(entry)) {
    await applyBundledChannelDescriptor(entry as unknown as BundledChannelDescriptor, api);
    return { id };
  }

  throw new Error(
    `[openclaw-compat] plugin entry "${entryFile}" default export has no register(api) function ` +
      '(expected the definePluginEntry({ id, register }) or defineBundledChannelEntry({ id, plugin }) shape)',
  );
}

/** An entry "looks like" a bundled-channel descriptor when it carries `plugin.specifier`. */
function isBundledChannelDescriptor(entry: Record<string, unknown> | undefined): boolean {
  if (!entry || typeof entry !== 'object') return false;
  const plugin = (entry as Record<string, unknown>).plugin;
  return !!plugin && typeof plugin === 'object' && 'specifier' in (plugin as Record<string, unknown>);
}

async function readJson(file: string): Promise<unknown> {
  let raw: string;
  try {
    raw = await readFile(file, 'utf8');
  } catch (err) {
    throw new Error(`[openclaw-compat] failed to read ${file}: ${(err as Error).message}`);
  }
  try {
    return JSON.parse(raw);
  } catch (err) {
    throw new Error(`[openclaw-compat] failed to parse JSON at ${file}: ${(err as Error).message}`);
  }
}

/** Transpile a `.ts` entry file to CJS and evaluate it, returning its `module.exports`. */
async function importTsAsCjs(
  file: string,
  moduleOverrides?: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const source = await readFile(file, 'utf8');
  const { code } = await transform(source, {
    loader: 'ts',
    format: 'cjs',
    target: 'node18',
    sourcefile: file,
  });
  const moduleObj: { exports: Record<string, unknown> } = { exports: {} };
  // A real `require` rooted at the entry file, so incidental bare imports
  // (e.g. a real plugin's `require('openclaw/plugin-sdk/...')`) resolve
  // against the plugin's own node_modules — mirrors the cli hook loader.
  const localRequire = createRequire(file);
  const shimRequire = (id: string): unknown => {
    if (moduleOverrides && Object.prototype.hasOwnProperty.call(moduleOverrides, id)) {
      return moduleOverrides[id];
    }
    if (Object.prototype.hasOwnProperty.call(BUILTIN_SHIMS, id)) {
      return BUILTIN_SHIMS[id];
    }
    return localRequire(id);
  };
  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  const fn = new Function('module', 'exports', 'require', '__filename', '__dirname', code);
  fn(moduleObj, moduleObj.exports, shimRequire, file, dirname(file));
  return moduleObj.exports;
}
