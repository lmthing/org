import type { VM } from '../sandbox/quickjs.js';
import { marshalToQuickJS, injectGlobal } from '../sandbox/host-bridge.js';
import type { DbApi, QueryOpts, UpdateOpts, Row, ApiCallFn, ConnectionResolver } from '../db/types.js';
import type { AppCapabilities } from '../spaces/capabilities.js';
import type { StoreResolver } from '../globals/store.js';
import type { EmitEventResolver } from '../globals/emit-event.js';
import type { TeamResolver } from '../globals/team.js';

/** Result shape common to the synchronous authoring globals. */
export type AuthoringResult = { ok: boolean; error?: string };
/** createProject/selectProject also report the resolved app id + root. */
export type ProjectResult = { ok: boolean; appId?: string; root?: string; error?: string };

/**
 * The INJECT side of the capability→{inject, dts} registry (the DTS side lives in
 * `buildAmbientDts`). Project-app globals are host primitives handed in by the
 * runtime host (libs/cli, Phase 2+) as UNSCOPED engine impls; core wraps each in a
 * capability-scope check before exposing it to the VM, so the security boundary is
 * host-side — an agent can only touch the tables/endpoints its `capabilities:`
 * frontmatter granted, enforced on EVERY call (not just at injection).
 *
 * Phase 1 wires the flagship SYNCHRONOUS `db` global (execShell-class: a same-process
 * host call, no yield). The SYNCHRONOUS authoring globals (the live `writeProject*`
 * writers + `createProject`/`selectProject`) follow — the DTS declares them non-Promise,
 * so like `db` they are plain host calls (no
 * yield-router). `apiCall` remains the one value-yielding app global (wired at its P4/P6
 * seam). Each impl below is UNSCOPED (host engine, libs/cli); core injects it only when
 * the agent holds the matching capability.
 */
