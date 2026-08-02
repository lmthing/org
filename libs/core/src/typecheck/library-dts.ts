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
// from fork/delegate DTS so a stray call there fails typecheck. Fire-and-forget
// (synchronous, does NOT end the turn) — so it can be called inline alongside work.
export const SET_SESSION_META_DTS = `/** Name the current conversation (human-readable title + URL-safe slug). Fire-and-forget — does NOT end the turn, so call it inline. Top-level session only. */
declare function setSessionMeta(meta: { title?: string; slug?: string }): { ok: boolean };`;
// tasklist() resolves to a TaskEnvelope: { ok: boolean; degraded: boolean; data: <goal output>;
// reason?: string; degradedTasks?: string[] }. Branch on r.ok / r.degraded; the payload is r.data.
// Declared `any` by convention so r.data.field reads without casts.
export const TASKLIST_DTS = `/** Runs a named tasklist. Resolves to { ok, degraded, data, reason?, degradedTasks? } — branch on r.ok/r.degraded; the goal output is r.data. */
declare function tasklist(name: string, seed?: Record<string, unknown>): Promise<any>;`;
export const FORK_DTS = `declare function fork<T>(opts: ForkOpts<T>): Promise<T>;`;
export const DELEGATE_DTS = `declare function delegate(packageName: string, agentName: string, opts?: DelegateOpts): Promise<any>;
declare function delegate(packageName: string, agentName: string, action?: string, opts?: DelegateOpts): Promise<any>;`;

/**
 * `registerSpace()` — load a directory as a space and register it into the LIVE
 * runtime, so a later `delegate()` can reach it by the returned key.
 *
 * Emitted by `buildAmbientDts` ONLY when `caps.registerSpace` (write-capable fork
 * roles — where the architect's `register`/`reregister` nodes actually run). It used
 * to sit in `COMMON_DTS`, declared unconditionally "matching the pre-unification DTS,
 * where only ask/tasklist/fork/delegate were stripped" — which broke the invariant the
 * whole capability→{inject, dts} registry exists to hold: in a delegate and in a
 * read-only fork the global is NOT injected, so `await registerSpace(dir)` typechecked
 * and then threw at runtime, instead of failing typecheck cleanly and retryably.
 */
export const REGISTER_SPACE_DTS = `declare function registerSpace(dir: string): Promise<{ ok: boolean; spaceKey: string; agentSlug: string; error?: string }>;`;

/**
 * Declarations present in EVERY VM context (session, fork leaf, delegate): the
 * non-orchestration globals, supporting interfaces, host-injected primitives and
 * the design-system catalog. Everything here is injected unconditionally by
 * `injectHostTools`, which is what earns it an unconditional declaration — a global
 * whose injection is gated belongs in its own fragment, gated the same way.
 */
export const COMMON_DTS = `
// console IS injected in every VM (host substrate). Declared here because the
// checker runs with types:[] — nothing may lean on an ambient @types/node.
declare const console: {
  log(...args: unknown[]): void;
  error(...args: unknown[]): void;
  warn(...args: unknown[]): void;
  info(...args: unknown[]): void;
  debug(...args: unknown[]): void;
};
declare function display(descriptor: unknown): void;
/** Set the live "currently doing" status shown in the UI while you work. Fire-and-forget — does NOT end the turn, so call it inline as you progress. Pass '' to clear. */
declare function setActivity(text: string): void;
declare function inspect(...args: (unknown | [unknown, InspectQuery])[]): Promise<void>;
declare function loadKnowledge(...path: (string | string[])[]): Promise<any>;
declare function sleep(duration: string): Promise<void>;

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
declare function readDocument(attachmentId: string, opts?: { maxChars?: number }): Promise<{ ok: boolean; attachmentId: string; mediaType: string; filename?: string; kind: 'text' | 'unsupported'; text?: string; truncated?: boolean; error?: string }>;
// integrationStatus(spaceId): presence-only config status of an installed integration
// space in this project (injected for project-rooted sessions). missingRequired = the
// NAMES (never values) of required env vars not yet set; ready = all required set.
declare function integrationStatus(spaceId: string): Promise<{ ready: boolean; missingRequired: string[] }>;
declare function typecheckSource(src: string): { ok: boolean; errors: string[] };
declare function spacePath(...parts: string[]): string;
declare function resolveSpaceDir(space: string): string;
declare function progress(): { episodes: number; toolCalls: number; elapsedMs: number };
` + '\n' + catalogDts();

