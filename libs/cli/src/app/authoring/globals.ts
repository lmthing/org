/**
 * LIVE-PROJECT **app-authoring globals** — the host-side (CLI) impls behind the
 * `AppGlobalImpls` `writeProject*` writer family (`libs/core/src/exec/app-globals.ts`).
 *
 * These are pure, SYNCHRONOUS, validated file-writers into ONE fixed live-project
 * root (`.lmthing/<projectId>/`): a project's own `database/ pages/ api/ hooks/
 * events/ functions/ components/` dirs. A writer here does exactly one thing:
 * validate the input, write ONE file (creating its parent dirs), fire the
 * project's republish/re-derive side effect, and return `{ ok, error? }` — never
 * a bulk delete. The old STORE-CATALOG authoring engine (`createAppAuthoringGlobals`,
 * which templated `store/projects/<id>/`) has been removed: THING now creates a
 * LIVE project and delegates the build INTO it (see `SessionManager` `resolveBuildTarget`).
 *
 * Core only INJECTS these onto a VM for an agent holding the matching authoring
 * capability (`hooks:write` for the writers here); THING and ordinary agents hold
 * none, so it is harmless to always construct and pass this object through
 * `appGlobals` — it is simply never exposed to a capability-less agent.
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { runProjectAppCheck } from '../build/check.js';
import type { AppCheckResult } from '../build/check.js';
import { dirname, join, resolve, sep } from 'node:path';
import { transformSync } from 'esbuild';
import { validateTableSchema, type TableSchema } from '@lmthing/core';
import {
  LintError,
  apiCallSites,
  apiHandlerTypingError,
  braceBody,
  existingApiNames,
  lintApiHandler,
  lintComponentSource,
  lintHookSource,
  lintPageSource,
  topLevelKeys,
} from './lint.js';
import { saveTypecheckError } from './save-typecheck.js';

/** Throw a {@link LintError} when a lint check returned a message, so it surfaces to the model as a
 *  retryable error (like a typecheck failure) instead of a `{ ok:false }` a node might ignore. Each
 *  writer's `catch` re-throws `LintError` (see below) so only genuine fs/host faults become `{ok:false}`. */
function throwLint(msg: string | null): void {
  if (msg) throw new LintError(msg);
}

/**
 * Reject source that does not PARSE before it lands on disk. A live-project hook/event/api/page
 * write goes straight into the running project — an unparseable file (e.g. a model that emitted
 * literal `\n` escape sequences instead of newlines, so `hooks/<slug>.ts` is one line the loader
 * chokes on with `Syntax error "n"`) silently breaks the whole automation pipeline and can
 * destabilize the pod on the next load. Validating here turns that into an immediate `{ ok:false }`
 * the authoring agent SEES and retries — the same contract `writeProjectTable` already has via
 * `validateTableSchema`. Syntax-only (esbuild transform); undefined-identifier errors are a
 * typecheck concern, not a parse one. Found live in scenario 05 (every automator-authored hook
 * written with literal `\n`).
 */
function assertSourceParses(src: string, loader: 'ts' | 'tsx'): void {
  try {
    transformSync(src, { loader, format: 'esm', logLevel: 'silent' });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new Error(`source failed to parse (write rejected — fix and retry): ${msg.split('\n')[0]}`);
  }
}

/**
 * The API routes a page source actually FETCHES — every `useApi('x')` / `useApiMutation('x')` /
 * `apiCall('x')` whose route is a literal first argument. This is the page's data: a page that
 * fetches nothing renders nothing (a `@app/runtime` page has no other way to reach the db).
 */
function fetchedRoutes(src: string): string[] {
  return [...new Set(apiCallSites(src).map((s) => s.name))];
}

/**
 * Guard a page OVERWRITE that would drop the page's data. Returns an error message when
 * `file` already exists, already fetches ≥1 API route, and `src` fetches none of them —
 * i.e. the replacement deletes every section the user could see. Returns `undefined`
 * (allowed) for a new page, for a page that fetched nothing anyway, or for a rewrite that
 * keeps at least one of the routes it had (a genuine edit/refactor, not a wipe).
 */
function wouldDropData(file: string, src: string): string | undefined {
  if (!existsSync(file)) return undefined;
  let before: string;
  try {
    before = readFileSync(file, 'utf8');
  } catch {
    return undefined;
  }
  const had = fetchedRoutes(before);
  if (had.length === 0) return undefined;
  const now = fetchedRoutes(src);
  if (had.some((r) => now.includes(r))) return undefined;
  const rel = file.split(`${sep}pages${sep}`).pop() ?? file;
  return (
    `refusing to overwrite pages/${rel}: the page you are replacing fetches ${had.join(', ')} and the ` +
    `new source fetches ${now.length ? now.join(', ') : 'nothing'} — this DELETES the section(s) the user ` +
    `already has (they open the app to an empty page). Read it first — readProjectFile('pages/${rel}').content — ` +
    `and EXTEND it (keep its existing sections and ADD yours). Pass { replace: true } only if the user ` +
    `explicitly asked you to remove those sections.`
  );
}