export interface AppGlobalImpls {
  /** Project-rooted db (sync agent surface), provided by libs/cli's better-sqlite3
   *  store in Phase 2. Unscoped — core applies the per-verb table grant on top. */
  db?: DbApi;
  /** Forwards a `hostFs` yield to the LMThing desktop attached to this pod — the person's OWN
   *  machine, not the pod's disk. Value-yielding like `apiCall`: NOT injected here but wired
   *  through the yield router (`createHostFsGlobals` + `YieldRouterContext.hostFsResolver`). The
   *  host (libs/cli) supplies a resolver bound to its `HostBridge`; absent ⇒ a structured
   *  "no desktop bridge" result rather than a bound `undefined`. */
  hostFs?: import('../eval/host-fs-yield.js').HostFsResolver;
  /** Forwards a `hostCdp` yield to the browser the desktop app is showing. */
  hostCdp?: (op: string, args: unknown[]) => Promise<unknown>;
  /** Agent-facing `apiCall` — enter the project's own `api/` endpoints by name.
   *  Value-yielding (Promise-returning): unlike the synchronous globals below it is
   *  NOT injected here but wired through the yield router (`createApiCallGlobal` +
   *  `YieldRouterContext.apiCallResolver`), so it can end the turn and resume. The
   *  host (libs/cli) supplies a resolver that re-enters the project's api runtime. */
  apiCall?: ApiCallFn;
  /** Agent-facing `callConnection` — an authenticated request to a user-connected
   *  external service via the gateway egress proxy. Value-yielding like `apiCall`:
   *  NOT injected here (see `injectAppGlobals`) but wired through the yield router
   *  (`createCallConnectionGlobal` + `YieldRouterContext.connectionResolver`). The
   *  host (libs/cli) supplies a resolver that POSTs the pod's scoped connections
   *  JWT to the gateway proxy; project-independent, so it is attached to EVERY
   *  session, not only project-app sessions. */
  callConnection?: ConnectionResolver;
  /** Store-global resolver (plan S10) — `storeSearch`/`storeInspect`/`installSpace`
   *  are value-yielding like `apiCall`: NOT injected here but wired through the
   *  yield router (`YieldRouterContext.storeResolver`). The host (libs/cli)
   *  supplies a resolver over the store catalog + the pure `installStoreSpace`;
   *  project-scoped (installs land in the session's project). */
  store?: StoreResolver;
  /** `emitEvent` resolver (plan S10) — value-yielding like `apiCall`: NOT injected
   *  here but wired through the yield router (`YieldRouterContext.emitEventResolver`).
   *  The host (libs/cli) validates against the caller scope's declared events and
   *  dispatches via the event pipeline; project-scoped. */
  emitEvent?: EmitEventResolver;
  /** Team-workspace resolver (`team:read`/`team:post`) — value-yielding like `store`:
   *  NOT injected here but threaded through the yield router
   *  (`YieldRouterContext.teamResolver`). Unlike every other entry in this interface
   *  it is built PER TURN, not per project: it is closed over the verified caller,
   *  channel and thread of the message that woke the agent
   *  (`libs/cli/src/server/team-globals.ts#createTeamResolver`), which is how an
   *  agent turn — running headless, with no request in scope — knows who is asking
   *  without a global mutable. Absent on a personal pod and on any team-pod turn that
   *  did not come from a channel. */
  team?: TeamResolver;
  /** LIVE-PROJECT lifecycle globals (`project:manage`) — `createProject` makes a NEW
   *  live pod project under `.lmthing/<id>/` (a real, servable project — NOT a
   *  `store/apps/<id>/` catalog template) and marks it the session's build TARGET;
   *  `selectProject` binds an existing live project as the target. A subsequent
   *  `delegate` to the automator then builds INTO that target (see
   *  `resolveBuildTarget`). Provided by libs/cli; injected purely on the capability
   *  grant (NOT projectRoot) — THING holds `project:manage` and creates the live
   *  project it will delegate the build into. */
  createProject?: (id: string, opts?: { title?: string }) => ProjectResult;
  selectProject?: (id: string) => ProjectResult;
  /** Plan S11 LIVE-PROJECT authoring globals — these write into the target live
   *  project (`<lmthingRoot>/<projectId>/{hooks,events,functions}/`) and
   *  republish so the change goes live without a pod restart. Provided by libs/cli
   *  (`createProjectAuthoringGlobals`), bound to the session's project root, and
   *  injected purely on the `hooks:write` grant (see {@link injectAppGlobals}):
   *  the automator authors event hooks + emitter defs, the engineer authors
   *  project functions. */
  writeProjectHook?: (slug: string, src: string) => AuthoringResult;
  writeProjectEvent?: (name: string, src: string) => AuthoringResult;
  writeProjectFunction?: (name: string, src: string) => AuthoringResult;
  /** LIVE-project table writer (the `db:schema` twin of the three above): writes
   *  `<projectRoot>/database/<name>.json` and re-derives the project's db. The ONLY
   *  data-model writer now — a project with no `database/*.json` boots NO db at all. */
  writeProjectTable?: (name: string, schema: unknown) => AuthoringResult;
  /** LIVE-project ENTITY MODEL writer (`db:schema`, W7 §2.1) — the declarative counterpart of
   *  `writeProjectTable`: writes `<projectRoot>/model/<name>.entity.json` (facts, not columns) and
   *  COMPILES it straight to `<projectRoot>/database/<name>.json`, which is never hand-edited once an
   *  entity model owns it. */
  writeProjectEntity?: (name: string, entity: unknown, rows?: unknown[]) => AuthoringResult;
  /** LIVE-project API endpoint writer (`api:write`): writes
   *  `<projectRoot>/api/<path>/<METHOD>.ts` and republishes the served app. */
  writeProjectApi?: (route: string, src: string) => AuthoringResult;
  /** LIVE-project DECLARATIVE QUERY writer (`api:write`, W7 §7) — the declarative counterpart of
   *  `writeProjectApi`: writes `<projectRoot>/api/<name>.query.json` and GENERATES its handler straight
   *  to `<projectRoot>/api/<route>/<METHOD>.ts`, so a list/get/aggregate/create/update/toggle endpoint
   *  cannot disagree with its own contract. */
  writeProjectQuery?: (name: string, query: unknown) => AuthoringResult;
  /** Delete twins of the writers above — retire ONE artifact of the matching kind. Each is
   *  guarded: a delete that would leave a view/shell referencing a ghost (a nav entry, a
   *  `{ use: … }`, a page's query) returns `{ ok: false }` naming the referencing file(s), and
   *  deleting a missing artifact is `{ ok: false }`, never a silent success. Tables are NOT
   *  deletable (they hold user data; `db.remove` is host-only by design) and there is no generic
   *  file delete. Gated by the SAME capability as the corresponding write. */
  deleteProjectView?: (route: string) => AuthoringResult;
  deleteProjectViewComponent?: (name: string) => AuthoringResult;
  deleteProjectViewLayout?: (prefix: string) => AuthoringResult;
  deleteProjectApi?: (route: string) => AuthoringResult;
  deleteProjectQuery?: (name: string) => AuthoringResult;
  deleteProjectHook?: (slug: string) => AuthoringResult;
  /** LIVE-project VIEW-SPEC writers (`views:write`) — the ONLY UI-authoring surface: a page as
   *  validated DATA, rendered by the shared `ViewRenderer` on the web bundle and natively in the
   *  mobile app. `writeProjectView` persists the spec; `writeProjectViewLayout` writes a nested
   *  layout frame; `writeProjectViewComponent` writes a reusable element composition;
   *  `writeProjectViewShell` writes the app's navigation. Provided by libs/cli
   *  (`app/authoring/globals.ts#createProjectAuthoringGlobals`), which validates each against the
   *  project's real endpoint contracts and rejects with a menu-shaped error. */
  writeProjectView?: (route: string, spec: unknown) => AuthoringResult;
  writeProjectViewLayout?: (prefix: string, spec: unknown) => AuthoringResult;
  writeProjectViewComponent?: (name: string, def: unknown) => AuthoringResult;
  writeProjectViewShell?: (shell: unknown) => AuthoringResult;
  /** LIVE-project INTROSPECTION reads (the read-side twins of the `writeProject*` writers):
   *  `listProjectDir(dir)` lists the files under `<projectRoot>/<dir>` (e.g. 'database',
   *  'hooks', 'events', 'pages', 'api') and `readProjectFile(path)` reads a project file's
   *  text. These resolve against `projectRoot` — NOT the agent's own `LMTHING_SPACE_DIR`
   *  (which is where the space-authoring `execShell`/`readFileRaw`/`listDir` wrappers root,
   *  a footgun for a delegated system-space agent whose space dir is its SOURCE tree; see
   *  .issues/delegate-fs-globals-root-at-space-not-project.md). A project-authoring agent
   *  (the automator) uses THESE to see what already exists, never the space-rooted tools. */
  listProjectDir?: (dir: string) => { ok: boolean; entries: string[]; error?: string };
  readProjectFile?: (path: string) => { ok: boolean; content: string; error?: string };
  /** SELF-AUTHORING globals (`self:author`) — the per-project THING rewriting its OWN space,
   *  bound host-side to `<projectRoot>/spaces/user-thing/`. `appendSelfInstruct` APPENDS a
   *  delimited section to `agents/thing/instruct.md` (never overwrites — additive, so a bad edit
   *  can only add, never strip the base persona); `writeSelfKnowledge` writes a knowledge aspect;
   *  `readSelf` reads a file back for iterative edits. Provided by libs/cli
   *  (`createSelfAuthoringGlobals`), injected purely on the grant. */
  appendSelfInstruct?: (text: string) => AuthoringResult;
  writeSelfKnowledge?: (field: string, aspect: string, markdown: string) => AuthoringResult;
  readSelf?: (path?: string) => { ok: boolean; content: string; error?: string };
}

