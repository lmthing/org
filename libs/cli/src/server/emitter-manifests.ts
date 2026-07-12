/**
 * Scan a project's `events/*.ts` **emitter defs** — the PRODUCER side of the
 * unified event pipeline (symmetric with `app/hooks/loader.ts`, the consumer
 * side). A def default-exports a typed {@link EmitterDef} (`webhook` | `cron` |
 * `db` | `internal`); this module discovers them across two scopes and returns
 * source-qualified, validated, containment-checked descriptors that later steps
 * (S5 webhook dispatch, S6 cron/db, S8 internal signals) bind to.
 *
 * Two scan roots per project:
 *   - PROJECT scope — `<root>/<projectId>/events/*.ts` (user trust domain).
 *   - SPACE  scopes — `<root>/<projectId>/spaces/<spaceId>/events/*.ts` (one
 *     scope per installed space; STORE-downloaded code).
 *
 * Because a def carries real code (`emit`, plus arbitrary top-level module code),
 * extraction is **worker-isolated**, exactly like an api handler: we transpile
 * the file (esbuild) and `import` it inside the crash-bounded worker
 * (`app/api/worker.ts`'s generic `loadModule` job), with a wall-clock timeout.
 * ONLY the def's DATA fields are serialized back out — `emit` is never extracted
 * (a hostile top-level infinite loop / fs probe is contained in the worker and
 * killed on timeout; later steps re-load the def from `file` to run `emit`, also
 * worker-isolated). This is the same security posture as the pod itself: store
 * code never runs on the main thread.
 *
 * Validation order per def, at scan time, BEFORE any def is honored:
 *   1. {@link validateEmitterDef} (core) — discriminated shape, verify union,
 *      cron schedule, path regex, payload typeStrings.
 *   2. Env-ref containment — a SPACE def's descriptor-style env refs (`secretEnv`,
 *      a `hub-challenge` `verifyTokenEnv`) must sit inside the space's
 *      `INTEGRATION_<ID>_` namespace (same positive-containment guard as
 *      `integration-manifests.ts`, protecting system/other-space secrets). The
 *      `builtin` verify shorthand names no envs → exempt. PROJECT defs are the
 *      user's own trust domain → no namespace restriction, but every env ref is
 *      recorded on the scope for audit/UI.
 *   3. Per-scope duplicate-event guard — `collectDeclaredEvents` throws if two
 *      defs in one scope declare the same event name; we FAIL THE WHOLE SCOPE
 *      (drop all its defs) with a warn, so the authoring error is unmissable.
 * A def failing 1 or 2 is dropped with a `console.warn` naming the file + reason
 * (mirrors `integration-manifests.ts`); the scan never throws.
 *
 * Cache: keyed per `<root>/<projectId>`, its signature covering every
 * `events/*.ts` file's mtime AND the set of files across all scopes — a plain
 * package.json watch (what `integration-manifests.ts` uses) is insufficient
 * because the emitter code lives in the `.ts` files themselves. A new/removed/
 * edited def invalidates without a restart.
 */

import { readdir, readFile, stat } from 'node:fs/promises';
import { readdirSync, statSync } from 'node:fs';
import { basename, join } from 'node:path';
import { Worker as NodeWorker } from 'node:worker_threads';

import { transform } from 'esbuild';
import {
  validateEmitterDef,
  collectDeclaredEvents,
  type ChallengeSpec,
  type CronEmitterDef,
  type DbEmitterDef,
  type EmitsSchema,
  type EmitterDef,
  type InternalEmitterDef,
  type LoadedEmitter,
  type WebhookEmitterDef,
} from '@lmthing/core';

import { bundledWorkerSource } from '../app/api/runtime.js';
import type { LoadModuleJob, WorkerToMain } from '../app/api/protocol.js';
import { namespacePrefix } from './integration-manifests.js';

/** A def's DATA fields — the {@link EmitterDef} union minus its `emit` method
 *  (functions are never extracted; later steps re-run `emit` from {@link
 *  ExtractedEmitterDef.file}). */