/** Project ids and hook slugs are a lowercase kebab-slug: letters/digits/hyphen,
 *  must start with a letter. No dots, no slashes — traversal is structurally
 *  impossible in a value that matches this. */
const SLUG_RE = /^[a-z][a-z0-9-]*$/;

/** Table names are snake_case: letters/digits/UNDERSCORE, starting with a letter.
 *  Table names are used verbatim in `CREATE TABLE <name>` (unquoted), so hyphens
 *  are disallowed (they would need quoting) but underscores — the universal db
 *  convention every `database/*.json` uses (`feed_items`, `raw_items`) — are
 *  required. Still traversal-safe (no dots/slashes). */
const TABLE_NAME_RE = /^[a-z][a-z0-9_]*$/;

/** Function names are JS identifiers (camelCase like `slackPostMessage`), not
 *  kebab-slugs — the file basename becomes the function's callable name. Still
 *  traversal-safe (no dots/slashes). */
const FUNCTION_NAME_RE = /^[a-zA-Z_][a-zA-Z0-9_]*$/;

/** Component names are PascalCase (`TripCard`, `FlightRow`) — the file basename is
 *  `<Name>.tsx` and the name is what a page imports/renders. Traversal-safe. */
const COMPONENT_NAME_RE = /^[A-Z][A-Za-z0-9]*$/;

/** A single page/api path segment: letters/digits/hyphen/underscore, optionally
 *  wrapped in `[...]` for a dynamic route segment (e.g. `[id]`). */
const SEGMENT_RE = /^\[?[a-zA-Z0-9_-]+\]?$/;

const METHODS = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']);

function assertSlug(kind: string, value: string): void {
  if (!SLUG_RE.test(value)) {
    throw new Error(`${kind} "${value}" is not a valid slug (expected /${SLUG_RE.source}/)`);
  }
}

/** Table names are snake_case (underscores), unlike kebab-case ids/hook slugs. */
function assertTableName(value: string): void {
  if (!TABLE_NAME_RE.test(value)) {
    throw new Error(`table name "${value}" is not a valid snake_case name (expected /${TABLE_NAME_RE.source}/)`);
  }
}

/** Validate a `/`-separated path made of {@link SEGMENT_RE} segments (rejects
 *  empty segments, `..`, and anything else that isn't a plain path/dynamic
 *  segment) and return the normalized (leading-slash-stripped) path. */
function assertPathSegments(kind: string, route: string): string {
  let r = route.trim();
  if (r.startsWith('/')) r = r.slice(1);
  const segments = r.split('/');
  if (segments.length === 0 || segments.some((s) => s.length === 0)) {
    throw new Error(`${kind} "${route}" has an empty path segment`);
  }
  for (const s of segments) {
    if (s === '..' || s === '.' || !SEGMENT_RE.test(s)) {
      throw new Error(`${kind} "${route}" has an invalid path segment "${s}"`);
    }
  }
  return segments.join('/');
}

/** Resolve `relPath` under `root`, throwing if the resolved path escapes `root`
 *  (defense-in-depth traversal guard, on top of the segment validation above). */
function safeResolve(root: string, relPath: string): string {
  const resolvedRoot = resolve(root);
  const target = resolve(resolvedRoot, relPath);
  if (target !== resolvedRoot && !target.startsWith(resolvedRoot + sep)) {
    throw new Error(`path traversal rejected: "${relPath}"`);
  }
  return target;
}

/** Write `contents` to `absPath`, creating parent dirs as needed. */
function writeFile(absPath: string, contents: string): void {
  mkdirSync(dirname(absPath), { recursive: true });
  writeFileSync(absPath, contents, 'utf8');
}

/** The plan-S11 LIVE-PROJECT authoring writers — the `hooks:write`-gated globals that
 *  the automator (event hooks + emitter defs) and engineer (project functions) call. */