/** Throw the host error shape (naming the allowed tables, like the canDelegateTo
 *  violation error) when a db verb targets a table outside its grant. A grant with
 *  no `tables` list means all tables; an absent grant means the verb is not injected. */
function assertTableAllowed(
  verb: 'db:read' | 'db:write' | 'db:schema',
  grant: { tables?: string[] } | undefined,
  table: string,
): void {
  if (!grant) throw new Error(`db ${verb}: not permitted (capability not granted)`);
  if (grant.tables && !grant.tables.includes(table)) {
    throw new Error(`db ${verb}: table "${table}" not permitted; allowed tables: ${grant.tables.join(', ')}`);
  }
}

/**
 * Build the per-agent scoped `db` object exposing ONLY the verbs the agent was
 * granted (`db:read`→query/tables, `db:write`→insert/update/remove,
 * `db:schema`→createTable/addColumn), each table-scope-checked against the grant.
 * A verb the agent did not receive is simply absent from the object (and from its
 * DTS), so a stray call fails typecheck rather than reaching the engine.
 */
function buildScopedDb(db: DbApi, app: AppCapabilities): Record<string, unknown> {
  const scoped: Record<string, unknown> = {};
  const read = app['db:read'];
  const write = app['db:write'];
  const schema = app['db:schema'];

  if (read) {
    scoped['query'] = (table: string, opts?: QueryOpts): Row[] => {
      assertTableAllowed('db:read', read, table);
      return db.query(table, opts);
    };
    // tables() lists the schema, not row data — no per-table narrowing.
    scoped['tables'] = (): string[] => db.tables();
  }
  if (write) {
    scoped['insert'] = (table: string, values: Row | Row[]): Row | Row[] => {
      assertTableAllowed('db:write', write, table);
      return db.insert(table, values);
    };
    scoped['update'] = (table: string, opts: UpdateOpts): number => {
      assertTableAllowed('db:write', write, table);
      return db.update(table, opts);
    };
    // NOTE: `remove` (hard delete) is intentionally NOT exposed on the model `db` surface.
    // A destructive delete is a host-only primitive reached only through a tasklist CODE node's
    // injected `ctx.db.remove` (see libs/cli's code-node runner), so an agent can never inline-delete
    // a row — it must route the deletion through a guarded tasklist. Mirrors DB_WRITE_MEMBERS.
  }
  if (schema) {
    // createTable names a NEW table — the grant's table list (if any) pre-authorizes
    // which tables may be created; addColumn narrows by its explicit target table.
    scoped['createTable'] = (tableSchema: Parameters<DbApi['createTable']>[0]): void => {
      db.createTable(tableSchema);
    };
    scoped['addColumn'] = (table: string, name: string, column: Parameters<DbApi['addColumn']>[2]): void => {
      assertTableAllowed('db:schema', schema, table);
      db.addColumn(table, name, column);
    };
  }
  return scoped;
}

