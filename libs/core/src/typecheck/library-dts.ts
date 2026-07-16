import { catalogDts } from '../ui/catalog.js';

/**
 * Ambient declarations for the value-yielding ORCHESTRATION globals, split out
 * per-global so `buildAmbientDts` (exec/bootstrap.ts) can compose each VM
 * context's DTS additively:
 *   - session: all of them
 *   - delegate: everything except `ask`
 *   - fork leaf: none of them; `delegate` is added back only when the task opts
 *     in via `canDelegateTo`
 * A global that is not declared fails typecheck on a stray call — a clean,
 * retryable error — instead of passing typecheck and throwing at runtime.
 */
export const ASK_DTS = `declare function ask<T = unknown>(descriptor: JSXDescriptor | string): Promise<T>;`;
// setSessionMeta() names the current conversation. Session-only (like ask): absent
// from fork/delegate DTS so a stray call there fails typecheck.
export const SET_SESSION_META_DTS = `/** Set the current session's human-readable title and/or URL-safe slug. Top-level session only. */
declare function setSessionMeta(meta: { title?: string; slug?: string }): Promise<{ ok: boolean }>;`;
// tasklist() resolves to a TaskEnvelope: { ok: boolean; degraded: boolean; data: <goal output>;
// reason?: string; degradedTasks?: string[] }. Branch on r.ok / r.degraded; the payload is r.data.
// Declared `any` by convention so r.data.field reads without casts.
export const TASKLIST_DTS = `/** Runs a named tasklist. Resolves to { ok, degraded, data, reason?, degradedTasks? } — branch on r.ok/r.degraded; the goal output is r.data. */
declare function tasklist(name: string, seed?: Record<string, unknown>): Promise<any>;`;
export const FORK_DTS = `declare function fork<T>(opts: ForkOpts<T>): Promise<T>;`;
export const DELEGATE_DTS = `declare function delegate(packageName: string, agentName: string, opts?: DelegateOpts): Promise<any>;
declare function delegate(packageName: string, agentName: string, action?: string, opts?: DelegateOpts): Promise<any>;`;

/**
 * Declarations present in EVERY VM context (session, fork leaf, delegate): the
 * non-orchestration globals, supporting interfaces, host-injected primitives and
 * the design-system catalog. NOTE: `registerSpace` stays declared even where the
 * global is not injected (read-only fork roles, delegates) — matching the
 * pre-unification DTS, where only ask/tasklist/fork/delegate were stripped.
 */
export const COMMON_DTS = `
declare function display(descriptor: unknown): void;
/** Set the live "currently doing" status shown in the UI while you work. Fire-and-forget — does NOT end the turn, so call it inline as you progress. Pass '' to clear. */
declare function setActivity(text: string): void;
declare function inspect(...args: (unknown | [unknown, InspectQuery])[]): Promise<void>;
declare function loadKnowledge(...path: string[]): Promise<any>;
declare function sleep(duration: string): Promise<void>;
declare function registerSpace(dir: string): Promise<{ ok: boolean; spaceKey: string; agentSlug: string; error?: string }>;

declare interface JSXDescriptor {
  type: string | ((...args: unknown[]) => unknown);
  props: Record<string, unknown>;
  children?: JSXDescriptor[];
}

// Classic JSX factory — declared globally so <Foo /> syntax typechecks without imports
declare namespace React {
  function createElement(type: any, props?: Record<string, unknown> | null, ...children: any[]): JSXDescriptor;
  const Fragment: string;
}
// JSX namespace for classic transform intrinsics
declare namespace JSX {
  interface Element extends JSXDescriptor {}
  interface IntrinsicElements {
    [elemName: string]: Record<string, unknown>;
  }
  // Models reflexively write key={i} inside .map() loops (React muscle memory).
  // Accept it on every component instead of failing the statement — the renderer
  // simply ignores it.
  interface IntrinsicAttributes {
    key?: string | number;
  }
}

declare interface InspectQuery {
  path?: string;
  slice?: [number, number];
  depth?: number;
  filter?: string;
  sample?: number;
  keys?: boolean;
  count?: boolean;
  search?: string;
}

declare interface ForkOpts<T> {
  instruction: string;
  output: Record<string, string>;
  seed?: Record<string, unknown>;
  timeout?: number;
  /** 'explore'/'plan' run read-only (cannot write/edit/mutate); 'general' (default) has the full toolkit. */
  role?: 'explore' | 'plan' | 'general';
}

declare interface DelegateOpts {
  query?: string;
  context?: unknown;
  /** Upload ids of image/file attachments to hand to the delegated agent (e.g. an
   *  image to a vision agent). Read the ids from your user message's attachment list. */
  attachmentIds?: string[];
}

// Host-injected globals available in space functions and agent code
declare function fetch(url: string, opts?: { method?: string; headers?: Record<string, string>; body?: string }): Promise<{ ok: boolean; status: number; text(): string; json(): unknown }>;
declare function readDocument(attachmentId: string, opts?: { maxChars?: number }): Promise<{ ok: boolean; attachmentId: string; mediaType: string; filename?: string; kind: 'text' | 'unsupported'; text?: string; truncated?: boolean; error?: string }>;
// integrationStatus(spaceId): presence-only config status of an installed integration
// space in this project (injected for project-rooted sessions). missingRequired = the
// NAMES (never values) of required env vars not yet set; ready = all required set.
declare function integrationStatus(spaceId: string): Promise<{ ready: boolean; missingRequired: string[] }>;
declare const process: { env: Record<string, string | undefined>; exit(code?: number): never };
declare function typecheckSource(src: string): { ok: boolean; errors: string[] };
declare function spacePath(...parts: string[]): string;
declare function resolveSpaceDir(space: string): string;
declare function progress(): { episodes: number; toolCalls: number; elapsedMs: number };
` + '\n' + catalogDts();