export type SerializedEmitterDef =
  | Omit<WebhookEmitterDef, 'emit'>
  | Omit<CronEmitterDef, 'emit'>
  | Omit<DbEmitterDef, 'emit'>
  | Omit<InternalEmitterDef, 'emit'>;

/** A discovered, validated, containment-checked emitter def. */
export interface ExtractedEmitterDef {
  /** The filename basename (`slack-inbound`) — stable id, unique per scope. */
  name: string;
  /** The owning scope id: `'project'` or the `<spaceId>`. Prefix the event
   *  name with this + `/` for the source-qualified address (`<scope>/<event>`). */
  scope: string;
  /** Absolute path to the def's `events/*.ts` file. Later steps re-load it to
   *  run `emit` worker-isolated (never extracted here). */
  file: string;
  /** The def's DATA fields (emit elided), normalized by {@link validateEmitterDef}. */
  def: SerializedEmitterDef;
}

/** One scan scope (`'project'` or a `<spaceId>`). */
export interface EmitterScope {
  /** The honored defs of this scope, in filename order. */
  defs: ExtractedEmitterDef[];
  /** The scope's declared-event contract (union of every honored def's `emits`;
   *  duplicate event names across the scope fail the scope). Address an event
   *  as `<scope>/<event>` (`'project/order.created'`, `'integration-slack/message.posted'`). */
  declaredEvents: EmitsSchema;
  /** Every pod env var the honored defs reference (audit/UI; contained for
   *  space scopes, recorded-only for the project scope). */
  envRefs: string[];
}

/** The result of {@link scanEmitterDefs}: one entry per scope that has an
 *  `events/` dir with ≥1 `.ts` file. */
export interface EmitterScanResult {
  /** scope id (`'project'` | `<spaceId>`) → its defs + declared events + env refs. */
  scopes: Record<string, EmitterScope>;
}

/** The default wall-clock ceiling for a single worker extraction (env-tunable
 *  via `LMTHING_EMITTER_SCAN_TIMEOUT_MS`). A hostile top-level loop is killed
 *  at this bound. */
const DEFAULT_TIMEOUT_MS = 5000;

/** The def DATA fields to serialize out of the worker (every possible field
 *  across the four kinds; `emit` deliberately omitted). */
const DATA_FIELDS = [
  'type',
  'path',
  'verify',
  'secretEnv',
  'challenge',
  'every',
  'daily',
  'connections',
  'on',
  'emits',
] as const;

const EMITTER_FILE_RE = /^([A-Za-z0-9_-]+)\.ts$/;

/**
 * The subset of a `node:worker_threads` Worker we use. Typed locally because
 * the shared tsconfig's DOM lib defines a **global** `Worker` that shadows the
 * node class's `EventEmitter` `.on` here (same reason `app/api/runtime.ts` does).
 */
interface WorkerHandle {
  on(event: 'message', listener: (msg: WorkerToMain) => void): void;
  on(event: 'error', listener: (err: Error) => void): void;
  on(event: 'exit', listener: (code: number) => void): void;
  postMessage(value: unknown): void;
  terminate(): Promise<number>;
}

// ── Cache ───────────────────────────────────────────────────────────────────

interface CacheEntry {
  signature: string;
  value: Promise<EmitterScanResult>;
}
const cache = new Map<string, CacheEntry>();

/** The events dirs to scan for a project: `[scopeId, absoluteEventsDir]` pairs. */
function eventsDirs(projectDir: string): Array<[scope: string, dir: string]> {
  const dirs: Array<[string, string]> = [['project', join(projectDir, 'events')]];
  let spaces: import('node:fs').Dirent[];
  try {
    spaces = readdirSync(join(projectDir, 'spaces'), { withFileTypes: true });
  } catch {
    return dirs; // no spaces/ dir — project scope only
  }
  for (const d of spaces) {
    if (d.isDirectory()) dirs.push([d.name, join(projectDir, 'spaces', d.name, 'events')]);
  }
  return dirs;
}