/**
 * Inject the granted project-app globals onto a VM.
 *
 * Two gating regimes, because two kinds of global:
 *   - **`db`** (the live project database) is gated on `projectRoot` AND its grant:
 *     a session/fork/delegate running OUTSIDE a project (no `projectRoot`) receives
 *     NO `db` — the backward-compat invariant that keeps a top-level THING session
 *     behaving exactly as before, and there is no live db to bind without a project.
 *   - **The `project:manage` lifecycle globals** (`createProject`/`selectProject`)
 *     are gated on the CAPABILITY GRANT ALONE, not `projectRoot`: `createProject`
 *     makes a NEW live project under `.lmthing/<id>/` and marks it the build target,
 *     so it must be callable from a session that is not yet inside that project.
 *     THING holds `project:manage`; ordinary agents hold none of these caps, so
 *     nothing is injected for them (invariant preserved: no caps ⇒ no app globals),
 *     regardless of whether the host passes the impls.
 *
 * Nothing is injected unless the host supplies `appGlobals` (libs/cli, P2+).
 */
export function injectAppGlobals(
  vm: VM,
  opts: { app: AppCapabilities; projectRoot?: string; appGlobals?: AppGlobalImpls },
): void {
  const impls = opts.appGlobals;
  if (!impls) return;
  const app = opts.app;
  const ctx = vm.ctx;

  // db — requires a live project context (projectRoot) in addition to a db grant.
  const dbGranted = app['db:read'] || app['db:write'] || app['db:schema'];
  if (opts.projectRoot && impls.db && dbGranted) {
    const handle = marshalToQuickJS(ctx, buildScopedDb(impls.db, app));
    ctx.setProp(ctx.global, 'db', handle);
    handle.dispose();
  }

  // The VIEW-SPEC writers, gated on `views:write` — the ONLY UI-authoring capability. This is the
  // mechanism behind the zero-WebView guarantee: a page is validated DATA, rendered by one shared
  // `ViewRenderer` on web and native. There is no freehand-TSX writer to grant — the format cannot
  // represent one — so "not granted ⇒ not injected AND absent from the DTS" makes any non-spec UI a
  // typecheck error rather than a rule a weak model is asked to respect. Present only when the host
  // supplies them (a project-rooted session); a catalog-only appbuilder session leaves them absent.
  if (app['views:write'] && impls.writeProjectView) injectGlobal(ctx, 'writeProjectView', impls.writeProjectView as (...a: unknown[]) => unknown);
  if (app['views:write'] && impls.writeProjectViewLayout)
    injectGlobal(ctx, 'writeProjectViewLayout', impls.writeProjectViewLayout as (...a: unknown[]) => unknown);
  if (app['views:write'] && impls.writeProjectViewComponent) injectGlobal(ctx, 'writeProjectViewComponent', impls.writeProjectViewComponent as (...a: unknown[]) => unknown);
  if (app['views:write'] && impls.writeProjectViewShell) injectGlobal(ctx, 'writeProjectViewShell', impls.writeProjectViewShell as (...a: unknown[]) => unknown);
  // The DELETE twins — same grants as the writes they mirror, so an agent that may author a
  // kind of artifact may also retire it, and nothing else can.
  if (app['views:write'] && impls.deleteProjectView) injectGlobal(ctx, 'deleteProjectView', impls.deleteProjectView as (...a: unknown[]) => unknown);
  if (app['views:write'] && impls.deleteProjectViewComponent)
    injectGlobal(ctx, 'deleteProjectViewComponent', impls.deleteProjectViewComponent as (...a: unknown[]) => unknown);
  if (app['views:write'] && impls.deleteProjectViewLayout) injectGlobal(ctx, 'deleteProjectViewLayout', impls.deleteProjectViewLayout as (...a: unknown[]) => unknown);
  if (app['api:write'] && impls.deleteProjectApi) injectGlobal(ctx, 'deleteProjectApi', impls.deleteProjectApi as (...a: unknown[]) => unknown);
  if (app['api:write'] && impls.deleteProjectQuery) injectGlobal(ctx, 'deleteProjectQuery', impls.deleteProjectQuery as (...a: unknown[]) => unknown);
  if (app['api:write'] && impls.writeProjectApi) injectGlobal(ctx, 'writeProjectApi', impls.writeProjectApi as (...a: unknown[]) => unknown);
  if (app['api:write'] && impls.writeProjectQuery) injectGlobal(ctx, 'writeProjectQuery', impls.writeProjectQuery as (...a: unknown[]) => unknown);
  // Live-project authoring (S11) — same `hooks:write` grant, but these write into the
  // session's OWN project (not the catalog) and republish. Present only when the host
  // supplies them (a project-rooted session); a catalog-only appbuilder session leaves
  // them absent, so a stray call there fails typecheck rather than mis-targeting.
  if (app['hooks:write'] && impls.writeProjectHook) injectGlobal(ctx, 'writeProjectHook', impls.writeProjectHook as (...a: unknown[]) => unknown);
  if (app['hooks:write'] && impls.deleteProjectHook) injectGlobal(ctx, 'deleteProjectHook', impls.deleteProjectHook as (...a: unknown[]) => unknown);
  if (app['hooks:write'] && impls.writeProjectEvent) injectGlobal(ctx, 'writeProjectEvent', impls.writeProjectEvent as (...a: unknown[]) => unknown);
  if (app['hooks:write'] && impls.writeProjectFunction) injectGlobal(ctx, 'writeProjectFunction', impls.writeProjectFunction as (...a: unknown[]) => unknown);
  // The LIVE-project table writer — same `db:schema` grant, but it targets the session's
  // OWN project (not the catalog). Present only when the host supplies it (a project-rooted
  // session); a catalog-only appbuilder session leaves it absent.
  if (app['db:schema'] && impls.writeProjectTable) injectGlobal(ctx, 'writeProjectTable', impls.writeProjectTable as (...a: unknown[]) => unknown);
  if (app['db:schema'] && impls.writeProjectEntity) injectGlobal(ctx, 'writeProjectEntity', impls.writeProjectEntity as (...a: unknown[]) => unknown);
  if (app['project:manage']) {
    if (impls.createProject) injectGlobal(ctx, 'createProject', impls.createProject as (...a: unknown[]) => unknown);
    if (impls.selectProject) injectGlobal(ctx, 'selectProject', impls.selectProject as (...a: unknown[]) => unknown);
  }

  // SELF-AUTHORING (`self:author`) — the per-project THING rewriting its own space. Present only
  // when the host supplies the impls (a project-rooted session whose project has a `user-thing`
  // copy); absent otherwise, so a stray call fails typecheck rather than mis-targeting.
  if (app['self:author']) {
    if (impls.appendSelfInstruct) injectGlobal(ctx, 'appendSelfInstruct', impls.appendSelfInstruct as (...a: unknown[]) => unknown);
    if (impls.writeSelfKnowledge) injectGlobal(ctx, 'writeSelfKnowledge', impls.writeSelfKnowledge as (...a: unknown[]) => unknown);
    if (impls.readSelf) injectGlobal(ctx, 'readSelf', impls.readSelf as (...a: unknown[]) => unknown);
  }

  // LIVE-project introspection reads — the read-side twins of the writeProject* writers. Gated on
  // a live project (projectRoot) ALONE — no db grant required. These are the ONLY way any agent
  // reads project files now that the space-rooted `readFile`/`listDir` wrappers are gone, so THING
  // (which holds no db grant) reads `instructions.md`/`documents/` through them. They root at
  // projectRoot, so a delegated system-space agent inspects the PROJECT, never its own source dir.
  if (opts.projectRoot) {
    if (impls.listProjectDir) injectGlobal(ctx, 'listProjectDir', impls.listProjectDir as (...a: unknown[]) => unknown);
    if (impls.readProjectFile) injectGlobal(ctx, 'readProjectFile', impls.readProjectFile as (...a: unknown[]) => unknown);
  }
}