/**
 * Raw fs/shell primitives. These are NO LONGER emitted in any agent's model
 * ambient DTS by default — `readFileRaw`/`writeFileRaw` are internal-only host
 * primitives (memory/todos + the architect builder functions call them in their
 * bodies, which are NOT typechecked against the model DTS), and `execShell` is
 * emitted ONLY for the engineer's `fs:scratch` sandbox (where it is the
 * scratch-rooted variant). They stay bundled into `LIBRARY_DTS`/`LIBRARY_DTS_NO_ASK`
 * below solely so `typecheckSource` (host-tools.ts) keeps the FULL global set when
 * it checks a standalone space-function source. See exec/bootstrap.ts buildAmbientDts.
 */
export const EXEC_SHELL_DTS = `declare function execShell(cmd: string, opts?: { timeout?: number }): { ok: boolean; stdout: string; stderr: string; exitCode: number };`;
export const WRITE_FILE_RAW_DTS = `declare function writeFileRaw(path: string, content: string): { ok: boolean; bytes: number; error?: string };`;
export const READ_FILE_RAW_DTS = `declare function readFileRaw(path: string, opts?: { offset?: number; limit?: number }): { ok: boolean; content: string; lines: number; truncated: boolean; error?: string };`;

/**
 * `fs:scratch` earns `createScratch` — the engineer creates a throwaway
 * `.lmthing/scratch/<random>` sandbox and returns its path; all of the engineer's
 * generic fs (its `readFile`/`writeFile`/`editFile`/`listDir`/`glob`/`grep` wrapper
 * functions + a scratch-rooted `execShell`) resolve inside it. Emitted alongside
 * `EXEC_SHELL_DTS` only when `caps.scratchFs`; the six wrapper signatures arrive via
 * the source-extracted overlay.
 */
export const SCRATCH_DTS = `/** Create (once) a throwaway scratch directory and return its absolute path. Call before any file/shell op. */
declare function createScratch(): string;`;

/**
 * App-capability globals (project-as-application). Each fragment is emitted ONLY
 * when the owning agent holds the capability — the integrator gates them per
 * `allowWrite`/per-capability in `buildAmbientDts`. Kept dependency-free (no
 * import from `db/`); the precise row/schema types are generated in Phase 4.
 *
 * In the AGENT sandbox `db.*` is a SYNCHRONOUS host call (non-Promise), whereas
 * `apiCall` is value-yielding and therefore returns a Promise.
 */

// `db:read` members — reads against the project database.
export const DB_READ_MEMBERS = `  query(table: string, opts?: { where?: Record<string, unknown>; include?: string[]; orderBy?: string | { column: string; dir?: 'asc' | 'desc' }; limit?: number; offset?: number }): any[];
  tables(): string[];`;