/**
 * Change signature covering EVERY `events/*.ts` file's mtime + the set of files
 * across all scopes. Unlike `integration-manifests.ts` (package.json mtime
 * only), the emitter CODE lives in these `.ts` files — so a new/removed/edited
 * def must bump the signature. Sync (called on the hot path); missing dirs skip.
 */
function signature(projectDir: string): string {
  const parts: string[] = [];
  for (const [scope, dir] of eventsDirs(projectDir)) {
    let files: import('node:fs').Dirent[];
    try {
      files = readdirSync(dir, { withFileTypes: true });
    } catch {
      continue; // no events/ dir in this scope
    }
    for (const f of files) {
      if (!f.isFile() || !EMITTER_FILE_RE.test(f.name)) continue;
      try {
        const st = statSync(join(dir, f.name));
        parts.push(`${scope}/${f.name}:${st.mtimeMs}`);
      } catch {
        /* raced away between readdir and stat — treat as absent */
      }
    }
  }
  return parts.sort().join('|');
}

// ── Env-ref containment (mirrors integration-manifests.ts, for defs) ─────────

/** The pod env vars a def references via descriptor-style fields — a webhook's
 *  `secretEnv` + a `hub-challenge` `verifyTokenEnv`. The `builtin` verify
 *  shorthand and non-webhook kinds name no envs (empty). */
function emitterEnvRefs(def: SerializedEmitterDef): string[] {
  const refs: string[] = [];
  if (def.type === 'webhook') {
    if (def.secretEnv) refs.push(def.secretEnv);
    const ch = def.challenge as ChallengeSpec | undefined;
    if (ch && ch.type === 'hub-challenge' && ch.verifyTokenEnv) refs.push(ch.verifyTokenEnv);
  }
  return refs;
}

/**
 * Positive env containment for a SPACE def: every env ref must sit inside the
 * space's `INTEGRATION_<ID>_` namespace (the same guard `integration-manifests.ts`
 * applies to descriptors — it protects system-injected secrets and OTHER
 * spaces' tokens, and needs no denylist). A def naming a secret can therefore
 * only live in an `integration-*` space; the `builtin` shorthand (no env refs)
 * is exempt and works in any space. Returns true when contained. Failure warns.
 */
function envRefsContained(spaceId: string, name: string, refs: string[]): boolean {
  if (refs.length === 0) return true;
  const prefix = namespacePrefix(spaceId);
  const bad = prefix === null ? refs : refs.filter((r) => !r.startsWith(prefix));
  if (bad.length > 0) {
    console.warn(
      `[emitter-manifests] dropping def "${name}" in space "${spaceId}": ` +
        (prefix === null
          ? `only an integration-* space may declare secret env refs (got ${bad.join(', ')})`
          : `env refs outside its namespace (${prefix}*): ${bad.join(', ')}`),
    );
    return false;
  }
  return true;
}

// ── Worker-isolated extraction ───────────────────────────────────────────────

/** The outcome of extracting one def in the worker. */
type ExtractResult = { ok: true; data: Record<string, unknown> } | { ok: false; reason: string };

/**
 * Run a def's transpiled CJS in the crash-bounded worker and return ONLY its
 * default export's DATA fields. Bounded by `timeoutMs` — a hostile top-level
 * loop never returns a `result`, so the timer terminates the worker and we drop
 * the def. Any worker `error`/early `exit` (a def that `process.exit()`s or
 * segfaults) is contained the same way. Never throws.
 */