export interface ProjectAuthoringGlobals {
  /** Write `<projectRoot>/hooks/<slug>.ts` (an event/cron hook def). */
  writeProjectHook: (slug: string, src: string) => { ok: boolean; error?: string };
  /** Write `<projectRoot>/events/<name>.ts` (an emitter def). */
  writeProjectEvent: (name: string, src: string) => { ok: boolean; error?: string };
  /** Write `<projectRoot>/functions/<name>.ts` (a project function). */
  writeProjectFunction: (name: string, src: string) => { ok: boolean; error?: string };
  /** Write `<projectRoot>/database/<name>.json` (a table schema) — the LIVE-project
   *  counterpart of the catalog's `writeTableSchema`. Optionally SEED initial `rows` at
   *  the same time (host-side insert after the db re-derives), so KNOWN data the user
   *  gave you to "move into the app" lands in one authoring pass — the `db` global is not
   *  injected until a table already exists, so an agent could not otherwise insert into a
   *  table it just created. */
  writeProjectTable: (name: string, schema: unknown, rows?: unknown[]) => { ok: boolean; error?: string };
  /** Write `<projectRoot>/pages/<route>.tsx` (a React page) — the LIVE-project
   *  counterpart of the catalog's `writePage`. */
  writeProjectPage: (route: string, src: string, opts?: { replace?: boolean }) => { ok: boolean; error?: string };
  /** Write `<projectRoot>/components/<Name>.tsx` (a shared React component a page imports).
   *  Name is PascalCase. There is no space-rooted fs writer for this — the typed writer IS
   *  the surface, so an app can gain shared components without any generic filesystem access. */
  writeProjectComponent: (name: string, src: string) => { ok: boolean; error?: string };
  /** Write `<projectRoot>/api/<path>/<METHOD>.ts` (a typed API handler) — the
   *  LIVE-project counterpart of the catalog's `writeApi`. */
  writeProjectApi: (route: string, src: string) => { ok: boolean; error?: string };
  /** List the files under `<projectRoot>/<dir>` (e.g. 'database', 'hooks', 'events') — the
   *  read-side twin of the writers. Project-rooted (NOT the space dir), so a delegated
   *  system-space agent can see the PROJECT's contents. Returns `entries: []` for a missing dir. */
  listProjectDir: (dir: string) => { ok: boolean; entries: string[]; error?: string };
  /** Read a project file's text (`<projectRoot>/<path>`). Project-rooted; the read twin of the
   *  writers, for inspecting an existing table schema / page / hook before editing it. */
  readProjectFile: (path: string) => { ok: boolean; content: string; error?: string };
  /** Typecheck + bundle the project app, returning the SAME structured result as the agent-facing
   *  `buildApp()` global (which resolves to the very same {@link runProjectAppCheck}).
   *
   *  This exists so a tasklist **code node** can gate a build. `buildApp()` is a sandbox yield, so
   *  it is reachable only from a model turn — which meant every build gate had to be ~50 lines of
   *  scanning TypeScript re-emitted by the model on each run. In one real scenario run that
   *  accounted for 35% of all errors (`'gateErrors' is not defined` cascades), and a gate that
   *  fails to execute contributes no findings, so the pipeline reads its empty result as "clean".
   *  Exposing it host-side lets the gate be deterministic. */
  buildProjectApp: () => Promise<AppCheckResult>;
  /** Write a GENERATED type-declaration file under the project root — narrowly scoped to
   *  `types/*.d.ts`, and refusing `types/generated.d.ts`.
   *
   *  Every other artifact goes through a TYPED writer that validates its contract at write time,
   *  which is the whole design (`lint.ts`); a general-purpose file writer would route around that.
   *  But the contract `emit_types` produces from the plan is not an artifact any of them accept —
   *  `writeProjectComponent` throws a LintError for source with no default-exported React
   *  component, and a throw in a code node aborts the tasklist. So the escape hatch exists, and is
   *  kept as small as the one job requires. */
  writeProjectFile: (path: string, contents: string) => { ok: boolean; error?: string };
  /** Invoke one of the PROJECT'S OWN api endpoints by its `export const name`, returning the real
   *  `{ status, body }` the browser would get — the same `ApiRuntime` the served app and hooks enter.
   *
   *  Nothing in the appbuilder pipeline ever RAN a generated endpoint, so a handler returning
   *  structurally-valid zeros (reading a column that was never populated) passed typecheck, esbuild
   *  and every static scan; two shipped scenario builds reported `built: true` and then 500'd or
   *  rendered $0 over a populated db. `smoke_endpoints` uses this to probe each endpoint with valid,
   *  wrong-typed and missing-param input.
   *
   *  Deliberately NOT the agent's `api:call` capability, whose `allow` list is required and literal
   *  (`libs/core/src/spaces/capabilities.ts` — there is no "call anything"): the endpoint names are
   *  GENERATED by the same run, so no static allowlist can name them. Scoping comes from the runtime
   *  instead — it can only dispatch this project's own `api/` handlers.
   *
   *  Absent when the project has no `api/` runtime; `ctx.callProjectApi` is then undefined. */
  callProjectApi?: (name: string, input?: unknown) => Promise<{ status: number; body: unknown }>;
}