/**
 * `execShell`, and the ONE surface it is declared on.
 *
 * `readFileRaw`/`writeFileRaw` have no DTS fragment at all: they are internal-only
 * host primitives (memory/todos + the architect builder functions call them in their
 * bodies, which are NOT typechecked against any DTS), so nothing should ever be able
 * to name them and typecheck. `execShell` is emitted ONLY for the engineer's
 * `fs:scratch` sandbox, where it is the scratch-rooted variant — see
 * `exec/bootstrap.ts#buildAmbientDts`.
 *
 * The three used to be re-appended to `LIBRARY_DTS`/`LIBRARY_DTS_NO_ASK` so that
 * `typecheckSource` (host-tools.ts) checked a standalone space-function source against
 * the FULL global set. That bought nothing: `typecheckSource` already DROPS "Cannot
 * find name" diagnostics (TS2304/2552) because one function may legitimately reference
 * sibling functions absent from an isolated check, so an undeclared `execShell(...)` in
 * a builder body was never going to be reported either way. What the re-append DID do
 * was keep three raw fs/shell primitives alive in a bundle exported from the package
 * index — a surface with no reader and a plain downside.
 */
export const EXEC_SHELL_DTS = `declare function execShell(cmd: string, opts?: { timeout?: number }): { ok: boolean; stdout: string; stderr: string; exitCode: number };`;

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
 * The person's OWN machine, through the LMThing desktop app — emitted only under `fs:local:read`.
 *
 * Every signature takes a `rootId` and a RELATIVE path, and there is no absolute-path form
 * anywhere: a path outside the granted folders is not rejected, it is inexpressible. That is the
 * security design (`apps/desktop/src-tauri/src/grants.rs` is the enforcement), and stating it in
 * the DTS is what makes an agent write correct calls in the first place rather than discover the
 * rule from a refusal.
 *
 * Batch-shaped deliberately: each of these is a WAN round trip to somebody's laptop.
 */
export const LOCAL_FS_READ_DTS = `/** Folders the person has granted this workspace. Empty when no desktop is connected. */
declare function localRoots(): Promise<Array<{ id: string; label: string; mode: 'ro' | 'rw' }>>;
/** List a granted folder (recursively). \`path\` is relative to the root; omit for its top level. */
declare function localTree(rootId: string, path?: string): Promise<{ ok: boolean; entries: Array<{ path: string; kind: 'file' | 'dir'; size: number }>; truncated: boolean; error?: string }>;
/** Metadata for one entry. */
declare function localStat(rootId: string, path: string): Promise<{ ok: boolean; kind?: 'file' | 'dir'; size?: number; mtime?: number; error?: string }>;
/** Read a file inside a granted folder. Use \`offset\`/\`limit\` for large files rather than fetching them whole. */
declare function localRead(rootId: string, path: string, opts?: { offset?: number; limit?: number }): Promise<{ ok: boolean; content: string; lines: number; truncated: boolean; error?: string }>;
/** Search a granted folder. Prefer this to walking the tree yourself — one round trip instead of many. */
declare function localSearch(rootId: string, query: string, opts?: { path?: string }): Promise<{ ok: boolean; hits: Array<{ path: string; line: number; text: string }>; truncated: boolean; error?: string }>;`;

/**
 * Raw DevTools Protocol — emitted only under `browser:cdp`, the narrowest grant in the system.
 *
 * Declared with the danger stated, because the model reads this and nothing else about the tool:
 * an agent that knows `Runtime.evaluate` runs inside the person's signed-in session will reach for
 * the 27 curated `system-browser` functions first, which is the intended order.
 */