async function extractInWorker(code: string, timeoutMs: number): Promise<ExtractResult> {
  const source = await bundledWorkerSource();
  const job: LoadModuleJob = { loadModule: true, code, pick: [...DATA_FIELDS] };
  return new Promise<ExtractResult>((resolve) => {
    let settled = false;
    let worker: WorkerHandle | undefined;
    const settle = (r: ExtractResult): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      void worker?.terminate();
      resolve(r);
    };
    const timer = setTimeout(
      () => settle({ ok: false, reason: `extraction timed out after ${timeoutMs}ms (contained + terminated)` }),
      timeoutMs,
    );
    timer.unref?.();
    try {
      worker = new NodeWorker(source, { eval: true, workerData: job }) as unknown as WorkerHandle;
    } catch (err) {
      settle({ ok: false, reason: err instanceof Error ? err.message : String(err) });
      return;
    }
    worker.on('message', (msg: WorkerToMain) => {
      if (msg.type === 'result') settle({ ok: true, data: (msg.value ?? {}) as Record<string, unknown> });
      else if (msg.type === 'error') settle({ ok: false, reason: msg.message ?? 'module load failed' });
    });
    worker.on('error', (err) => settle({ ok: false, reason: err.message }));
    worker.on('exit', (exitCode) => settle({ ok: false, reason: `worker exited early (code ${exitCode})` }));
  });
}

/** Transpile a def `.ts` → CJS (esbuild, same toolchain the api/hook loaders
 *  use). Cached by file mtime; the scope cache already avoids repeat scans, this
 *  just skips a re-transpile within one. */
const transpileCache = new Map<string, { mtimeMs: number; code: string }>();
async function transpile(file: string): Promise<string> {
  const { mtimeMs } = await stat(file);
  const hit = transpileCache.get(file);
  if (hit && hit.mtimeMs === mtimeMs) return hit.code;
  const source = await readFile(file, 'utf8');
  const { code } = await transform(source, { loader: 'ts', format: 'cjs', target: 'node18', sourcefile: file });
  transpileCache.set(file, { mtimeMs, code });
  return code;
}

/** A no-op stand-in so {@link validateEmitterDef} (which requires an `emit`
 *  function) can validate the emit-less extracted data. Never invoked. */
const NOOP_EMIT = (): [] => [];

/**
 * Extract + validate + contain a single def file. Returns the honored
 * {@link ExtractedEmitterDef}, or `undefined` (dropped, already warned).
 */
async function loadDef(scope: string, file: string, timeoutMs: number): Promise<ExtractedEmitterDef | undefined> {
  const name = basename(file, '.ts');
  let code: string;
  try {
    code = await transpile(file);
  } catch (err) {
    console.warn(`[emitter-manifests] dropping "${file}": transpile failed — ${err instanceof Error ? err.message : String(err)}`);
    return undefined;
  }

  const extracted = await extractInWorker(code, timeoutMs);
  if (!extracted.ok) {
    console.warn(`[emitter-manifests] dropping "${file}": ${extracted.reason}`);
    return undefined;
  }

  // 1. Shape/verify/schedule/payload validation (core). The data has no `emit`
  //    (never extracted) — splice a no-op so the validator's function check
  //    passes; every other check is on the data fields.
  let validated: EmitterDef;
  try {
    validated = validateEmitterDef({ ...extracted.data, emit: NOOP_EMIT }, `${file} (def "${name}")`);
  } catch (err) {
    console.warn(`[emitter-manifests] dropping "${file}": ${err instanceof Error ? err.message : String(err)}`);
    return undefined;
  }
  const { emit: _emit, ...def } = validated;
  const serialized = def as SerializedEmitterDef;

  // 2. Env-ref containment (space scopes only; project defs are user-trusted).
  if (scope !== 'project' && !envRefsContained(scope, name, emitterEnvRefs(serialized))) {
    return undefined;
  }

  return { name, scope, file, def: serialized };
}

/** Load one scope's `events/` dir into an {@link EmitterScope} (or `undefined`
 *  when the dir has no def files). Applies the per-scope duplicate-event guard
 *  (fail-the-scope-with-warn). */
