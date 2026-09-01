/**
 * LIVE-PROJECT **app-authoring globals** — the host-side (CLI) impls behind the
 * `AppGlobalImpls` `writeProject*` writer family (`libs/core/src/exec/app-globals.ts`).
 *
 * These are pure, SYNCHRONOUS, validated file-writers into ONE fixed live-project
 * root (`.lmthing/<projectId>/`): a project's own `database/ pages/ api/ hooks/
 * events/ functions/ components/` dirs. A writer here does exactly one thing:
 * validate the input, write ONE file (creating its parent dirs), fire the
 * project's republish/re-derive side effect, and return `{ ok, error? }` — never
 * a bulk delete. The APP-authoring writers additionally REFUSE when the bound
 * project is the personal `user` workspace (or the reserved `system` tree) — a
 * built app may never land there; see the guard in `createProjectAuthoringGlobals`. The old STORE-CATALOG authoring engine (`createAppAuthoringGlobals`,
 * which templated `store/projects/<id>/`) has been removed: THING now creates a
 * LIVE project and delegates the build INTO it (see `SessionManager` `resolveBuildTarget`).
 *
 * Core only INJECTS these onto a VM for an agent holding the matching authoring
 * capability (`hooks:write` for the writers here); THING and ordinary agents hold
 * none, so it is harmless to always construct and pass this object through
 * `appGlobals` — it is simply never exposed to a capability-less agent.
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { runProjectAppCheck } from '../build/check.js';
import type { AppCheckResult } from '../build/check.js';
import { basename, dirname, join, relative, resolve, sep } from 'node:path';
import { transformSync } from 'esbuild';
import { validateTableSchema, parseFrontmatter, type TableSchema } from '@lmthing/core';
import {
  LintError,
  apiHandlerTypingError,
  braceBody,
  existingApiNames,
  lintApiHandler,
  lintHookSource,
  topLevelKeys,
} from './lint.js';
import { saveTypecheckError } from './save-typecheck.js';
import { validateEntityIr, compileEntity, type EntityIr, type FactRecord } from '../ir/entity.js';
import { validateQueryIr, generateQueryHandler, type QueryIr } from '../ir/query.js';
import { serializeTableSchema } from '../ir/check.js';
import { SHELL_SPEC_PATH, loadProjectViews, viewComponentPath, viewLayoutPath, viewSpecPath, type LoadedViews } from '../view-spec/files.js';
import {
  appViewFindings,
  formatViewErrors,
  loadViewContracts,
  renderSmokeViews,
  validateAppViews,
  validateShellSpec,
  validateViewComponent,
  validateViewLayout,
  validateViewSpec,
  type ApiCaller,
  type RenderSmokeResult,
  type ViewContracts,
  type ViewEndpoint,
  type ViewError,
  type ViewValidationResult,
} from '../view-spec/validate.js';
import {
  ROUTE_RE,
  type ShellSpec,
  type ViewComponentSpec,
  type ViewLayoutSpec,
  type ViewSpec,
} from '../view-spec/schema.js';
import { DEFAULT_PROJECT_ID, SYSTEM_PROJECT_ID } from '../../server/projects.js';

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
  /** Write `<projectRoot>/model/<name>.entity.json` (W7 — facts, not columns) and COMPILE it straight
   *  to `<projectRoot>/database/<name>.json` — the declarative counterpart of `writeProjectTable`.
   *
   *  You author FACTS (`{ fact, type, values?, to?, currencyField? }`), not a column schema: the
   *  compiled table is generated, never hand-edited (enforced by `checkGeneratedIr`). Validated
   *  against every OTHER entity model in the project (a fact key names exactly one column; an enum
   *  fact's `values` may only ever grow, never drop/rename — "one vocabulary per fact, forever").
   *  Optional seed `rows`, exactly like `writeProjectTable` (the same reason: `db` is not injected
   *  until the table exists, so an agent cannot insert into a table it just created). */
  writeProjectEntity: (name: string, entity: unknown, rows?: unknown[]) => { ok: boolean; error?: string };
  /** Write `<projectRoot>/views/<route>.view.json` (a VIEW SPEC), the one UI-authoring
   *  surface (`system-appbuilder`).
   *
   *  A view is data, not TSX: the spec is validated against the project's endpoint contracts at
   *  save time (`view-spec/validate.ts#validateViewSpec`) and rendered by the shared
   *  `ViewRenderer` in the prebuilt AppHost and the native mobile app. */
  writeProjectView: (route: string, spec: unknown) => { ok: boolean; error?: string };
  /** Write `views/<prefix>/_layout.view.json` — the frame every route under `prefix` renders in. */
  writeProjectViewLayout: (prefix: string, spec: unknown) => { ok: boolean; error?: string };
  /** Write `<projectRoot>/components/<Name>.view.json` (a reusable element composition with typed
   *  props). Validated exactly like a view; every reference to it is re-checked at the referencing
   *  view's own save. */
  writeProjectViewComponent: (name: string, def: unknown) => { ok: boolean; error?: string };
  /** Write `<projectRoot>/shell.view.json` (the app's nav/brand/assistant shell).
   *
   *  Optional but not always derivable: the renderer derives nav from the route list only for a
   *  small, flat app (`SHELL_DERIVE_MAX_ROUTES`), and T0 measured 0/5 catalogue apps reproducing
   *  their real navigation from a flat list. Above that the model declares `groups`/`subnav` here
   *  or the app ships with navigation nobody can use. */
  writeProjectViewShell: (shell: unknown) => { ok: boolean; error?: string };
  /** Whole-app view validation (`view-spec/validate.ts#validateAppViews`) — orphan pages, dead
   *  components, nav targets, pages that read nothing. Host-side so a tasklist CODE node can gate
   *  on it deterministically, exactly like {@link ProjectAuthoringGlobals.buildProjectApp}. */
  validateAppViews: () => Promise<ViewValidationResult>;
  /** Mount every view spec against the app's LIVE endpoint responses
   *  (`view-spec/validate.ts#renderSmokeViews`) — the view twin of `smoke_endpoints`, and the only
   *  gate that can see a page which is structurally perfect and empty. Absent api runtime ⇒ it
   *  reports `unavailable: true` rather than an empty (i.e. "clean") finding list. */
  renderSmokeViews: () => Promise<RenderSmokeResult>;
  /** Write `<projectRoot>/api/<path>/<METHOD>.ts` (a typed API handler) — the
   *  LIVE-project counterpart of the catalog's `writeApi`. */
  writeProjectApi: (route: string, src: string) => { ok: boolean; error?: string };
  /** Write `<projectRoot>/api/<name>.query.json` (W7 — declarative endpoint) and GENERATE its handler
   *  straight to `<projectRoot>/api/<route>/<METHOD>.ts` — the declarative counterpart of
   *  `writeProjectApi`. Most endpoints are projections (`list` `get` `aggregate` `create` `update`
   *  `toggle`), not programs: the handler is generated FROM this same IR, so it cannot disagree with
   *  its own contract (no invented field, no `ctx.params`, no import that doesn't exist) — the whole
   *  class of build-burning repair rounds a hand-written handler risked stops existing. The generated
   *  handler still passes every gate a hand-written one does (lint, typing, project typecheck); a
   *  genuinely bespoke endpoint keeps `writeProjectApi`/`api/<name>.handler.ts` as its escape hatch. */
  writeProjectQuery: (name: string, query: unknown) => { ok: boolean; error?: string };
  /** Delete `views/<route>.view.json` — the delete twin of {@link ProjectAuthoringGlobals.writeProjectView},
   *  for retiring a superseded/broken page. REFUSED while anything still references the route
   *  (shell nav/groups/subnav, another page's navigate/link): the error names the referencing
   *  file(s); repoint or delete those first. Deleting a route that has no spec is `{ ok: false }`
   *  (never a silent success, never a throw). Tables are NOT deletable — a table holds user data
   *  (`db.remove` is host-only by design) — and no generic file delete exists. */
  deleteProjectView: (route: string) => { ok: boolean; error?: string };
  /** Delete `components/<Name>.view.json` — REFUSED while any view/layout/component still
   *  references it as `{ use: '<Name>' }` (the error names the referencing file(s)). */
  deleteProjectViewComponent: (name: string) => { ok: boolean; error?: string };
  /** Delete `views/<prefix>/_layout.view.json` — REFUSED when removing the frame would leave a
   *  page under the prefix unreachable or otherwise fault the app (the error names what breaks). */
  deleteProjectViewLayout: (prefix: string) => { ok: boolean; error?: string };
  /** Delete `api/<path>/<METHOD>.ts` (route encodes the method last, exactly like
   *  {@link ProjectAuthoringGlobals.writeProjectApi}) — REFUSED while any view still queries or
   *  mutates the endpoint's `export const name` (the error names the referencing page(s)). */
  deleteProjectApi: (route: string) => { ok: boolean; error?: string };
  /** Delete `api/<name>.query.json` AND the handler it generated — REFUSED while any view still
   *  uses the endpoint (same guard as {@link ProjectAuthoringGlobals.deleteProjectApi}). */
  deleteProjectQuery: (name: string) => { ok: boolean; error?: string };
  /** Delete `hooks/<slug>.ts` and republish (the webhook manifest + crontab re-derive from the
   *  remaining hooks). A hook is a consumer nothing references, so there is no reference guard. */
  deleteProjectHook: (slug: string) => { ok: boolean; error?: string };
  /** List the files under `<projectRoot>/<dir>` (e.g. 'database', 'hooks', 'events') — the
   *  read-side twin of the writers. Project-rooted (NOT the space dir), so a delegated
   *  system-space agent can see the PROJECT's contents. Returns `entries: []` for a missing dir. */
  listProjectDir: (dir: string) => { ok: boolean; entries: string[]; error?: string };
  /** Read a project file's text (`<projectRoot>/<path>`). Project-rooted; the read twin of the
   *  writers, for inspecting an existing table schema / page / hook before editing it. */
  readProjectFile: (path: string) => { ok: boolean; content: string; error?: string };
  /** Typecheck + bundle the project app (lint → typecheck → esbuild), returning the same
   *  structured result {@link runProjectAppCheck} produces.
   *
   *  This exists so a tasklist **code node** can gate a build deterministically, without asking a
   *  model turn to re-emit ~50 lines of scanning TypeScript on every run — which, in one real
   *  scenario run, accounted for 35% of all errors (`'gateErrors' is not defined` cascades), and a
   *  gate that fails to execute contributes no findings, so the pipeline reads its empty result as
   *  "clean". Exposing it host-side lets the gate be deterministic. */
  buildProjectApp: () => Promise<AppCheckResult>;
  /** Write a GENERATED type-declaration file under the project root — narrowly scoped to
   *  `types/*.d.ts`, and refusing `types/generated.d.ts`.
   *
   *  Every other artifact goes through a TYPED writer that validates its contract at write time,
   *  which is the whole design (`lint.ts`); a general-purpose file writer would route around that.
   *  But the contract `emit_types` produces from the plan is not an artifact any of them accept —
   *  every typed writer throws a LintError for a shape it does not recognize, and a throw in a
   *  code node aborts the tasklist. So the escape hatch exists, and is kept as small as the one
   *  job requires. */
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
  /** The project's id — the basename of the `<lmthingRoot>/<projectId>/` dir the writers target.
   *  REQUIRED (not defaulted, not derived) so every caller states it and the non-buildable-project
   *  guard below always has the host's own notion of which project this is. */
  projectId: string;
  republish?: () => void;
  /** Called after a successful `writeProjectTable` — the host re-derives the project's
   *  db from `database/*.json` (a project with no tables has NO db at all, so the first
   *  table is what brings one into existence). When `rows` is passed, the host ALSO seeds
   *  those rows into the freshly-derived table (a project-authoring agent can't insert into
   *  a table it just created — `db` isn't injected until a table exists — so seeding is done
   *  host-side here). Fire-and-forget, like `republish`. */
  onSchemaWrite?: (table: string, rows?: unknown[]) => void;
  /** Called after a successful `writeProjectView`/`writeProjectApi`/… — the host rebuilds
   *  the project's pages (so `/app/<id>/` serves the new UI) and drops any cached page-build
   *  or endpoint-contract state. Fire-and-forget, like `republish`. */
  onAppWrite?: (kind: 'page' | 'api' | 'component', route: string) => void;
  /** Host-side endpoint invoker for {@link ProjectAuthoringGlobals.callProjectApi}. Passed in
   *  rather than built here because the `ApiRuntime` is owned (and cached) by the SessionManager.
   *  Omit for a project with no `api/` — the global is then simply absent. */
  callProjectApi?: (name: string, input?: unknown) => Promise<{ status: number; body: unknown }>;
}): ProjectAuthoringGlobals {
  const { projectRoot, projectId, republish, onSchemaWrite, onAppWrite, callProjectApi } = opts;

  // ── the personal-workspace guard ────────────────────────────────────────────
  //
  // `"user"` is the personal THING workspace: it holds the host-written chat scaffold
  // (`projects.ts#scaffoldAppFromBirthSync` / `#ensureAppFromBirthSync` — `views/index.view.json`
  // + `shell.view.json`, written DIRECTLY by the host, never through these globals) and the
  // user's spaces — NEVER a built app. The agent prompts have always said THING refuses to
  // build into it, but a prompt is prose: found live, a build_live_project run whose automator
  // was never retargeted authored a whole app INTO `.lmthing/user/` (a shell, 5 views, 2
  // components, 4 api handlers, 2 tables). The writer is where faults are caught, so the
  // refusal lives HERE — `{ ok:false }` with retarget instructions, not a throw.
  //
  // `"system"` is refused from the other side: it is the reserved system-spaces tree, not a
  // project (`projects.ts#SYSTEM_PROJECT_ID`), so an app authored there would pollute the
  // shipped runtime tree. No session runs on it today; the guard makes that permanent.
  //
  // Keyed off BOTH the explicit id and the root's basename (the on-disk layout is
  // `<lmthingRoot>/<projectId>/`, so the basename IS the id): a pair that disagrees is a caller
  // bug, and failing closed is the safe direction for that too.
  const rootName = basename(resolve(projectRoot));
  const nonBuildableId =
    projectId === DEFAULT_PROJECT_ID || rootName === DEFAULT_PROJECT_ID
      ? DEFAULT_PROJECT_ID
      : projectId === SYSTEM_PROJECT_ID || rootName === SYSTEM_PROJECT_ID
        ? SYSTEM_PROJECT_ID
        : null;
  const refuseNonBuildable = (writer: string): { ok: boolean; error: string } =>
    nonBuildableId === SYSTEM_PROJECT_ID
      ? {
          ok: false,
          error:
            `${writer} refused: "system" is the reserved system-spaces tree, not a project — an app ` +
            `cannot be built there. Create a real project with createProject(...) (or retarget an ` +
            `existing one with selectProject(...)) and author the app there.`,
        }
      : {
          ok: false,
          error:
            `${writer} refused: "user" is the personal THING workspace — it can never hold a built app. ` +
            `Its views/ and shell.view.json are the host-written chat scaffold, not an app surface; personal ` +
            `automations still belong here (hooks/events/functions stay writable). Create a real project ` +
            `with createProject(...) — or retarget an existing one with selectProject(...) — and author the ` +
            `app there.`,
        };

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

  /** The full parsed schema of every table the project has (`database/*.json`) — what
   *  {@link validateQueryIr}/{@link generateQueryHandler} need (column types, enums, relations), read
   *  SYNCHRONOUSLY like every other check in this module (every writer here is a sync host call, no
   *  `await`, so an async loader like `loader.ts#loadProjectApp` cannot be used from inside one). */
  function loadTableSchemas(): Map<string, TableSchema> {
    const out = new Map<string, TableSchema>();
    try {
      const dir = safeResolve(projectRoot, 'database');
      if (!existsSync(dir)) return out;
      for (const f of readdirSync(dir)) {
        if (!f.endsWith('.json')) continue;
        try {
          out.set(f.replace(/\.json$/, ''), JSON.parse(readFileSync(join(dir, f), 'utf8')) as TableSchema);
        } catch {
          /* a corrupt schema file is not this check's business */
        }
      }
    } catch {
      /* no database dir — nothing to check against */
    }
    return out;
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
    if (nonBuildableId) return refuseNonBuildable('writeProjectTable');
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

  /** Read every `model/*.entity.json` in the project — INCLUDING `name`'s own current (pre-write)
   *  version, when it already exists — into a fact registry (`fact key → { entity, field, type,
   *  values? }`) plus the set of known entity names. The cross-entity context
   *  {@link validateEntityIr} needs for its two registry rules: "a fact key names exactly one column"
   *  (fires when a fact's prior entity/field differs from the one being written — same entity+field is
   *  NOT a collision, it's a rebuild) and "one vocabulary per fact forever" (fires whenever a prior
   *  enum's values shrink, INCLUDING a rebuild of the entity's own prior version — which is why this
   *  does NOT exclude `name`). Malformed/unreadable siblings are skipped (their own write already
   *  validated them; a stale file here is not this write's problem). */
  function entityRegistry(name: string): { existingFacts: Map<string, FactRecord>; knownEntities: Set<string> } {
    const existingFacts = new Map<string, FactRecord>();
    const knownEntities = new Set<string>([name]);
    try {
      const dir = safeResolve(projectRoot, 'model');
      if (!existsSync(dir)) return { existingFacts, knownEntities };
      for (const f of readdirSync(dir)) {
        if (!f.endsWith('.entity.json')) continue;
        const entityName = f.slice(0, -'.entity.json'.length);
        knownEntities.add(entityName);
        try {
          const ir = JSON.parse(readFileSync(join(dir, f), 'utf8')) as EntityIr;
          if (!ir?.fields || typeof ir.fields !== 'object') continue;
          for (const [field, def] of Object.entries(ir.fields)) {
            if (def && typeof def.fact === 'string') {
              existingFacts.set(def.fact, { entity: ir.entity ?? entityName, field, type: def.type, values: def.values });
            }
          }
        } catch {
          /* a corrupt sibling entity file is not this write's business */
        }
      }
    } catch {
      /* no model dir — nothing to check against */
    }
    return { existingFacts, knownEntities };
  }

  /**
   * Write an ENTITY MODEL (`model/<name>.entity.json`) and COMPILE it straight to the generated
   * `database/<name>.json` — the live twin of `writeProjectTable`, but authored as facts instead of a
   * column schema (W7, §2.1). The compiled table OVERWRITES `database/<name>.json` (never merged —
   * unlike `writeProjectTable`'s union-merge for hand-authored schemas): the entity model is now the
   * single source of truth for this table, so a rebuild is a real migration of the same source, not a
   * second opinion needing reconciliation with what happened to land before. Live column ADDITIONS
   * still land non-destructively — `onSchemaWrite`'s host-side reconcile diffs declared vs. live
   * columns and only ever ALTERs in new ones, exactly as it does for `writeProjectTable`.
   */
  function writeProjectEntity(
    name: string,
    entity: unknown,
    rows?: unknown[],
  ): { ok: boolean; error?: string } {
    if (nonBuildableId) return refuseNonBuildable('writeProjectEntity');
    try {
      assertTableName(name);
      if (!entity || typeof entity !== 'object' || Array.isArray(entity)) {
        throw new Error(`writeProjectEntity("${name}", …) expects an entity OBJECT — got ${Array.isArray(entity) ? 'an array' : typeof entity}.`);
      }
      const declared = (entity as Record<string, unknown>)['entity'];
      if (typeof declared === 'string' && declared !== name) {
        throw new Error(
          `writeProjectEntity("${name}", …): the entity model declares entity "${declared}". Use one ` +
            `name — drop \`entity\` from the object, or call writeProjectEntity('${declared}', …).`,
        );
      }
      const normalized = { ...(entity as object), entity: name } as EntityIr;
      const { existingFacts, knownEntities } = entityRegistry(name);
      const validation = validateEntityIr(normalized, { existingFacts, knownEntities });
      throwLint(validation.ok ? null : validation.errors.join(' | '));

      if (rows !== undefined && !Array.isArray(rows)) {
        return { ok: false, error: 'rows must be an array of row objects' };
      }

      const { schema } = compileEntity(normalized);
      const entityOut = writeUnder(join('model', `${name}.entity.json`), JSON.stringify(normalized, null, 2) + '\n');
      if (!entityOut.ok) return entityOut;
      const tableOut = writeUnder(join('database', `${name}.json`), serializeTableSchema(schema));
      if (!tableOut.ok) return tableOut;
      try {
        onSchemaWrite?.(name, rows && rows.length ? rows : undefined);
      } catch {
        /* best-effort — both files already landed */
      }
      return { ok: true };
    } catch (e) {
      if (e instanceof LintError) throw e;
      return { ok: false, error: String(e instanceof Error ? e.message : e) };
    }
  }

  // ── view specs (system-appbuilder) ────────────────────────────────────────
  //
  // The same four-step shape throughout — validate, `throwLint`, `writeUnder`, `onAppWrite` —
  // over a different medium each time. Consistency across the family is the point: a writer
  // that reported failures differently would need its own retry handling in every prompt that
  // calls it.

  /** The project's spec vocabulary, with `extra` treated as already-present (the artifact being
   *  written is not on disk yet, so a self-reference would otherwise fail to resolve). */
  function contractsFor(extra: { route?: string; component?: ViewComponentSpec }): ReturnType<typeof loadViewContracts> {
    const contracts = loadViewContracts(projectRoot);
    if (extra.route) contracts.routes = [...new Set([...(contracts.routes ?? []), extra.route])];
    if (extra.component) {
      contracts.components = [
        ...(contracts.components ?? []).filter((c) => c.name !== extra.component!.name),
        extra.component,
      ];
    }
    return contracts;
  }

  /**
   * Write a VIEW SPEC into the live project.
   *
   * The spec's own `route` is normalized from the `route` argument, so the model writes it once.
   * Everything else is checked before anything lands: shape (ajv), every `query`/`mutation`/
   * `prefill.endpoint` name against the project's real endpoints (with the finite menu in the
   * rejection), every `$.field` against the endpoint's declared Output, every `{ use: … }`
   * reference and its props, every `reveals`/`$data.<id>` target, every `navigate` route.
   *
   * A failure THROWS a {@link LintError}, exactly like `writeProjectApi`'s lint: the model sees a
   * retryable, menu-shaped error in the same turn it wrote the spec, which is the whole reason the
   * checks live in the writer rather than in a downstream gate.
   */
  function writeProjectView(route: string, spec: unknown): { ok: boolean; error?: string } {
    if (nonBuildableId) return refuseNonBuildable('writeProjectView');
    let rel: string;
    let normalized: ViewSpec;
    try {
      rel = assertPathSegments('view route', route).replace(/\.(tsx|jsx|json)$/, '');
      if (!ROUTE_RE.test(rel)) {
        throw new Error(
          `view route "${route}" is not a valid route. Routes are lowercase, slash-separated, and ` +
            `may end a segment with a [param]: index, recipes, recipes/[id], searches/[searchId]/inbox.`,
        );
      }
      if (!spec || typeof spec !== 'object' || Array.isArray(spec)) {
        throw new Error(`writeProjectView("${route}", …) expects a spec OBJECT — got ${Array.isArray(spec) ? 'an array' : typeof spec}.`);
      }
      const declared = (spec as Record<string, unknown>)['route'];
      if (typeof declared === 'string' && declared !== rel) {
        throw new Error(
          `writeProjectView("${route}", …): the spec declares route "${declared}". A spec is written ` +
            `to the route you name in the first argument — drop \`route\` from the object, or call ` +
            `writeProjectView('${declared}', …).`,
        );
      }
      normalized = { ...(spec as object), route: rel } as ViewSpec;
      const res = validateViewSpec(normalized, contractsFor({ route: rel }));
      throwLint(res.ok ? null : formatViewErrors(res.errors));
    } catch (e) {
      if (e instanceof LintError) throw e;
      return { ok: false, error: String(e instanceof Error ? e.message : e) };
    }

    const out = writeUnder(viewSpecPath(rel), `${JSON.stringify(normalized, null, 2)}\n`);
    if (!out.ok) return out;
    try {
      onAppWrite?.('page', rel);
    } catch {
      /* best-effort — the spec already landed */
    }
    return { ok: true };
  }

  /**
   * Write a nested LAYOUT — the frame every route under `prefix` renders inside.
   *
   * Same four steps as {@link writeProjectView} over the same vocabulary, plus the one rule that
   * makes a layout a layout: exactly one `outlet`.
   */
  function writeProjectViewLayout(prefix: string, spec: unknown): { ok: boolean; error?: string } {
    if (nonBuildableId) return refuseNonBuildable('writeProjectViewLayout');
    let rel: string;
    let normalized: ViewLayoutSpec;
    try {
      rel = assertPathSegments('layout prefix', prefix).replace(/\.(tsx|jsx|json)$/, '');
      if (!ROUTE_RE.test(rel)) {
        throw new Error(
          `layout prefix "${prefix}" is not a valid route prefix. Prefixes are lowercase, ` +
            `slash-separated, and may end a segment with a [param]: trips, trips/[tripId].`,
        );
      }
      if (!spec || typeof spec !== 'object' || Array.isArray(spec)) {
        throw new Error(
          `writeProjectViewLayout("${prefix}", …) expects a layout OBJECT — got ${Array.isArray(spec) ? 'an array' : typeof spec}.`,
        );
      }
      const declared = (spec as Record<string, unknown>)['prefix'];
      if (typeof declared === 'string' && declared !== rel) {
        throw new Error(
          `writeProjectViewLayout("${prefix}", …): the layout declares prefix "${declared}". A layout ` +
            `is written to the prefix you name in the first argument — drop \`prefix\` from the object, ` +
            `or call writeProjectViewLayout('${declared}', …).`,
        );
      }
      normalized = { ...(spec as object), prefix: rel } as ViewLayoutSpec;
      const res = validateViewLayout(normalized, contractsFor({}));
      throwLint(res.ok ? null : formatViewErrors(res.errors));
    } catch (e) {
      if (e instanceof LintError) throw e;
      return { ok: false, error: String(e instanceof Error ? e.message : e) };
    }

    const out = writeUnder(viewLayoutPath(rel), `${JSON.stringify(normalized, null, 2)}\n`);
    if (!out.ok) return out;
    try {
      onAppWrite?.('page', rel);
    } catch {
      /* best-effort — the layout already landed */
    }
    return { ok: true };
  }

  /**
   * Write a VIEW COMPONENT — a named, parameterised composition of elements. Data, not React: it
   * needs no bundling, loads natively for free, and is validated exactly like a view (props
   * declared and typed, references acyclic, bindings well-formed).
   */
  function writeProjectViewComponent(name: string, def: unknown): { ok: boolean; error?: string } {
    if (nonBuildableId) return refuseNonBuildable('writeProjectViewComponent');
    let normalized: ViewComponentSpec;
    try {
      if (!COMPONENT_NAME_RE.test(name)) {
        throw new Error(`view component name "${name}" is not PascalCase (expected /${COMPONENT_NAME_RE.source}/)`);
      }
      if (!def || typeof def !== 'object' || Array.isArray(def)) {
        throw new Error(`writeProjectViewComponent("${name}", …) expects a definition OBJECT — got ${Array.isArray(def) ? 'an array' : typeof def}.`);
      }
      const declared = (def as Record<string, unknown>)['name'];
      if (typeof declared === 'string' && declared !== name) {
        throw new Error(
          `writeProjectViewComponent("${name}", …): the definition declares name "${declared}". ` +
            `Use one name — drop \`name\` from the object, or call writeProjectViewComponent('${declared}', …).`,
        );
      }
      normalized = { ...(def as object), name } as ViewComponentSpec;
      const res = validateViewComponent(normalized, contractsFor({ component: normalized }));
      throwLint(res.ok ? null : formatViewErrors(res.errors));
    } catch (e) {
      if (e instanceof LintError) throw e;
      return { ok: false, error: String(e instanceof Error ? e.message : e) };
    }

    const out = writeUnder(viewComponentPath(name), `${JSON.stringify(normalized, null, 2)}\n`);
    if (!out.ok) return out;
    try {
      onAppWrite?.('component', name);
    } catch {
      /* best-effort — the component already landed */
    }
    return { ok: true };
  }

  /** Write the app SHELL — nav, groups, per-entity subnav, brand, assistant dock. */
  function writeProjectViewShell(shell: unknown): { ok: boolean; error?: string } {
    if (nonBuildableId) return refuseNonBuildable('writeProjectViewShell');
    try {
      if (!shell || typeof shell !== 'object' || Array.isArray(shell)) {
        throw new Error(`writeProjectViewShell(…) expects a shell OBJECT — got ${Array.isArray(shell) ? 'an array' : typeof shell}.`);
      }
      const res = validateShellSpec(shell as ShellSpec, contractsFor({}));
      throwLint(res.ok ? null : formatViewErrors(res.errors));
    } catch (e) {
      if (e instanceof LintError) throw e;
      return { ok: false, error: String(e instanceof Error ? e.message : e) };
    }

    const out = writeUnder(SHELL_SPEC_PATH, `${JSON.stringify(shell, null, 2)}\n`);
    if (!out.ok) return out;
    try {
      onAppWrite?.('page', '_shell');
    } catch {
      /* best-effort — the shell already landed */
    }
    return { ok: true };
  }

  /**
   * Write a typed API handler into the LIVE project (`api/<path>/<METHOD>.ts`) and tell the
   * host to drop its cached endpoint contracts. The live twin of the catalog `writeApi`;
   * the route encodes its HTTP method last (`items-list/GET`). Path + method validation
   * mirror the catalog writer.
   */
  function writeProjectApi(route: string, src: string): { ok: boolean; error?: string } {
    if (nonBuildableId) return refuseNonBuildable('writeProjectApi');
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
      throwLint(lintApiHandler(src, { existingNames: existingApiNames(projectRoot, safeResolve(projectRoot, target)), writeRoute: route }));
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
   * Write a DECLARATIVE QUERY (`api/<name>.query.json`) and GENERATE its handler straight to
   * `api/<route>/<METHOD>.ts` — the live twin of `writeProjectApi` for the tier-1 kinds (W7, §7).
   *
   * Runs `lintApiHandler` (name/shape existence) and `saveTypecheckError` (the real project
   * typecheck) — the same defense-in-depth a hand-written handler faces, so a bug in the COMPILER
   * itself is still caught. Deliberately does NOT run `apiHandlerTypingError`: that check's rule
   * "the return must reference the contract's GLOBAL AMBIENT `<Pascal>Output`" is written for a
   * hand-written handler that could otherwise invent a competing shape — exactly the class of bug
   * that cannot happen here, because the generated `Output` interface and the handler body come
   * from the SAME IR in the SAME call. Enforcing it anyway made every declarative endpoint reject
   * outright the moment `emit_types` had already run (which it always has, in the real pipeline) —
   * found live, 30-bike-workshop: `writeProjectQuery` failed 100% of the time with "an inline or
   * invented Output", and the model, seeing every declarative attempt bounce, abandoned the whole
   * path and fell back to hand-writing every endpoint.
   */
  function writeProjectQuery(name: string, query: unknown): { ok: boolean; error?: string } {
    if (nonBuildableId) return refuseNonBuildable('writeProjectQuery');
    let generated: ReturnType<typeof generateQueryHandler>;
    let target: string;
    try {
      if (!SLUG_RE.test(name)) {
        throw new Error(`query name "${name}" is not a valid kebab-case id (expected /${SLUG_RE.source}/)`);
      }
      if (!query || typeof query !== 'object' || Array.isArray(query)) {
        throw new Error(`writeProjectQuery("${name}", …) expects a query OBJECT — got ${Array.isArray(query) ? 'an array' : typeof query}.`);
      }
      const declared = (query as Record<string, unknown>)['name'];
      if (typeof declared === 'string' && declared !== name) {
        throw new Error(
          `writeProjectQuery("${name}", …): the query declares name "${declared}". Use one name — drop ` +
            `\`name\` from the object, or call writeProjectQuery('${declared}', …).`,
        );
      }
      const normalized = { ...(query as object), name } as QueryIr;

      const tables = loadTableSchemas();
      const validation = validateQueryIr(normalized, tables);
      throwLint(validation.ok ? null : validation.errors.join(' | '));

      generated = generateQueryHandler(normalized, tables);
      target = join('api', ...generated.apiRoute.split('/').slice(0, -1), `${generated.method}.ts`);

      const cols = unknownColumnsIn(generated.source);
      if (cols) return { ok: false, error: cols };
      throwLint(lintApiHandler(generated.source, { existingNames: existingApiNames(projectRoot, safeResolve(projectRoot, target)), writeRoute: `${generated.apiRoute}/${generated.method}` }));
      throwLint(
        saveTypecheckError({
          projectRoot,
          relPath: `api/${generated.apiRoute}.ts`,
          src: generated.source,
          kind: 'api endpoint',
        }),
      );
    } catch (e) {
      if (e instanceof LintError) throw e;
      return { ok: false, error: String(e instanceof Error ? e.message : e) };
    }

    const queryOut = writeUnder(join('api', `${name}.query.json`), JSON.stringify(query, null, 2) + '\n');
    if (!queryOut.ok) return queryOut;
    const handlerOut = writeUnder(target, generated.source);
    if (handlerOut.ok) {
      try {
        onAppWrite?.('api', generated.apiRoute);
      } catch {
        /* best-effort — both files already landed */
      }
    }
    return handlerOut;
  }

  // ── deleters — the delete twins of the writers, guarded by the app they leave behind ─────
  //
  // The writers can only ADD/EDIT; nothing could RETIRE an artifact. Live, repair correctly
  // fixed a broken param-less page by creating views/<route>/[id].view.json — and then could not
  // remove the superseded views/<route>.view.json, which stayed on disk and wired into nav, so
  // the user-visible bug survived every repair round. These six mirror the write surface ONE
  // KIND AT A TIME (no generic file delete — the same closed-surface principle as the writers)
  // and refuse any delete that would leave the app referencing a ghost.

  /** Delete `rel` under the project root, prune now-empty parent dirs (never a DIRECT child of
   *  the root — `views/`, `api/`, … stay put), then fire the republish (best-effort, like
   *  {@link writeUnder}'s — the delete itself has already landed when we return). */
  function deleteUnder(rel: string): { ok: boolean; error?: string } {
    try {
      const target = safeResolve(projectRoot, rel);
      if (!existsSync(target)) return { ok: false, error: `no such file: ${rel}` };
      rmSync(target);
      let dir = dirname(target);
      const rootAbs = resolve(projectRoot);
      // A depth >= 2 dir is deeper than a direct child of the root, so `views/dog-detail/` goes
      // when its last file does, but `views/` itself never does.
      while (relative(rootAbs, dir).split(sep).length >= 2) {
        try {
          if (readdirSync(dir).length > 0) break;
          // `recursive: true` — plain rmSync on a directory throws EISDIR on Node (found live: the
          // prune silently no-opped and left the empty dir behind).
          rmSync(dir, { recursive: true });
        } catch {
          break;
        }
        dir = dirname(dir);
      }
      try {
        republish?.();
      } catch {
        /* best-effort — the file is already gone */
      }
      return { ok: true };
    } catch (e) {
      return { ok: false, error: String(e instanceof Error ? e.message : e) };
    }
  }

  /**
   * The write-time guard's delete twin: would the app STILL validate with `loadedAfter` on disk
   * and `endpointsAfter` in its vocabulary? Runs the SAME whole-app sweep the shipped gate uses
   * (`appViewFindings`) over the post-delete state — computed purely in memory, so nothing is
   * removed and restored; a delete either lands whole or does not land at all.
   *
   * The comparison is a DIFF, not an absolute check: an app that already has faults may still
   * have its unrelated artifacts retired — only faults the DELETE itself introduces are refusal
   * grounds. `no-data` ("the project has no view specs") is deliberately excluded: deleting the
   * last page is a legal intermediate state of a rebuild, not a broken app.
   *
   * Returns `null` when the delete may proceed, or the `{ ok:false }` refusal naming every
   * referencing file so the agent can repoint those FIRST — the same menu-shaped contract every
   * writer rejection has.
   */
  function refuseIfNewFaults(
    what: string,
    loadedAfter: LoadedViews,
    endpointsAfter: ViewEndpoint[],
  ): { ok: boolean; error?: string } | null {
    const contractsOf = (loaded: LoadedViews, endpoints: ViewEndpoint[]): ViewContracts => ({
      endpoints,
      components: loaded.components.map((c) => c.def),
      routes: loaded.views.map((v) => v.route),
      // `agents` cannot change by deleting a view artifact or endpoint; omitting it skips the
      // chat-agent check identically on both sides of the diff.
      agents: undefined,
      routesComplete: true,
    });
    const keyOf = (e: ViewError): string => `${e.code}|${e.file ?? ''}|${e.path}|${e.message}`;
    const countsOf = (errors: ViewError[]): Map<string, number> => {
      const out = new Map<string, number>();
      for (const e of errors) {
        if (e.severity !== 'error' || e.code === 'no-data') continue;
        const k = keyOf(e);
        out.set(k, (out.get(k) ?? 0) + 1);
      }
      return out;
    };
    const loadedBefore = loadProjectViews(projectRoot);
    const before = countsOf(
      appViewFindings(loadedBefore, contractsOf(loadedBefore, loadViewContracts(projectRoot).endpoints), undefined).errors,
    );
    const after = appViewFindings(loadedAfter, contractsOf(loadedAfter, endpointsAfter), undefined).errors.filter(
      (e) => e.severity === 'error' && e.code !== 'no-data',
    );
    const fresh = after.filter((e) => {
      const k = keyOf(e);
      const seen = before.get(k) ?? 0;
      if (seen > 0) before.set(k, seen - 1); // multiset: an app with the same fault twice keeps one
      return seen === 0;
    });
    if (fresh.length === 0) return null;
    return {
      ok: false,
      error:
        `${what} refused: deleting it would leave the app with ${fresh.length} new fault${fresh.length === 1 ? '' : 's'} — ` +
        `repoint or delete the referencing artifact(s) first, then delete again:\n` +
        fresh.map((e) => `  - ${e.file ?? e.path ?? '(app)'}: ${e.message}`).join('\n'),
    };
  }

  /** `export const name = '…'` — the loader-level identity of a handler. The same extraction
   *  `view-spec/validate.ts#exportedName` performs; kept local because that helper is not
   *  exported and a writer-module helper must stay sync + dependency-free. */
  const EXPORTED_NAME_RE = /export\s+const\s+name\s*=\s*['"`]([A-Za-z0-9_-]+)['"`]/;

  /** Every `api/**​/*.ts` handler file, project-relative (the query deleter's scan surface). */
  function apiHandlerFiles(): string[] {
    const out: string[] = [];
    const walk = (dir: string): void => {
      let entries;
      try {
        entries = readdirSync(dir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const e of entries) {
        const abs = join(dir, e.name);
        if (e.isDirectory()) walk(abs);
        else if (e.name.endsWith('.ts')) out.push(relative(projectRoot, abs).split(sep).join('/'));
      }
    };
    walk(safeResolve(projectRoot, 'api'));
    return out.sort();
  }

  function deleteProjectView(route: string): { ok: boolean; error?: string } {
    let rel: string;
    try {
      rel = assertPathSegments('view route', route).replace(/\.(tsx|jsx|json)$/, '');
      if (!ROUTE_RE.test(rel)) {
        throw new Error(
          `view route "${route}" is not a valid route. Routes are lowercase, slash-separated, and ` +
            `may end a segment with a [param]: index, recipes, recipes/[id], searches/[searchId]/inbox.`,
        );
      }
    } catch (e) {
      return { ok: false, error: String(e instanceof Error ? e.message : e) };
    }
    const target = viewSpecPath(rel);
    if (!existsSync(safeResolve(projectRoot, target))) {
      return {
        ok: false,
        error: `no such view: ${target}. listProjectDir('views') lists the routes that really exist — check the spelling (a [param] page lives at '<route>/[id]').`,
      };
    }
    const loaded = loadProjectViews(projectRoot);
    const loadedAfter: LoadedViews = { ...loaded, views: loaded.views.filter((v) => v.route !== rel) };
    const refusal = refuseIfNewFaults(`deleteProjectView("${route}")`, loadedAfter, loadViewContracts(projectRoot).endpoints);
    if (refusal) return refusal;
    const out = deleteUnder(target);
    if (!out.ok) return out;
    try {
      onAppWrite?.('page', rel);
    } catch {
      /* best-effort — the file is already gone */
    }
    return { ok: true };
  }

  function deleteProjectViewComponent(name: string): { ok: boolean; error?: string } {
    if (!COMPONENT_NAME_RE.test(name)) {
      return { ok: false, error: `view component name "${name}" is not PascalCase (expected /${COMPONENT_NAME_RE.source}/)` };
    }
    const target = viewComponentPath(name);
    if (!existsSync(safeResolve(projectRoot, target))) {
      return { ok: false, error: `no such component: ${target}. listProjectDir('components') lists the definitions that really exist.` };
    }
    const loaded = loadProjectViews(projectRoot);
    const loadedAfter: LoadedViews = { ...loaded, components: loaded.components.filter((c) => c.name !== name) };
    const refusal = refuseIfNewFaults(`deleteProjectViewComponent("${name}")`, loadedAfter, loadViewContracts(projectRoot).endpoints);
    if (refusal) return refusal;
    const out = deleteUnder(target);
    if (!out.ok) return out;
    try {
      onAppWrite?.('component', name);
    } catch {
      /* best-effort — the file is already gone */
    }
    return { ok: true };
  }

  function deleteProjectViewLayout(prefix: string): { ok: boolean; error?: string } {
    let rel: string;
    try {
      rel = assertPathSegments('layout prefix', prefix).replace(/\.(tsx|jsx|json)$/, '');
      if (!ROUTE_RE.test(rel)) {
        throw new Error(
          `layout prefix "${prefix}" is not a valid route prefix. Prefixes are lowercase, ` +
            `slash-separated, and may end a segment with a [param]: trips, trips/[tripId].`,
        );
      }
    } catch (e) {
      return { ok: false, error: String(e instanceof Error ? e.message : e) };
    }
    const target = viewLayoutPath(rel);
    if (!existsSync(safeResolve(projectRoot, target))) {
      return { ok: false, error: `no such layout: ${target}. listProjectDir('views') lists the spec tree — a layout is <prefix>/_layout.view.json.` };
    }
    const loaded = loadProjectViews(projectRoot);
    const loadedAfter: LoadedViews = { ...loaded, layouts: loaded.layouts.filter((l) => l.prefix !== rel) };
    const refusal = refuseIfNewFaults(`deleteProjectViewLayout("${prefix}")`, loadedAfter, loadViewContracts(projectRoot).endpoints);
    if (refusal) return refusal;
    const out = deleteUnder(target);
    if (!out.ok) return out;
    try {
      onAppWrite?.('page', rel);
    } catch {
      /* best-effort — the file is already gone */
    }
    return { ok: true };
  }

  function deleteProjectApi(route: string): { ok: boolean; error?: string } {
    let rel: string;
    let target: string;
    let endpointName: string | undefined;
    try {
      rel = assertPathSegments('api route', route);
      const segments = rel.split('/');
      const method = segments.pop() as string;
      if (!METHODS.has(method)) {
        throw new Error(`api route "${route}" has an invalid method "${method}" (expected one of ${[...METHODS].join(', ')})`);
      }
      if (segments.length === 0) {
        throw new Error(`api route "${route}" is missing an endpoint path before the method`);
      }
      target = join('api', ...segments, `${method}.ts`);
      const existing = safeResolve(projectRoot, target);
      if (!existsSync(existing)) {
        return {
          ok: false,
          error: `no such endpoint file: ${target}. listProjectDir('api') lists the real handler dirs — the route encodes the method last (e.g. 'items-list/GET').`,
        };
      }
      endpointName = EXPORTED_NAME_RE.exec(readFileSync(existing, 'utf8'))?.[1];
    } catch (e) {
      return { ok: false, error: String(e instanceof Error ? e.message : e) };
    }
    // A handler with no exported name is referenced by nothing (views bind the NAME), so there is
    // no reference guard to run — deleting it cannot dangle a binding.
    if (endpointName) {
      const refusal = refuseIfNewFaults(
        `deleteProjectApi("${route}")`,
        loadProjectViews(projectRoot),
        loadViewContracts(projectRoot).endpoints.filter((ep) => ep.name !== endpointName),
      );
      if (refusal) return refusal;
    }
    const out = deleteUnder(target);
    if (!out.ok) return out;
    try {
      onAppWrite?.('api', rel);
    } catch {
      /* best-effort — the file is already gone */
    }
    return { ok: true };
  }

  function deleteProjectQuery(name: string): { ok: boolean; error?: string } {
    if (!SLUG_RE.test(name)) {
      return { ok: false, error: `query name "${name}" is not a valid kebab-case id (expected /${SLUG_RE.source}/)` };
    }
    const queryRel = join('api', `${name}.query.json`);
    if (!existsSync(safeResolve(projectRoot, queryRel))) {
      return { ok: false, error: `no such query: api/${name}.query.json. listProjectDir('api') lists what is really there.` };
    }
    // The generated handler is found by its `export const name` (the IR name IS the endpoint
    // name a view binds) rather than by re-deriving the route from the IR — robust even if the
    // IR's route was authored differently than the write-time default.
    const handlerRel = apiHandlerFiles().find((p) => {
      try {
        return EXPORTED_NAME_RE.exec(readFileSync(safeResolve(projectRoot, p), 'utf8'))?.[1] === name;
      } catch {
        return false;
      }
    });
    const refusal = refuseIfNewFaults(
      `deleteProjectQuery("${name}")`,
      loadProjectViews(projectRoot),
      loadViewContracts(projectRoot).endpoints.filter((ep) => ep.name !== name),
    );
    if (refusal) return refusal;
    const queryOut = deleteUnder(queryRel);
    if (!queryOut.ok) return queryOut;
    if (handlerRel) {
      const handlerOut = deleteUnder(handlerRel);
      if (!handlerOut.ok) return handlerOut; // the IR is gone; surface the leftover handler honestly
    }
    try {
      onAppWrite?.('api', name);
    } catch {
      /* best-effort — both files are already gone */
    }
    return { ok: true };
  }

  /** A hook is a CONSUMER — nothing in the app references it (a view never binds a hook), so the
   *  only guards are existence + traversal. The republish inside {@link deleteUnder} re-derives
   *  the webhook manifest and crontab from the hooks that remain. */
  function deleteProjectHook(slug: string): { ok: boolean; error?: string } {
    try {
      assertSlug('hook slug', slug);
    } catch (e) {
      return { ok: false, error: String(e instanceof Error ? e.message : e) };
    }
    const target = join('hooks', `${slug}.ts`);
    if (!existsSync(safeResolve(projectRoot, target))) {
      return { ok: false, error: `no such hook: ${target}. listProjectDir('hooks') lists the slugs that really exist.` };
    }
    return deleteUnder(target);
  }

  /** List `<projectRoot>/<dir>` — project-rooted introspection (the read twin of the writers).
   *  A missing dir returns `entries: []` (not an error) so an agent can safely check "what tables
   *  exist?" on a fresh project. `safeResolve` keeps it inside the project (no traversal). The file
   *  names live in `entries` — never `content`/`raw` (a list has no text). */
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

  /** Read `<projectRoot>/<path>` as UTF-8 text — project-rooted (the read twin of the writers).
   *  The body is the PLAIN, unmodified file text in `content` — there is NO `raw` field and NO
   *  line-numbered variant. (A `.raw` access is a typecheck error; it belongs only to the engineer's
   *  scratch `readFile`, where `content` is line-numbered for display and `raw` is the clean text.
   *  Here `content` is already the clean text, so `.raw` is both wrong and pointless.) */
  function readProjectFile(path: string): { ok: boolean; content: string; error?: string } {
    try {
      const target = safeResolve(projectRoot, path);
      if (!existsSync(target)) return { ok: false, content: '', error: `no such file: ${path}` };
      return { ok: true, content: readFileSync(target, 'utf8') };
    } catch (e) {
      return { ok: false, content: '', error: String(e instanceof Error ? e.message : e) };
    }
  }

  /** `runProjectAppCheck`, reachable from a tasklist code node so a build gate can be
   *  deterministic rather than model-emitted. */
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
          'writeProjectApi / writeProjectView / writeProjectHook / writeProjectEvent / ' +
          'writeProjectFunction) — use the one for the artifact you are authoring, so its ' +
          'contract is checked at write time.',
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
    writeProjectEntity,
    writeProjectApi,
    writeProjectQuery,
    writeProjectView,
    writeProjectViewLayout,
    writeProjectViewComponent,
    writeProjectViewShell,
    deleteProjectView,
    deleteProjectViewComponent,
    deleteProjectViewLayout,
    deleteProjectApi,
    deleteProjectQuery,
    deleteProjectHook,
    // Host-side gates, reachable from a tasklist CODE node (like `buildProjectApp` itself). `16-verify`
    // merges these two structured lists with `buildProjectApp`'s; `17-fix` fans out over the union.
    validateAppViews: () => validateAppViews(opts.projectRoot),
    renderSmokeViews: () => renderSmokeViews(opts.projectRoot, { call: callProjectApi as ApiCaller | undefined }),
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

// ─── Self-authoring (`self:author`) — the per-project THING rewriting its OWN space ──────────────

/** A single kebab slug for a self-knowledge field/aspect (no path separators, no traversal). */
const SELF_SLUG_RE = /^[a-z0-9][a-z0-9-]*$/;

function assertSelfSlug(kind: string, slug: string): string {
  const s = String(slug ?? '').trim();
  if (!SELF_SLUG_RE.test(s)) {
    throw new Error(`${kind} "${slug}" must be a kebab slug (lowercase letters, digits, hyphens)`);
  }
  return s;
}

/**
 * SELF-AUTHORING host globals (`self:author`) — the per-project THING rewriting its OWN space,
 * bound to the project's copy of `user-thing` (`<projectRoot>/spaces/user-thing/`).
 *
 * Additive by construction: {@link appendSelfInstruct} only ever APPENDS a section to the END of
 * `agents/thing/instruct.md` (after the shipped frontmatter and body), so a self-edit accumulates
 * learned project context and can never strip the base persona. Every write stays inside the space
 * root via `safeResolve`. The edit takes effect on the NEXT session, when the merged space reloads.
 */
export function createSelfAuthoringGlobals(opts: { spaceRoot: string }): {
  appendSelfInstruct: (text: string) => { ok: boolean; error?: string };
  writeSelfKnowledge: (field: string, aspect: string, markdown: string) => { ok: boolean; error?: string };
  readSelf: (path?: string) => { ok: boolean; content: string; error?: string };
} {
  const spaceRoot = resolve(opts.spaceRoot);
  const instructRel = join('agents', 'thing', 'instruct.md');

  function appendSelfInstruct(text: string): { ok: boolean; error?: string } {
    try {
      if (typeof text !== 'string' || text.trim().length === 0) {
        return { ok: false, error: 'appendSelfInstruct: text must be a non-empty string' };
      }
      const abs = safeResolve(spaceRoot, instructRel);
      if (!existsSync(abs)) {
        return { ok: false, error: `appendSelfInstruct: this project has no editable THING (missing ${instructRel})` };
      }
      const current = readFileSync(abs, 'utf8');
      const section = `\n\n---\n\n## Learned about this project\n\n${text.trim()}\n`;
      const next = current.replace(/\s*$/, '') + section;
      // Prove the file still splits cleanly into { frontmatter, body } — an EOF append cannot touch
      // the top-of-file frontmatter, but re-parsing is the cheap guarantee the plan asks for.
      parseFrontmatter(next, abs);
      writeFile(abs, next);
      return { ok: true };
    } catch (e) {
      return { ok: false, error: `appendSelfInstruct rejected: ${e instanceof Error ? e.message : String(e)}` };
    }
  }

  function writeSelfKnowledge(field: string, aspect: string, markdown: string): { ok: boolean; error?: string } {
    try {
      const f = assertSelfSlug('knowledge field', field);
      const a = assertSelfSlug('knowledge aspect', aspect);
      if (typeof markdown !== 'string' || markdown.trim().length === 0) {
        return { ok: false, error: 'writeSelfKnowledge: markdown must be a non-empty string' };
      }
      const abs = safeResolve(spaceRoot, join('knowledge', 'self', f, `${a}.md`));
      // A leading `# <aspect>` header guarantees the file is plain body, never mistaken for
      // frontmatter (a `---`-led option file would demand a `description` and fail the space load).
      const body = `# ${a}\n\n${markdown.trim()}\n`;
      writeFile(abs, body);
      return { ok: true };
    } catch (e) {
      return { ok: false, error: `writeSelfKnowledge rejected: ${e instanceof Error ? e.message : String(e)}` };
    }
  }

  function readSelf(path?: string): { ok: boolean; content: string; error?: string } {
    try {
      const rel = path && String(path).trim() ? String(path).trim() : instructRel;
      const abs = safeResolve(spaceRoot, rel);
      if (!existsSync(abs)) return { ok: false, content: '', error: `no such file: ${rel}` };
      return { ok: true, content: readFileSync(abs, 'utf8') };
    } catch (e) {
      return { ok: false, content: '', error: String(e instanceof Error ? e.message : e) };
    }
  }

  return { appendSelfInstruct, writeSelfKnowledge, readSelf };
}