/**
 * Build the LIVE-PROJECT authoring writers (plan S11). Unlike the now-removed
 * store-catalog authoring engine — which targeted `store/projects/<id>/` catalog
 * TEMPLATES and carried a mutable createProject/selectProject "current app" — these
 * are bound to ONE fixed live project root (`<lmthingRoot>/<projectId>`) and write
 * directly into the running project's `hooks/`, `events/`, and `functions/` dirs.
 *
 * After a successful write each calls `republish` (fire-and-forget — the writers are
 * SYNCHRONOUS host globals, so they cannot await the async re-publish) so the new
 * event hook / emitter def / crontab entry goes live WITHOUT a pod restart. The write
 * itself has already landed on disk when the writer returns `{ ok: true }`; the
 * republish only re-derives the pod's published artifacts (webhook manifest + crontab
 * + emitter scan cache) from that source.
 *
 * Path safety reuses the same slug/name validation + `safeResolve` traversal guard as
 * the catalog writers (names are a kebab-slug — no dots, no slashes — and the resolved
 * path must stay under the project root).
 */
/** The only paths `writeProjectFile` will land — a generated `.d.ts` under `types/`. */
const ALLOWED_GENERATED_FILE = /^types\/[A-Za-z0-9_.-]+\.d\.ts$/;