// `db:write` members — row mutations.
export const DB_WRITE_MEMBERS = `  insert(table: string, values: Record<string, unknown> | Record<string, unknown>[]): any;
  update(table: string, opts: { where: Record<string, unknown>; set: Record<string, unknown> }): number;
  remove(table: string, opts: { where: Record<string, unknown> }): number;`;

// `db:schema` members — DDL.
export const DB_SCHEMA_MEMBERS = `  createTable(schema: any): void;
  addColumn(table: string, name: string, column: any): void;`;

/**
 * Compose the single `declare const db` from whichever of the three db capabilities
 * are present. All db members live on ONE `db` object, so we cannot emit three
 * separate `declare const db` blocks — we union the present member strings into a
 * single declaration. Returns `''` when none are present (so the `db` global fails
 * typecheck on a stray call in a VM without any db capability).
 */
export function composeDbDts(present: { read?: boolean; write?: boolean; schema?: boolean }): string {
  const members: string[] = [];
  if (present.read) members.push(DB_READ_MEMBERS);
  if (present.write) members.push(DB_WRITE_MEMBERS);
  if (present.schema) members.push(DB_SCHEMA_MEMBERS);
  if (members.length === 0) return '';
  return `declare const db: {\n${members.join('\n')}\n};`;
}

// Standalone `declare function` capability fragments.
// `apiCall` is value-yielding → Promise; the write helpers are synchronous host calls.
export const API_CALL_DTS = `declare function apiCall(name: string, input?: unknown): Promise<any>;`;

/**
 * `connections:use` earns `callConnection` — an authenticated request to a
 * user-connected external service through the gateway egress proxy. Value-yielding
 * (Promise). The `provider` parameter is typed to the UNION of the granted
 * providers (built per-grant in `buildAppCapabilityDts`), so a call to a provider
 * the agent didn't declare fails typecheck. `data` is `any` by convention so
 * `r.data.field` reads without a cast. Emitted only when the grant is present.
 */
export function composeConnectionsDts(providers: string[]): string {
  const union = providers.length ? providers.map((p) => `'${p}'`).join(' | ') : 'string';
  return `declare function callConnection(provider: ${union}, req: { method: string; path: string; query?: Record<string, string>; body?: unknown; headers?: Record<string, string> }): Promise<{ ok: boolean; status: number; data: any }>;`;
}

export const PAGES_WRITE_DTS = `declare function writePage(route: string, src: string): { ok: boolean; error?: string };`;
export const API_WRITE_DTS = `declare function writeApi(route: string, src: string): { ok: boolean; error?: string };`;
export const HOOKS_WRITE_DTS = `declare function writeHook(slug: string, src: string): { ok: boolean; error?: string };`;

// `pages:write`/`api:write` ALSO earn the plan-S11 LIVE-PROJECT twins — `writeProjectPage`
// (`pages/<route>.tsx`) and `writeProjectApi` (`api/<path>/<METHOD>.ts`) — which write the UI
// into the session's OWN project (not the store catalog) and rebuild the served app, so "turn
// this into an app I can open" produces a real page-serving app in the live project rather than
// dead-ending (the automator had only writeProjectTable — scenario 05). Appended to the catalog
// writers in the capability registry; the one-liner invariant on the base consts is preserved.
// Overwriting an existing page is GUARDED: a replacement that fetches none of the API routes the
// page it replaces fetched is rejected (it would delete the sections the user already has — the
// app still builds and every route still 200s, but the user opens it to an empty page; scenario
// 07). Read the page and extend it; `{ replace: true }` says the deletion is what the user asked for.
export const PROJECT_PAGE_DTS = `declare function writeProjectPage(route: string, src: string, opts?: { replace?: boolean }): { ok: boolean; error?: string };`;
export const PROJECT_API_DTS = `declare function writeProjectApi(route: string, src: string): { ok: boolean; error?: string };`;
// `pages:write` ALSO earns the shared-component writer — `writeProjectComponent` writes
// `components/<Name>.tsx` (PascalCase) into the live project so a page can import it. The
// typed surface for shared UI (there is no space-rooted fs writer for components anymore).
export const PROJECT_COMPONENT_DTS = `declare function writeProjectComponent(name: string, src: string): { ok: boolean; error?: string };`;