async function loadScope(scope: string, dir: string, timeoutMs: number): Promise<EmitterScope | undefined> {
  let entries: import('node:fs').Dirent[];
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return undefined; // no events/ dir in this scope
  }
  const files = entries
    .filter((e) => e.isFile() && EMITTER_FILE_RE.test(e.name))
    .map((e) => e.name)
    .sort(); // deterministic order — a duplicate event names the LATER file
  if (files.length === 0) return undefined;

  const allDefs: ExtractedEmitterDef[] = [];
  for (const f of files) {
    const loaded = await loadDef(scope, join(dir, f), timeoutMs);
    if (loaded) allDefs.push(loaded);
  }

  // 3. Per-scope duplicate-event guard — ISOLATED, not scope-fatal. When two defs
  //    declare the same event, keep the FIRST (deterministic sorted order) and DROP
  //    only the later offender with a warn, instead of dropping EVERY emitter in the
  //    scope. Failing the whole scope meant one redundant def (e.g. the authoring agent
  //    writing a second `tip.added` db emitter) silently disabled ALL of a project's
  //    emitters — so `project/<event>` never fired and every agent-trigger hook on it
  //    went dead. Found live in scenario 01 (the summary-on-tip.added path). The kept
  //    def's emit still runs; the dropped def's would only have re-emitted the same
  //    event name. (`collectDeclaredEvents` still throws on the survivors as a backstop.)
  const owned = new Map<string, string>(); // event name → owning def name
  const defs: ExtractedEmitterDef[] = [];
  for (const d of allDefs) {
    const collision = Object.keys(d.def.emits).find((ev) => owned.has(ev));
    if (collision !== undefined) {
      console.warn(
        `[emitter-manifests] scope "${scope}" in "${dir}": dropping def "${d.name}" — it re-declares event ` +
          `"${collision}" already declared by "${owned.get(collision)}" (kept). Event names must be unique per scope.`,
      );
      continue;
    }
    for (const ev of Object.keys(d.def.emits)) owned.set(ev, d.name);
    defs.push(d);
  }

  const loadedEmitters: LoadedEmitter[] = defs.map((d) => ({ name: d.name, def: { ...d.def, emit: NOOP_EMIT } as EmitterDef }));
  let declaredEvents: EmitsSchema;
  try {
    declaredEvents = collectDeclaredEvents(loadedEmitters);
  } catch (err) {
    // Backstop — should be unreachable now that duplicates are pre-dropped above.
    console.warn(
      `[emitter-manifests] failing scope "${scope}" in "${dir}": ${err instanceof Error ? err.message : String(err)}`,
    );
    return { defs: [], declaredEvents: {}, envRefs: [] };
  }

  const envRefs = [...new Set(defs.flatMap((d) => emitterEnvRefs(d.def)))].sort();
  return { defs, declaredEvents, envRefs };
}

/** The uncached scan across all scopes of a project. */
async function scan(projectDir: string): Promise<EmitterScanResult> {
  const timeoutMs = Number(process.env['LMTHING_EMITTER_SCAN_TIMEOUT_MS']) || DEFAULT_TIMEOUT_MS;
  const scopes: Record<string, EmitterScope> = {};
  for (const [scope, dir] of eventsDirs(projectDir)) {
    const loaded = await loadScope(scope, dir, timeoutMs);
    if (loaded) scopes[scope] = loaded;
  }
  return { scopes };
}

/**
 * Scan every `events/*.ts` emitter def a project declares — its own `events/`
 * (PROJECT scope) plus each installed space's `spaces/<id>/events/` (SPACE
 * scopes). Each def is worker-extracted (data-only, timeout-bounded),
 * `validateEmitterDef`-checked, env-containment-checked (space scopes), and
 * dropped-with-warn on any failure; a scope with duplicate event names is
 * failed whole. Cached per `<root>/<projectId>`, invalidated when any
 * `events/*.ts` file is added/removed/edited. Never throws.
 *
 * Address a discovered event as `<scope>/<event>` — `'project/order.created'`
 * or `'integration-slack/message.posted'`.
 */
export function scanEmitterDefs(root: string, projectId: string): Promise<EmitterScanResult> {
  const projectDir = join(root, projectId);
  const key = `${root}\0${projectId}`;
  const sig = signature(projectDir);
  const hit = cache.get(key);
  if (hit && hit.signature === sig) return hit.value;
  const value = scan(projectDir);
  cache.set(key, { signature: sig, value });
  return value;
}

/** Test seam — drop the memoised scans (and transpile cache). */
export function clearEmitterDefCache(): void {
  cache.clear();
  transpileCache.clear();
}