export const HOST_CDP_DTS = `/** Send one Chrome DevTools Protocol command to the browser shown in the LMThing desktop app.
 *  This browser is signed into the person's real accounts — prefer the \`browser\` agent's goto/click/extract
 *  functions, and use this only for what they cannot express. Each call asks the person for approval. */
declare function cdp(method: string, params?: Record<string, unknown>): Promise<{ ok: boolean; result?: unknown; error?: string }>;
/** Start collecting events from a CDP domain ('Network', 'Console', 'Page', …). */
declare function cdpSubscribe(domain: string): Promise<{ ok: boolean; error?: string }>;
/** Drain the CDP events collected since the last call. */
declare function cdpEvents(): Promise<{ ok: boolean; events: Array<{ method: string; params?: unknown }>; error?: string }>;`;

/** The write half — emitted only under `fs:local:write`, and refused by roots granted read-only. */
export const LOCAL_FS_WRITE_DTS = `/** Create or replace a file inside a granted folder. Fails when the grant is read-only. */
declare function localWrite(rootId: string, path: string, content: string): Promise<{ ok: boolean; bytes: number; error?: string }>;`;

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

// `db:write` members — row mutations. NOTE: `remove` (hard delete) is DELIBERATELY absent from every
// model surface. A destructive delete is a host-only primitive available ONLY to tasklist code nodes
// (via their injected `ctx.db.remove`), so an agent can never delete a row inline — it must route the
// deletion through a guarded tasklist (`retract_fact`, `resolve_flagged_figure`) whose code node
// verifies the delete before it happens. A stray `db.remove(...)` in agent code is a typecheck error.
export const DB_WRITE_MEMBERS = `  insert(table: string, values: Record<string, unknown> | Record<string, unknown>[]): any;
  update(table: string, opts: { where: Record<string, unknown>; set: Record<string, unknown> }): number;`;

// `db:schema` members — DDL. Always LOOSE (`string`): schema authoring is open-table
// (it INVENTS new table/column names), so it is never gated by the current schema.
export const DB_SCHEMA_MEMBERS = `  createTable(schema: any): void;
  addColumn(table: string, name: string, column: any): void;`;

/**
 * One table's name + its column names, the minimum a per-run schema needs to gate
 * `db.*` at typecheck time. Derived cheaply from the project's `database/<name>.json`
 * basenames + column keys by the host (NOT the heavy `ts-json-schema-generator`) and
 * threaded to `composeDbDts` via the ambient-DTS builder.
 */
export interface DbTableSchema {
  /** The table name — the `database/<name>.json` basename. */
  name: string;
  /** The column names (the keys of the table's `columns`). */
  columns: string[];
}

/**
 * Column-GATED (generic) READ/WRITE members, emitted in place of the loose `string`
 * members when a real per-run schema is supplied AND the agent is not a schema author.
 * `<T extends keyof __DbCols>` binds `table` to a real table name (a hallucinated table
 * is not in `keyof __DbCols` ⇒ typecheck error) and `Partial<Record<__DbCols[T], unknown>>`
 * binds `where`/`set`/`values` keys + `orderBy` to THAT table's columns (a typo'd column
 * is an excess property ⇒ typecheck error). A dynamic/`any`-typed table arg still resolves
 * (T ⇒ `any`), and `tables()` yields the table-name union so an enumerate-then-query loop
 * still typechecks. Values stay `unknown` — only NAMES are gated, never value types.
 */
export const DB_READ_MEMBERS_TYPED = `  query<T extends keyof __DbCols>(table: T, opts?: { where?: Partial<Record<__DbCols[T], unknown>>; include?: string[]; orderBy?: __DbCols[T] | { column: __DbCols[T]; dir?: 'asc' | 'desc' }; limit?: number; offset?: number }): any[];
  tables(): (keyof __DbCols)[];`;