// `hooks:write` ALSO earns the plan-S11 LIVE-PROJECT authoring writers — the automator
// authors event hooks (`hooks/<slug>.ts`) + emitter defs (`events/<name>.ts`) and the
// engineer authors project functions (`functions/<name>.ts`), all into the session's OWN
// project (not the store catalog) with a republish so the change goes live immediately.
// Synchronous host calls like the catalog writers. Appended to HOOKS_WRITE_DTS in the
// capability registry (kept a separate const so the one-liner invariant on HOOKS_WRITE_DTS
// holds).
export const PROJECT_AUTHORING_DTS = `declare function writeProjectHook(slug: string, src: string): { ok: boolean; error?: string };
declare function writeProjectEvent(name: string, src: string): { ok: boolean; error?: string };
declare function writeProjectFunction(name: string, src: string): { ok: boolean; error?: string };`;

// `db:schema` also earns `writeTableSchema` — the AUTHORING form that writes a
// `database/<name>.json` schema file into the catalog app (distinct from the runtime
// `db.createTable` migration on `db`). Emitted alongside `composeDbDts` when db:schema
// is granted (see buildAppCapabilityDts) — kept OUT of composeDbDts because it is a
// standalone global, not a member of the `db` object.
export const WRITE_TABLE_SCHEMA_DTS = `declare function writeTableSchema(name: string, schema: unknown): { ok: boolean; error?: string };`;

// `db:schema` ALSO earns the LIVE-PROJECT table writer, the twin of the S11 live hook/
// event/function writers: `writeTableSchema` targets a store/projects/<id>/ TEMPLATE,
// while `writeProjectTable` writes `database/<name>.json` into the project the session is
// actually running in and re-derives its db (a project with no table has no db at all).
// Emitted only when the host supplies the impl (i.e. a project-rooted session), so a
// catalog-only appbuilder session leaves it absent and a stray call fails typecheck.
// The optional third arg SEEDS rows at table-creation time (host-side insert after the db
// re-derives), so KNOWN data the user gave you to "move into the app" lands in one pass — the
// agent can't insert into a table it just created (`db` isn't injected until a table exists).
export const PROJECT_TABLE_DTS = `declare function writeProjectTable(name: string, schema: unknown, rows?: Array<Record<string, unknown>>): { ok: boolean; error?: string };`;

// The read-side twins of the writeProject* writers — PROJECT-ROOTED introspection. `listProjectDir`
// lists the files under `<projectRoot>/<dir>` (a missing dir returns `entries: []`); `readProjectFile`
// reads a project file's text. These resolve against the PROJECT, unlike the space-rooted
// `execShell`/`readFileRaw` (+ the `listDir`/`readFile` system-global wrappers), which root at the
// agent's OWN `LMTHING_SPACE_DIR` — a footgun for a delegated system-space agent whose space dir is
// its source tree. A project-authoring agent uses THESE to see what already exists in the project.
// Emitted on any db grant + a project-rooted session (see buildAppCapabilityDts / injectAppGlobals).
export const PROJECT_READ_DTS = `declare function listProjectDir(dir: string): { ok: boolean; entries: string[]; error?: string };
declare function readProjectFile(path: string): { ok: boolean; content: string; error?: string };`;

// `project:manage` — the appbuilder's authority to scaffold or bind a catalog app.
// createProject creates a NEW store/apps/<id>/ template + selects it as the authoring
// target; selectProject binds an existing one. Subsequent writePage/writeApi/... land
// in the currently-selected app. Synchronous host calls.
export const PROJECT_MANAGE_DTS = `declare function createProject(id: string, opts?: { title?: string }): { ok: boolean; appId?: string; root?: string; error?: string };
declare function selectProject(id: string): { ok: boolean; appId?: string; root?: string; error?: string };`;

// `store:read` earns the two catalog-discovery globals (plan S10). Both are
// value-yielding (Promise); entries are the store catalog records VERBATIM
// (S12-enriched fields flow through), `any` by convention so `entry.field`
// reads without casts.
export const STORE_READ_DTS = `/** Search the lmthing store's space catalog (id/title/description/tag match; omit query for the full catalog). */
declare function storeSearch(query?: string): Promise<any[]>;
/** The full catalog entry for one store space, or undefined when the id is not in the catalog. */
declare function storeInspect(spaceId: string): Promise<any>;`;

