/**
 * build.mjs — the two Metro operations the harness is built on.
 *
 * `buildNativeGraph` resolves + transforms the module graph and hands back the module paths, which
 * is what the resolution gate asserts over (`graph-gate.mjs`). `buildNativeBundle` goes one step
 * further and serialises a runnable bundle, which is what `run.mjs` executes.
 *
 * Both are ordinary async functions returning data — no process.exit, no console output — so a
 * caller can assert on the result instead of on a log line.
 */
import { createRequire } from 'node:module'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createNativeMetroConfig, repoRoot } from './config.cjs'

// Metro ships CJS with a `default` interop that ESM `import Metro from 'metro'` gets wrong under
// Node's CJS-ESM bridge (the named exports land on `.default`); `createRequire` sidesteps it.
const require = createRequire(import.meta.url)
const Metro = require('metro')

const here = path.dirname(fileURLToPath(import.meta.url))

/** Bundles land in node_modules/.cache — already ignored, and thrown away by a clean install. */
export const cacheDir = path.join(repoRoot, 'node_modules', '.cache', 'lmthing-metro')

/** The platforms the harness treats as "native". Both are built: fork selection is per-platform. */
export const NATIVE_PLATFORMS = ['ios', 'android']

/**
 * Resolve + transform the graph reachable from `entry`, without serialising a bundle.
 *
 * @returns {Promise<{modules: string[], entryPath: string}>} absolute module paths, sorted.
 */
export async function buildNativeGraph({ entry, platform = 'ios', mockNativeModules = false }) {
  const entryPath = path.resolve(here, entry)
  const config = createNativeMetroConfig({ mockNativeModules })
  const graph = await Metro.buildGraph(config, {
    entries: [entryPath],
    platform,
    dev: true,
    minify: false,
  })
  return { entryPath, modules: [...graph.dependencies.keys()].sort() }
}

/**
 * Build a runnable bundle for `entry` and write it under {@link cacheDir}.
 *
 * @returns {Promise<{bundlePath: string, bytes: number}>}
 */
export async function buildNativeBundle({ entry, platform = 'ios', mockNativeModules = true }) {
  const entryPath = path.resolve(here, entry)
  const config = createNativeMetroConfig({ mockNativeModules })
  const { code } = await Metro.runBuild(config, {
    entry: entryPath,
    platform,
    // `dev: true` keeps `__DEV__` invariants and readable frames — the harness wants the
    // assertion message, not a minified stack.
    dev: true,
    minify: false,
  })
  fs.mkdirSync(cacheDir, { recursive: true })
  const bundlePath = path.join(cacheDir, `${path.basename(entryPath).replace(/\.\w+$/, '')}.${platform}.js`)
  fs.writeFileSync(bundlePath, code)
  return { bundlePath, bytes: code.length }
}
