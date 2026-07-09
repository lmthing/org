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
declare const process: { env: Record<string, string | undefined>; exit(code?: number): never };
declare function readFileRaw(path: string, opts?: { offset?: number; limit?: number }): { ok: boolean; content: string; lines: number; truncated: boolean; error?: string };
declare function typecheckSource(src: string): { ok: boolean; errors: string[] };
declare function spacePath(...parts: string[]): string;
declare function resolveSpaceDir(space: string): string;
declare function progress(): { episodes: number; toolCalls: number; elapsedMs: number };
` + '\n' + catalogDts();

/**
 * Write primitives — split out of COMMON_DTS so they are only appended where the
 * host actually injects them (under `allowWrite`). Declaring them unconditionally
 * inside COMMON_DTS made a stray `writeFileRaw`/`execShell` pass typecheck in a
 * read-only VM and throw at runtime; gating the DTS fragment fixes that.
 */
export const EXEC_SHELL_DTS = `declare function execShell(cmd: string, opts?: { timeout?: number }): { ok: boolean; stdout: string; stderr: string; exitCode: number };`;
export const WRITE_FILE_RAW_DTS = `declare function writeFileRaw(path: string, content: string): { ok: boolean; bytes: number; error?: string };`;

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

// `db:schema` also earns `writeTableSchema` — the AUTHORING form that writes a
// `database/<name>.json` schema file into the catalog app (distinct from the runtime
// `db.createTable` migration on `db`). Emitted alongside `composeDbDts` when db:schema
// is granted (see buildAppCapabilityDts) — kept OUT of composeDbDts because it is a
// standalone global, not a member of the `db` object.
export const WRITE_TABLE_SCHEMA_DTS = `declare function writeTableSchema(name: string, schema: unknown): { ok: boolean; error?: string };`;

// `project:manage` — the appbuilder's authority to scaffold or bind a catalog app.
// createProject creates a NEW store/apps/<id>/ template + selects it as the authoring
// target; selectProject binds an existing one. Subsequent writePage/writeApi/... land
// in the currently-selected app. Synchronous host calls.
export const PROJECT_MANAGE_DTS = `declare function createProject(id: string, opts?: { title?: string }): { ok: boolean; appId?: string; root?: string; error?: string };
declare function selectProject(id: string): { ok: boolean; appId?: string; root?: string; error?: string };`;

/**
 * Registry of the STANDALONE app-capability fragments, keyed by capability id, for
 * the integrator to gate additively per agent in `buildAmbientDts`. The `db:*` trio
 * (`db:read`/`db:write`/`db:schema`) is NOT in this flat map — because all three
 * share one `db` object they are composed together via `composeDbDts` (db:schema also
 * emits the standalone `WRITE_TABLE_SCHEMA_DTS`, handled in buildAppCapabilityDts).
 */
export const CAPABILITY_DTS_FRAGMENTS: Record<string, string> = {
  'api:call': API_CALL_DTS,
  'pages:write': PAGES_WRITE_DTS,
  'api:write': API_WRITE_DTS,
  'hooks:write': HOOKS_WRITE_DTS,
  'project:manage': PROJECT_MANAGE_DTS,
};

// Write primitives, appended to the full-DTS bundles below. `host-tools.ts`'s
// `typecheckSource` needs the FULL global set (incl. execShell/writeFileRaw), so the
// LIBRARY_DTS bundles re-append these two fragments to stay byte-equivalent to the
// pre-split COMMON_DTS.
const WRITE_PRIMITIVES_DTS = [EXEC_SHELL_DTS, WRITE_FILE_RAW_DTS].join('\n');

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