// `store:install` earns the CONSENT-MARKED `installSpace` (plan S10): the host
// asks the user for approval before installing; denial rejects the call. On
// success the space is installed into the CURRENT project AND live-registered —
// spaceKey/agentSlug are ready for delegate(). ok:false + diverged:true means
// local edits were held back (relay the message to the user).
export const STORE_INSTALL_DTS = `/** Install a store space into the current project and live-register it for delegate(). Asks the user for consent first; denial rejects. */
declare function installSpace(spaceId: string): Promise<{ ok: boolean; spaceId: string; projectId?: string; spaceKey?: string; agentSlug?: string; diverged?: boolean; message?: string; error?: string }>;`;

// `events:emit` earns `emitEvent` (plan S10) — publish an event DECLARED by the
// agent's OWN scope's `events/*.ts` defs into the hook pipeline. Undeclared
// names / schema-mismatched payloads reject; `event` in the result is the
// source-qualified address (`<scope>/<name>`).
export const EVENTS_EMIT_DTS = `/** Publish an event declared by this scope's events/ defs; subscribing event hooks run before this resolves. */
declare function emitEvent(name: string, payload: Record<string, unknown>): Promise<{ ok: boolean; event: string }>;`;

// Emitted on the `knowledge:write` grant. Synchronous (not a Promise) like the other
// authoring writers. Own-space only: there is no `space` parameter — the host binds the
// write root to the running agent's own knowledge dir.
export const KNOWLEDGE_WRITE_DTS = `/** Author a knowledge option into THIS agent's own space at knowledge/<domain>/<field>/<option>.md (option 'index' is reserved). opts.source tags provenance for later conflict resolution. */
declare function writeKnowledge(domain: string, field: string, option: string, markdown: string, opts?: { source?: 'user' | 'researched' | 'agent' }): { ok: boolean; path: string; error?: string };`;

/**
 * Registry of the STANDALONE app-capability fragments, keyed by capability id, for
 * the integrator to gate additively per agent in `buildAmbientDts`. The `db:*` trio
 * (`db:read`/`db:write`/`db:schema`) is NOT in this flat map — because all three
 * share one `db` object they are composed together via `composeDbDts` (db:schema also
 * emits the standalone `WRITE_TABLE_SCHEMA_DTS`, handled in buildAppCapabilityDts).
 */
export const CAPABILITY_DTS_FRAGMENTS: Record<string, string> = {
  'api:call': API_CALL_DTS,
  'pages:write': [PAGES_WRITE_DTS, PROJECT_PAGE_DTS, PROJECT_COMPONENT_DTS].join('\n'),
  'api:write': [API_WRITE_DTS, PROJECT_API_DTS].join('\n'),
  'hooks:write': [HOOKS_WRITE_DTS, PROJECT_AUTHORING_DTS].join('\n'),
  'knowledge:write': KNOWLEDGE_WRITE_DTS,
  'project:manage': PROJECT_MANAGE_DTS,
  'store:read': STORE_READ_DTS,
  'store:install': STORE_INSTALL_DTS,
  'events:emit': EVENTS_EMIT_DTS,
};

// Raw fs/shell primitives, appended to the full-DTS bundles below. `host-tools.ts`'s
// `typecheckSource` needs the FULL global set (incl. execShell/writeFileRaw/readFileRaw
// — the architect builder functions reference them in their bodies), so the LIBRARY_DTS
// bundles re-append these fragments even though the per-agent model DTS (buildAmbientDts)
// no longer emits them by default.
const WRITE_PRIMITIVES_DTS = [EXEC_SHELL_DTS, WRITE_FILE_RAW_DTS, READ_FILE_RAW_DTS].join('\n');

/** Full library DTS for the top-level session VM (all globals, incl. `ask`). */
export const LIBRARY_DTS = [ASK_DTS, SET_SESSION_META_DTS, TASKLIST_DTS, FORK_DTS, DELEGATE_DTS, COMMON_DTS, WRITE_PRIMITIVES_DTS].join('\n');

/**
 * Library DTS WITHOUT `ask`. Fork and delegate VMs run headless/autonomous — there is
 * no interactive user to prompt — so `ask` is not injected there. Removing its
 * declaration makes a stray `await ask(...)` fail typecheck immediately ("Cannot find
 * name 'ask'") and steers the model back to working from its seed/inputs, instead of
 * binding `undefined` (or, in a real PTY, blocking forever on stdin).
 */
export const LIBRARY_DTS_NO_ASK = [TASKLIST_DTS, FORK_DTS, DELEGATE_DTS, COMMON_DTS, WRITE_PRIMITIVES_DTS].join('\n');