export const DB_WRITE_MEMBERS_TYPED = `  insert<T extends keyof __DbCols>(table: T, values: Partial<Record<__DbCols[T], unknown>> | Partial<Record<__DbCols[T], unknown>>[]): any;
  update<T extends keyof __DbCols>(table: T, opts: { where: Partial<Record<__DbCols[T], unknown>>; set: Partial<Record<__DbCols[T], unknown>> }): number;`;

/** The `type __DbCols = { <table>: <col> | <col> ; … }` map the gated members index into.
 *  Names are JSON-quoted so kebab-case table names / arbitrary column names are legal type
 *  keys; an empty column list degrades to `never` (every column then errors — a real table
 *  always has at least its primary key). */
function dbColsType(tables: DbTableSchema[]): string {
  const entries = tables.map(
    (t) => `${JSON.stringify(t.name)}: ${t.columns.length ? t.columns.map((c) => JSON.stringify(c)).join(' | ') : 'never'}`,
  );
  return `type __DbCols = { ${entries.join('; ')} };`;
}

/**
 * Compose the single `declare const db` from whichever of the three db capabilities
 * are present. All db members live on ONE `db` object, so we cannot emit three
 * separate `declare const db` blocks — we union the present member strings into a
 * single declaration. Returns `''` when none are present (so the `db` global fails
 * typecheck on a stray call in a VM without any db capability).
 *
 * When `tables` (the real per-run schema) is supplied AND the agent is NOT a schema
 * author (`!present.schema`), the read/write members are GATED: `table`/column names are
 * constrained to compile-time literal unions derived from the schema, so a hallucinated
 * table or a typo'd column FAILS typecheck (retryable) instead of throwing at runtime. A
 * db:schema holder creates tables mid-session (open table set), so it stays loose; absent
 * or empty `tables` (a non-project session, or the schema not threaded on this path) also
 * stays loose — the same permissive `string`-typed members as before.
 */