export function createProjectAuthoringGlobals(opts: {
  projectRoot: string;
  republish?: () => void;
  /** Called after a successful `writeProjectTable` — the host re-derives the project's
   *  db from `database/*.json` (a project with no tables has NO db at all, so the first
   *  table is what brings one into existence). When `rows` is passed, the host ALSO seeds
   *  those rows into the freshly-derived table (a project-authoring agent can't insert into
   *  a table it just created — `db` isn't injected until a table exists — so seeding is done
   *  host-side here). Fire-and-forget, like `republish`. */
  onSchemaWrite?: (table: string, rows?: unknown[]) => void;
  /** Called after a successful `writeProjectPage`/`writeProjectApi` — the host rebuilds
   *  the project's pages (so `/app/<id>/` serves the new UI) and drops any cached page-build
   *  or endpoint-contract state. Fire-and-forget, like `republish`. */
  onAppWrite?: (kind: 'page' | 'api' | 'component', route: string) => void;
  /** Host-side endpoint invoker for {@link ProjectAuthoringGlobals.callProjectApi}. Passed in
   *  rather than built here because the `ApiRuntime` is owned (and cached) by the SessionManager.
   *  Omit for a project with no `api/` — the global is then simply absent. */
  callProjectApi?: (name: string, input?: unknown) => Promise<{ status: number; body: unknown }>;
}): ProjectAuthoringGlobals {
  const { projectRoot, republish, onSchemaWrite, onAppWrite, callProjectApi } = opts;

  /** Write `rel` under the project root, then fire the republish (best-effort). */
  function writeUnder(rel: string, src: string): { ok: boolean; error?: string } {
    try {
      const target = safeResolve(projectRoot, rel);
      writeFile(target, src);
      // Fire-and-forget: a republish failure must not fail the write (the file is
      // already on disk; the next boot picks it up even if the live re-derive throws).
      try {
        republish?.();
      } catch {
        /* best-effort — the write itself succeeded */
      }
      return { ok: true };
    } catch (e) {
      return { ok: false, error: String(e instanceof Error ? e.message : e) };
    }
  }

  function writeProjectHook(slug: string, src: string): { ok: boolean; error?: string } {
    try {
      assertSlug('hook slug', slug);
      assertSourceParses(src, 'ts');
      const cols = unknownColumnsIn(src);
      if (cols) return { ok: false, error: cols };
      const evt = unknownEventTableIn(src);
      if (evt) return { ok: false, error: evt };
      throwLint(lintHookSource(src, slug, safeResolve(projectRoot, join('hooks', `${slug}.ts`))));
    } catch (e) {
      if (e instanceof LintError) throw e;
      return { ok: false, error: String(e instanceof Error ? e.message : e) };
    }
    return writeUnder(join('hooks', `${slug}.ts`), src);
  }

  function writeProjectEvent(name: string, src: string): { ok: boolean; error?: string } {
    try {
      assertSlug('event name', name);
      assertSourceParses(src, 'ts');
    } catch (e) {
      if (e instanceof LintError) throw e;
      return { ok: false, error: String(e instanceof Error ? e.message : e) };
    }
    return writeUnder(join('events', `${name}.ts`), src);
  }

  function writeProjectFunction(name: string, src: string): { ok: boolean; error?: string } {
    if (!FUNCTION_NAME_RE.test(name)) {
      return {
        ok: false,
        error: `function name "${name}" is not a valid identifier (expected /${FUNCTION_NAME_RE.source}/)`,
      };
    }
    try {
      assertSourceParses(src, 'ts');
    } catch (e) {
      if (e instanceof LintError) throw e;
      return { ok: false, error: String(e instanceof Error ? e.message : e) };
    }
    return writeUnder(join('functions', `${name}.ts`), src);
  }

  /** The declared columns of every table the project has (`database/*.json`). */
  function declaredTables(): Map<string, string[]> {
    const out = new Map<string, string[]>();
    try {
      const dir = safeResolve(projectRoot, 'database');
      if (!existsSync(dir)) return out;
      for (const f of readdirSync(dir)) {
        if (!f.endsWith('.json')) continue;
        try {
          const schema = JSON.parse(readFileSync(join(dir, f), 'utf8')) as TableSchema;
          if (schema?.columns && typeof schema.columns === 'object') {
            out.set(f.replace(/\.json$/, ''), Object.keys(schema.columns));
          }
        } catch {
          /* a corrupt schema file is not this check's business */
        }
      }
    } catch {
      /* no database dir — nothing to check against */
    }
    return out;
  }

  /**
   * Reject authored source that writes a column its table does not have — the writer is the
   * gate, so the agent RETRIES instead of leaving behind a hook that dies at runtime.
   *
   * Scenario 10, live: the intake hook the automator authored inserted into `recipes` with
   * `{ title_gr, cuisine_id, ingredients, instructions, source, intake_id }`. Two of those
   * columns were right and four were invented — the table declares `ingredients_text`,
   * `instructions_text`, `source_summary`, `notes`. SQLite threw `table recipes has no column
   * named ingredients`, the hook's own catch marked the submission `failed`, and the recipe the
   * user filed through the app's form never appeared. Nothing failed loudly: the form said
   * thanks, the book stayed empty. Prompting the agent to read the schema first helps (it got
   * title_gr/cuisine_id right this time) but it does not make it reliable — so the write is
   * checked against the schema that is actually on disk.
   *
   * Deliberately conservative: it only inspects `db.insert('<literal table>', { <literal keys> })`
   * and `db.update('<literal table>', { … set: { <literal keys> } })`, skips any object carrying a
   * spread (the keys are not knowable), and stays silent for a table with no declared schema.
   * A false NEGATIVE just restores today's behaviour; a false positive would block a legal write.
   */
  function unknownColumnsIn(src: string): string | null {
    const tables = declaredTables();
    if (!tables.size) return null;
    // `db.insert('t', {…})` / `db.update('t', {…})` — the object literal is brace-matched below.
    const call = /\bdb\s*\.\s*(insert|update)\s*\(\s*['"`]([A-Za-z0-9_]+)['"`]\s*,\s*\{/g;
    for (let m = call.exec(src); m; m = call.exec(src)) {
      const [, op, table] = m;
      const columns = tables.get(table);
      if (!columns) continue; // unknown table — not this check's business
      const body = braceBody(src, m.index + m[0].length - 1);
      if (body === null) continue;
      // `update` names its columns under `set: { … }`; `insert` names them at the top level.
      const target = op === 'update' ? setBlock(body) : body;
      if (target === null || /\.\.\./.test(target)) continue; // a spread hides the real keys
      const keys = topLevelKeys(target);
      const unknown = keys.filter((k) => !columns.includes(k));
      if (unknown.length) {
        const near = unknown
          .map((u) => {
            const guess = columns.find((c) => c.startsWith(u) || u.startsWith(c) || c.includes(u));
            return guess ? `"${u}" (did you mean "${guess}"?)` : `"${u}"`;
          })
          .join(', ');
        return (
          `db.${op}('${table}', …) writes ${unknown.length === 1 ? 'a column' : 'columns'} the table does not have: ${near}. ` +
          `The columns of "${table}" are: ${columns.join(', ')}. ` +
          `Read database/${table}.json and write THOSE columns — a row in the wrong columns is a row the app cannot render. ` +
          `If the concept is genuinely new, add the column with writeProjectTable first.`
        );
      }
    }
    return null;
  }

  /** The `set: { … }` block of an update's options object. */
  function setBlock(body: string): string | null {
    const m = /\bset\s*:\s*\{/.exec(body);
    return m ? braceBody(body, m.index + m[0].length - 1) : null;
  }

  /**
   * Reject an EVENT hook that subscribes to a synthetic `project/db.<table>.<event>` address for a
   * table the project does not have — the write-time twin of the endpoint→table gate, in the WRITER
   * so the authoring agent fixes it in the same turn instead of shipping a hook that never fires.
   *
   * A db write auto-emits `project/db.<table>.<insert|update|remove>` (its payload IS the row), and an
   * event hook fires on the matching address. If `<table>` never landed, that write is never emitted,
   * so the automation is silently inert — it loads fine (a hook shape is valid) and nothing the user's
   * story promised ever happens. The one class this catches that `unknownColumnsIn` cannot: the address
   * itself, before any `db.` call. Conservative like `unknownColumnsIn` — silent when the project has no
   * tables yet (nothing to check against) and only for a LITERAL `project/db.<table>.<event>` string, so
   * a space event (`integration-slack/message.posted`) or a curated `project/<name>` event never trips it.
   */
  function unknownEventTableIn(src: string): string | null {
    const tables = declaredTables();
    if (!tables.size) return null;
    const re = /['"`]project\/db\.([a-z][a-z0-9_]*)\.(?:insert|update|remove)['"`]/g;
    for (let m = re.exec(src); m; m = re.exec(src)) {
      const table = m[1] as string;
      if (tables.has(table)) continue;
      const known = [...tables.keys()].join(', ');
      const guess = [...tables.keys()].find((c) => c.startsWith(table) || table.startsWith(c) || c.includes(table));
      return (
        `this hook subscribes to \`project/db.${table}.*\`, but the project has no table "${table}"` +
        `${guess ? ` (did you mean "${guess}"?)` : ''}. A db write auto-emits \`project/db.<table>.<event>\`, ` +
        `so an address on a table that does not exist never fires — the automation is silently inert. ` +
        `The tables that exist are: ${known}. Subscribe to a real one, or create the table first with ` +
        `writeProjectTable.`
      );
    }
    return null;
  }

  /**
   * Merge an incoming schema for an EXISTING table with the one already on disk: the
   * declared columns are the UNION (the incoming definition wins for a same-named column,
   * and every other top-level key of the incoming schema replaces the old one).
   *
   * A redefinition must never DROP a declared column, because the live table cannot drop
   * one either: `reconcileTable` only ever ADDs columns to the running SQLite table. So a
   * `writeProjectTable('recipes', <9 new columns>)` over a 13-column table used to leave
   * `database/recipes.json` describing a table the runtime does not have — the 13 original
   * columns stayed physically in SQLite, holding all the existing rows' data, while the
   * declared schema no longer mentioned them. Everything downstream reads the DECLARATION,
   * so those columns silently left the DTS, the marshalling and the pages: the app kept
   * serving rows whose real content had become unaddressable.
   *
   * Found live in scenario 10: a mid-life "add a recipe form" feature redefined `recipes`
   * with the intake's own shape (`title`, `cuisine`, `ingredients`), so every recipe the
   * book page renders by `title_gr`/`cuisine_id` fell out of the schema, and the recipe the
   * form itself submitted rendered as a blank card. Merging keeps the declaration honest;
   * a genuinely new table is unaffected (nothing on disk to merge with).
   */
  function mergeWithExistingTable(name: string, schema: TableSchema): TableSchema {
    let existing: TableSchema | undefined;
    try {
      const path = safeResolve(projectRoot, join('database', `${name}.json`));
      if (!existsSync(path)) return schema;
      existing = JSON.parse(readFileSync(path, 'utf8')) as TableSchema;
    } catch {
      return schema; // unreadable/corrupt declaration — the incoming one is strictly better
    }
    if (!existing?.columns || typeof existing.columns !== 'object') return schema;
    return { ...existing, ...schema, columns: { ...existing.columns, ...schema.columns } };
  }

  /**
   * Write a table schema into the LIVE project (`database/<name>.json`) and tell the
   * host to re-derive the project db.
   *
   * This is the live twin of the catalog `writeTableSchema`. Without it a project the
   * user is actually working in can never gain a data model: the catalog writer targets
   * `store/projects/<id>/` TEMPLATES, and `bootProjectApp()` returns `null` for a project
   * with no `database/*.json` — so "store every tip in a `tips` table" had nowhere to land
   * and every downstream hook had no `db` to write to. Found live in scenario 01.
   *
   * On a table that ALREADY exists the incoming schema is MERGED, never substituted — see
   * {@link mergeWithExistingTable}.
   */
  function writeProjectTable(
    name: string,
    schema: unknown,
    rows?: unknown[],
  ): { ok: boolean; error?: string } {
    try {
      assertTableName(name);
      validateTableSchema(name, schema as TableSchema);
    } catch (e) {
      if (e instanceof LintError) throw e;
      return { ok: false, error: String(e instanceof Error ? e.message : e) };
    }
    if (rows !== undefined && !Array.isArray(rows)) {
      return { ok: false, error: 'rows must be an array of row objects' };
    }
    const merged = mergeWithExistingTable(name, schema as TableSchema);
    const out = writeUnder(join('database', `${name}.json`), JSON.stringify(merged, null, 2) + '\n');
    if (out.ok) {
      try {
        // Pass the seed rows through: the host re-derives the db AND inserts them (the agent
        // can't — `db` isn't injected until a table exists). Undefined/empty rows just re-derive.
        onSchemaWrite?.(name, rows && rows.length ? rows : undefined);
      } catch {
        /* best-effort — the schema file already landed */
      }
    }
    return out;
  }

  /**
   * Write a React page into the LIVE project (`pages/<route>.tsx`) and tell the host to
   * rebuild the project's pages. The live twin of the catalog `writePage`: without it a
   * project the user is actually working in can gain a data model + automation
   * (writeProjectTable/Hook) but never a UI — "turn this into an app I can open" would
   * dead-end because the automator has only `writeProjectTable`, and an attempt to call a
   * page writer fails typecheck (found live in scenario 05: `Cannot find name
   * 'writeProjectPage'`). Route validation + `.tsx` normalization mirror the catalog writer.
   *
   * **Overwrites are guarded** (see {@link fetchedRoutes}). An app grows over its life: a
   * later "add an invoices section" turn that re-authors `pages/index.tsx` from scratch
   * silently DELETES the dashboard the user already had — the app still builds, every route
   * still 200s, and the user opens their vault to an empty page. Found live in scenario 07:
   * the home page came back as a stub linking to the newest section while `/vault-dashboard`
   * (which nothing fetched any more) still served the whole household. So: replacing a page
   * that fetches data with one that fetches NONE of it is rejected — the agent reads it and
   * extends it, or says it means it with `{ replace: true }`.
   */
  function writeProjectPage(
    route: string,
    src: string,
    opts?: { replace?: boolean },
  ): { ok: boolean; error?: string } {
    let rel: string;
    try {
      rel = assertPathSegments('page route', route);
      if (!rel.endsWith('.tsx')) rel = `${rel}.tsx`;
      assertSourceParses(src, 'tsx');
      throwLint(lintPageSource(src, { projectRoot }));
      throwLint(saveTypecheckError({ projectRoot, relPath: `pages/${rel}`, src, kind: 'page' }));
    } catch (e) {
      if (e instanceof LintError) throw e;
      return { ok: false, error: String(e instanceof Error ? e.message : e) };
    }
    if (!opts?.replace) {
      const clobbered = wouldDropData(join(projectRoot, 'pages', rel), src);
      if (clobbered) return { ok: false, error: clobbered };
    }
    const out = writeUnder(join('pages', rel), src);
    if (out.ok) {
      try {
        onAppWrite?.('page', route);
      } catch {
        /* best-effort — the page file already landed */
      }
    }
    return out;
  }

  /**
   * Write a typed API handler into the LIVE project (`api/<path>/<METHOD>.ts`) and tell the
   * host to drop its cached endpoint contracts. The live twin of the catalog `writeApi`;
   * the route encodes its HTTP method last (`items-list/GET`). Path + method validation
   * mirror the catalog writer.
   */
  function writeProjectApi(route: string, src: string): { ok: boolean; error?: string } {
    let target: string;
    try {
      const rel = assertPathSegments('api route', route);
      const segments = rel.split('/');
      const method = segments.pop() as string;
      if (!METHODS.has(method)) {
        throw new Error(`api route "${route}" has an invalid method "${method}" (expected one of ${[...METHODS].join(', ')})`);
      }
      if (segments.length === 0) {
        throw new Error(`api route "${route}" is missing an endpoint path before the method`);
      }
      assertSourceParses(src, 'ts');
      target = join('api', ...segments, `${method}.ts`);
      // An API route that writes the wrong columns fails exactly like a hook that does — the POST
      // 500s (or worse, is caught) and the user's submission is silently gone. Same gate.
      const cols = unknownColumnsIn(src);
      if (cols) return { ok: false, error: cols };
      // Loader contract: every endpoint needs a unique `export const name` + a default/handler fn.
      throwLint(lintApiHandler(src, { existingNames: existingApiNames(projectRoot, safeResolve(projectRoot, target)) }));
      // Typed boundary: the handler's `input`/return must be REAL types — never `any`/`Promise<any>` —
      // and the return must BE the contract's `<Base>Output`, so the endpoint↔page field divergence
      // that the vacuous `Promise<any>` hides (the €0.00/"undefined" dashboard defect) is caught here.
      throwLint(apiHandlerTypingError(src, { projectRoot }));
      throwLint(saveTypecheckError({ projectRoot, relPath: `api/${[...segments, method].join('/')}.ts`, src, kind: 'api endpoint' }));
    } catch (e) {
      if (e instanceof LintError) throw e;
      return { ok: false, error: String(e instanceof Error ? e.message : e) };
    }
    const out = writeUnder(target, src);
    if (out.ok) {
      try {
        onAppWrite?.('api', route);
      } catch {
        /* best-effort — the handler file already landed */
      }
    }
    return out;
  }

  /**
   * Write a shared React component into the LIVE project (`components/<Name>.tsx`) and tell the
   * host to rebuild the project's pages (a page may now import it). The typed twin of a page
   * writer for shared UI: without it an app-authoring agent that wants a reusable `<TripCard>`
   * had no typed writer and would have reached for the (now removed) space-rooted `writeFile`,
   * which mis-roots. `<Name>` is PascalCase; `.tsx` is enforced.
   */
  function writeProjectComponent(name: string, src: string): { ok: boolean; error?: string } {
    try {
      if (!COMPONENT_NAME_RE.test(name)) {
        throw new Error(`component name "${name}" is not PascalCase (expected /${COMPONENT_NAME_RE.source}/)`);
      }
      assertSourceParses(src, 'tsx');
      throwLint(lintComponentSource(src, { projectRoot }));
      throwLint(saveTypecheckError({ projectRoot, relPath: `components/${name}.tsx`, src, kind: 'component' }));
    } catch (e) {
      if (e instanceof LintError) throw e;
      return { ok: false, error: String(e instanceof Error ? e.message : e) };
    }
    const out = writeUnder(join('components', `${name}.tsx`), src);
    if (out.ok) {
      try {
        onAppWrite?.('component', name);
      } catch {
        /* best-effort — the component file already landed */
      }
    }
    return out;
  }

  /** List `<projectRoot>/<dir>` — project-rooted introspection (the read twin of the writers).
   *  A missing dir returns `entries: []` (not an error) so an agent can safely check "what tables
   *  exist?" on a fresh project. `safeResolve` keeps it inside the project (no traversal). */
  function listProjectDir(dir: string): { ok: boolean; entries: string[]; error?: string } {
    try {
      const target = safeResolve(projectRoot, dir || '.');
      if (!existsSync(target)) return { ok: true, entries: [] };
      if (!statSync(target).isDirectory()) return { ok: false, entries: [], error: `not a directory: ${dir}` };
      return { ok: true, entries: readdirSync(target).sort() };
    } catch (e) {
      return { ok: false, entries: [], error: String(e instanceof Error ? e.message : e) };
    }
  }

  /** Read `<projectRoot>/<path>` as UTF-8 text — project-rooted (the read twin of the writers). */
  function readProjectFile(path: string): { ok: boolean; content: string; error?: string } {
    try {
      const target = safeResolve(projectRoot, path);
      if (!existsSync(target)) return { ok: false, content: '', error: `no such file: ${path}` };
      return { ok: true, content: readFileSync(target, 'utf8') };
    } catch (e) {
      return { ok: false, content: '', error: String(e instanceof Error ? e.message : e) };
    }
  }

  /** Host-side twin of the agent's `buildApp()` — same `runProjectAppCheck`, reachable from a
   *  tasklist code node so a build gate can be deterministic rather than model-emitted. */
  const buildProjectApp = (): Promise<AppCheckResult> => runProjectAppCheck(opts.projectRoot);

  /** Write a GENERATED, non-artifact file under the project root (`types/contract.d.ts`). */
  const writeProjectFile = (path: string, contents: string): { ok: boolean; error?: string } => {
    const rel = String(path).replace(/^\/+/, '');
    if (!ALLOWED_GENERATED_FILE.test(rel)) {
      return {
        ok: false,
        error:
          `writeProjectFile("${path}") refused: only \`types/*.d.ts\` may be written this way. ` +
          'Every other artifact has a TYPED writer that validates it (writeProjectTable / ' +
          'writeProjectApi / writeProjectPage / writeProjectComponent / writeProjectHook / ' +
          'writeProjectEvent / writeProjectFunction) — use the one for the artifact you are ' +
          'authoring, so its contract is checked at write time.',
      };
    }
    if (rel === 'types/generated.d.ts') {
      return {
        ok: false,
        error:
          'writeProjectFile("types/generated.d.ts") refused: that file is a BUILD ARTIFACT, ' +
          'regenerated from the landed tables and handlers on every buildProjectApp() ' +
          '(`app/build/schema.ts#generateAppTypes`). Anything written there is erased by the next ' +
          'build — exactly when it should be enforcing something. Write `types/contract.d.ts` and ' +
          "import it relatively (`import type { … } from '../types/contract'`).",
      };
    }
    return writeUnder(rel, contents);
  };

  return {
    writeProjectHook,
    writeProjectEvent,
    writeProjectFunction,
    writeProjectTable,
    writeProjectPage,
    writeProjectComponent,
    writeProjectApi,
    listProjectDir,
    readProjectFile,
    buildProjectApp,
    writeProjectFile,
    // Spread conditionally: `createCodeNodeCtxFactory` forwards the whole authoring object and
    // `worker-load.ts` derives the worker's method list from `Object.keys`, so an undefined-valued
    // key would still surface a broken proxy on `ctx`.
    ...(callProjectApi ? { callProjectApi } : {}),
  };
}