export function composeDbDts(
  present: { read?: boolean; write?: boolean; schema?: boolean },
  tables?: DbTableSchema[],
): string {
  const gated = !present.schema && Array.isArray(tables) && tables.length > 0;
  const members: string[] = [];
  if (present.read) members.push(gated ? DB_READ_MEMBERS_TYPED : DB_READ_MEMBERS);
  if (present.write) members.push(gated ? DB_WRITE_MEMBERS_TYPED : DB_WRITE_MEMBERS);
  if (present.schema) members.push(DB_SCHEMA_MEMBERS);
  if (members.length === 0) return '';
  const decl = `declare const db: {\n${members.join('\n')}\n};`;
  return gated ? `${dbColsType(tables!)}\n${decl}` : decl;
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

// `api:write` earns the plan-S11 LIVE-PROJECT endpoint writer — `writeProjectApi`
// (`api/<path>/<METHOD>.ts`) — which writes into the session's OWN project (the store-catalog
// `writeApi` writer is gone) and republishes, so "turn this into an app I can open" produces a
// real serving app in the live project. One-liner invariant preserved.
//
// `writeProjectQuery` is the DECLARATIVE counterpart (W7, §7): most endpoints are projections
// (list/get/aggregate/create/update/toggle), not programs — author the IR and the handler is
// GENERATED straight to `api/<route>/<METHOD>.ts`, so it cannot disagree with its own contract.
// Prefer it; keep `writeProjectApi`/`api/<name>.handler.ts` for the genuinely bespoke endpoint.
export const PROJECT_API_DTS = `declare function writeProjectApi(route: string, src: string): { ok: boolean; error?: string };
/** Declarative endpoint (api/<name>.query.json) — the handler is GENERATED, never hand-written. Prefer this over writeProjectApi for a list/get/aggregate/create/update/toggle. */
declare function writeProjectQuery(name: string, query: {
  kind: 'list' | 'get' | 'aggregate' | 'create' | 'update' | 'toggle';
  entity: string;
  route: string;
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  description?: string;
  where?: Array<{ field: string; op: '=' | '!=' | 'in' | 'not-in' | 'gt' | 'gte' | 'lt' | 'lte' | 'contains' | 'is-null' | 'not-null'; input?: string; value?: unknown; default?: unknown }>;
  order?: Array<{ field: string; dir?: 'asc' | 'desc' }>;
  limit?: number | { input?: string; default: number; max?: number };
  include?: string[];
  compute?: Record<string, unknown>;
  set?: Record<string, { input: string; optional?: boolean } | { value: unknown }>;
  toggleField?: string;
}): { ok: boolean; error?: string };`;

// `views:write` — the ONLY UI-authoring capability, and the mechanism behind the zero-WebView
// guarantee. It earns the VIEW-SPEC writers: a page is DATA (a validated object literal) rather
// than TSX, rendered by one shared `ViewRenderer` on the web bundle AND natively in the mobile
// app. `writeProjectView` persists `views/<route>.view.json`; `writeProjectViewComponent` writes
// a reusable element composition with typed props; `writeProjectViewLayout` writes a nested
// layout frame; `writeProjectViewShell` writes the app's navigation + assistant dock.
//
// There is no freehand-TSX writer to grant — the format cannot represent one — so "renders
// natively" holds by construction, not by a rule a weak model is asked to respect.
//
// All validate against the project's REAL endpoint contracts at save time and reject with a
// menu-shaped error naming the instance path, the offence and the finite valid set — which is why
// the parameters are `unknown` rather than an imported spec type: the model emits a TypeScript
// OBJECT LITERAL (trailing commas and comments legal, never a JSON string), and the host, not the
// DTS, is what tells it which section kinds and elements exist.
export const PROJECT_VIEW_DTS = `/** Write a page as a validated VIEW SPEC (views/<route>.view.json). Sections: list|detail|create|stats|markdown|chat|toolbar|timeline|board|calendar|chart. Bindings are paths ($.field), never expressions. */
declare function writeProjectView(route: string, spec: unknown): { ok: boolean; error?: string };
/** Write a reusable element composition with typed props, referenced from any view as { use: '<Name>' }. PascalCase. */
declare function writeProjectViewComponent(name: string, def: unknown): { ok: boolean; error?: string };
/** Write a nested LAYOUT (views/<prefix>/_layout.view.json) — the frame every route under <prefix> renders inside. Exactly one section is { kind: 'outlet' }, where the child route draws. */
declare function writeProjectViewLayout(prefix: string, spec: unknown): { ok: boolean; error?: string };
/** Write the app shell — nav entries/groups, per-entity subnav, brand, assistant dock. Every target must be a real static route. */
declare function writeProjectViewShell(shell: unknown): { ok: boolean; error?: string };`;

// `hooks:write` earns the plan-S11 LIVE-PROJECT authoring writers — the automator
// authors event hooks (`hooks/<slug>.ts`) + emitter defs (`events/<name>.ts`) and the
// engineer authors project functions (`functions/<name>.ts`), all into the session's OWN
// project (the store-catalog `writeHook` writer is gone) with a republish so the change
// goes live immediately. Synchronous host calls. This is the whole `hooks:write` fragment.
export const PROJECT_AUTHORING_DTS = `declare function writeProjectHook(slug: string, src: string): { ok: boolean; error?: string };
declare function writeProjectEvent(name: string, src: string): { ok: boolean; error?: string };
declare function writeProjectFunction(name: string, src: string): { ok: boolean; error?: string };`;

// `db:schema` earns the LIVE-PROJECT table writer, the twin of the S11 live hook/
// event/function writers (the store-catalog `writeTableSchema` writer is gone):
// `writeProjectTable` writes `database/<name>.json` into the project the session is
// actually running in and re-derives its db (a project with no table has no db at all).
// Emitted alongside `composeDbDts` when db:schema is granted — kept OUT of composeDbDts
// because it is a standalone global, not a member of the `db` object.
// The optional third arg SEEDS rows at table-creation time (host-side insert after the db
// re-derives), so KNOWN data the user gave you to "move into the app" lands in one pass — the
// agent can't insert into a table it just created (`db` isn't injected until a table exists).
//
// `writeProjectEntity` is the DECLARATIVE counterpart (W7, §2.1): author FACTS
// (`{ fact, type, values?, to?, currencyField? }`), not a column schema — the table is COMPILED,
// never hand-written. Prefer it; `writeProjectTable` stays for a schema not worth modeling as facts.
export const PROJECT_TABLE_DTS = `declare function writeProjectTable(name: string, schema: unknown, rows?: Array<Record<string, unknown>>): { ok: boolean; error?: string };
/** Declarative entity model (model/<name>.entity.json) — compiled to database/<name>.json, never hand-written. Prefer this over writeProjectTable. */
declare function writeProjectEntity(name: string, entity: {
  entity: string;
  title: string;
  identity?: string;
  fields: Record<string, {
    fact: string;
    type: 'id' | 'string' | 'text' | 'number' | 'decimal' | 'money' | 'boolean' | 'date' | 'json' | 'enum' | 'ref';
    to?: string;
    values?: string[];
    unit?: string;
    currencyField?: string;
    required?: boolean;
    unique?: boolean;
    default?: unknown;
    description?: string;
    source?: string;
  }>;
  relations?: Record<string, { hasMany: string; via: string; description: string } | { belongsTo: string; via: string; description: string }>;
}, rows?: Array<Record<string, unknown>>): { ok: boolean; error?: string };`;

// The read-side twins of the writeProject* writers — PROJECT-ROOTED introspection. `listProjectDir`
// lists the files under `<projectRoot>/<dir>` (a missing dir returns `entries: []`); `readProjectFile`
// reads a project file's text. These resolve against the PROJECT, unlike the space-rooted
// `execShell`/`readFileRaw` (+ the `listDir`/`readFile` system-global wrappers), which root at the
// agent's OWN `LMTHING_SPACE_DIR` — a footgun for a delegated system-space agent whose space dir is
// its source tree. A project-authoring agent uses THESE to see what already exists in the project.
// Emitted on any db grant + a project-rooted session (see buildAppCapabilityDts / injectAppGlobals).
export const PROJECT_READ_DTS = `declare function listProjectDir(dir: string): { ok: boolean; entries: string[]; error?: string };
declare function readProjectFile(path: string): { ok: boolean; content: string; error?: string };`;

// `project:manage` — the authority to create or bind a LIVE project. createProject
// creates a NEW live project under `.lmthing/<id>` + marks it the session's build
// TARGET; selectProject binds an existing live project as the target. A subsequent
// `delegate` to the automator then builds INTO that target. Synchronous host calls.
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

// `team:read` earns the four READERS of the team workspace this pod belongs to. Every
// one of them answers for the CALLER whose message started the turn — the identity is
// closed over host-side, so there is no `userId`/`role` parameter to spoof. A DM the
// caller is not in is not listed by `teamChannels` and is not readable by `teamHistory`
// (it rejects exactly as an unknown id does — "you may not read this" and "there is
// nothing here" must be indistinguishable). Emitted ONLY on a team pod: the grant itself
// is dropped elsewhere (`spaces/capabilities.ts#isTeamPod`), so on a personal pod these
// declarations are absent and a stray `teamMembers()` is a typecheck error, not a throw.
export const TEAM_READ_DTS = `/** Who asked, in which channel, in which thread. The caller's own identity — you cannot act as anyone else. */
declare function teamContext(): Promise<{ teamId: string; channelId: string; channelName: string; channelKind: 'channel' | 'dm'; threadId?: string; caller: { userId: string; email?: string; handle?: string; displayName?: string; role: 'viewer' | 'editor' } }>;
/** The team's member directory — use \`label\` to name someone and \`userId\` to address them. */
declare function teamMembers(): Promise<Array<{ userId: string; label: string; handle?: string; displayName?: string; email?: string; isCaller: boolean }>>;
/** The channels the CALLER can see (a direct message they are not in is never listed). */
declare function teamChannels(): Promise<Array<{ id: string; name: string; kind: 'channel' | 'dm'; categoryId?: string; apps?: string[] }>>;
/** A page of a channel's history, newest last — how you answer "what did we decide about X". Rejects for a channel the caller cannot see. At most 100 messages (default 30); \`returned\`/\`channelName\` are there so you can SAY what you read. */
declare function teamHistory(channelId: string, opts?: { limit?: number; before?: string }): Promise<{ messages: Array<{ id: string; ts: string; channelId: string; kind: 'user' | 'thing' | 'system'; text: string; author: string; userId?: string; threadId?: string }>; hasMore: boolean; channelId: string; channelName: string; returned: number; limit: number }>;`;

// `team:post` earns the three WRITERS. Deliberately a separate id from `team:read`:
// these leave records in a shared log and raise other people's badges, and they are the
// grant a read-only fork role loses (`exec/capability.ts#intersectAppCaps`).
//
// Every post is a `thing` message — the agent speaks as itself and can never be
// attributed to a member — and every one of them is refused when the caller is a
// VIEWER, so a viewer cannot reach through the agent to do what the REST guard would
// have refused them (`server/team-guard.ts#guardRequest`).
//
// There is NO `teamDM`. A `thing` message has no `userId` and `dmChannelId` hashes a
// set of USER ids, so THING cannot be a participant in a direct message: the only
// implementations are impersonating the asker or inventing an identity the addressing
// scheme has no room for. Reaching one person is `teamPost` + an `@handle`, which
// rides the existing mention/badge/push path.
//
// `teamCreateChannel` is here rather than under an id of its own because making a
// room the whole team can see is the same authority as speaking in one, and it is
// the grant a read-only fork role must lose for exactly the same reason. It takes
// no `members`: a named channel is the whole team's, and a private conversation is
// a DM, addressed by who is in it.
export const TEAM_POST_DTS = `/** Post into a channel the caller can see (optionally in a thread). Posts AS THING, attributed to the member who asked; \`@handle\` in the text notifies that person. Editor callers only. A post to another channel leaves a receipt in this thread. */
declare function teamPost(channelId: string, text: string, opts?: { threadId?: string }): Promise<{ ok: boolean; channelId: string; messageId?: string; receipt?: boolean }>;
/** Pin a project's app beside a channel so it can be opened next to the conversation. Editor callers only. */
declare function teamPinApp(channelId: string, projectId: string): Promise<{ ok: boolean; channelId: string; apps: string[] }>;
/** Give a subject a channel of its own, visible to the whole team (there is no members list — a private conversation is a DM). Editor callers only. Get-or-create on the name: \`created: false\` means one already existed and you were handed THAT one, so say so rather than announcing a new one. Use the returned \`channelId\` to \`teamPost\` the first message in there — a channel nobody was told about is a room nobody opens. */
declare function teamCreateChannel(name: string, opts?: { categoryId?: string }): Promise<{ ok: boolean; channelId: string; name: string; created: boolean }>;`;

/**
 * Registry of the STANDALONE app-capability fragments, keyed by capability id, for
 * the integrator to gate additively per agent in `buildAmbientDts`. The `db:*` trio
 * (`db:read`/`db:write`/`db:schema`) is NOT in this flat map — because all three
 * share one `db` object they are composed together via `composeDbDts` (db:schema also
 * emits the standalone live `PROJECT_TABLE_DTS`, handled in buildAppCapabilityDts).
 */
export const CAPABILITY_DTS_FRAGMENTS: Record<string, string> = {
  'api:call': API_CALL_DTS,
  'views:write': PROJECT_VIEW_DTS,
  'api:write': PROJECT_API_DTS,
  'hooks:write': PROJECT_AUTHORING_DTS,
  'knowledge:write': KNOWLEDGE_WRITE_DTS,
  'project:manage': PROJECT_MANAGE_DTS,
  'store:read': STORE_READ_DTS,
  'store:install': STORE_INSTALL_DTS,
  'events:emit': EVENTS_EMIT_DTS,
  'team:read': TEAM_READ_DTS,
  'team:post': TEAM_POST_DTS,
};

// Raw `fetch` gets the same internal-only treatment as the fs/shell primitives: it stays
// INJECTED in every VM (the system-global webSearch/webFetch function BODIES run on it, and
// they are typechecked against the full bundles below, not the model DTS) but is NOT declared
// on any agent's model surface — a model-authored `fetch(...)` fails typecheck (clean,
// retryable) instead of hand-rolling raw HTTP past the granted research functions and the
// research_and_store pipeline (06-tanzania run 26: a scaffolded specialist bypassed its
// instructed store path this way, and the provider API key surfaced in the yield evidence).
export const NET_FETCH_DTS = `declare function fetch(url: string, opts?: { method?: string; headers?: Record<string, string>; body?: string }): Promise<{ ok: boolean; status: number; text(): string; json(): unknown }>;`;

// `process.env` gets the SAME internal-only treatment: system-function BODIES legitimately read it
// (webSearch reads TAVILY_API_KEY) and typecheck against the bundles below, but it is NOT declared on
// any agent's model surface — combined with (formerly) ambient fetch, a model-authored `process.env.X`
// is how a specialist hand-rolled a keyed provider request past its granted research path. Keep the
// runtime shim for bodies; a model-authored `process.env` now fails typecheck in every context.
export const PROCESS_ENV_DTS = `declare const process: { env: Record<string, string | undefined>; exit(code?: number): never };`;

// `process.exit` is DIFFERENT from `process.env`: it carries no secret, and the model is meant to
// use it as intentional-termination control flow (`turn-loop.ts`'s `/\bprocess\.exit\(/` check
// returns 'done' without retrying when it sees the runtime throw from `host-tools.ts`). The
// `process.env` removal above (model-surface secrets hygiene) accidentally took `.exit` down with
// it — same single `process` object — so a model-authored `process.exit(...)` no longer typechecks
// on ANY model surface and gets treated as an ordinary retryable error instead of a clean stop
// (`.issues/` — process-exit-typecheck-regression). Fixed by declaring a SEPARATE, minimal,
// `env`-free `process` on the model surface (`buildAmbientDts`, unconditionally like COMMON_DTS —
// the runtime already injects `process.exit` in every VM regardless of role, so the DTS should
// match). Kept apart from `PROCESS_ENV_DTS` (never both emitted into the same bundle) so the two
// `declare const process` fragments never collide when concatenated.
export const PROCESS_EXIT_DTS = `declare const process: { exit(code?: number): never };`;

/** Full library DTS for the top-level session VM (all globals, incl. `ask`). */
export const LIBRARY_DTS = [ASK_DTS, SET_SESSION_META_DTS, TASKLIST_DTS, FORK_DTS, DELEGATE_DTS, REGISTER_SPACE_DTS, COMMON_DTS, NET_FETCH_DTS, PROCESS_ENV_DTS].join('\n');

/**
 * Library DTS WITHOUT `ask`. Fork and delegate VMs run headless/autonomous — there is
 * no interactive user to prompt — so `ask` is not injected there. Removing its
 * declaration makes a stray `await ask(...)` fail typecheck immediately ("Cannot find
 * name 'ask'") and steers the model back to working from its seed/inputs, instead of
 * binding `undefined` (or, in a real PTY, blocking forever on stdin).
 */
export const LIBRARY_DTS_NO_ASK = [TASKLIST_DTS, FORK_DTS, DELEGATE_DTS, REGISTER_SPACE_DTS, COMMON_DTS, NET_FETCH_DTS, PROCESS_ENV_DTS].join('\n');
