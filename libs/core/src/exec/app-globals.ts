import type { VM } from '../sandbox/quickjs.js';
import { marshalToQuickJS, injectGlobal } from '../sandbox/host-bridge.js';
import type { DbApi, QueryOpts, UpdateOpts, RemoveOpts, Row, ApiCallFn, ConnectionResolver, ToolCallFn } from '../db/types.js';
import type { AppCapabilities } from '../spaces/capabilities.js';
import type { StoreResolver } from '../globals/store.js';
import type { EmitEventResolver } from '../globals/emit-event.js';

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
 * host call, no yield). Phase 9 adds the SYNCHRONOUS authoring globals
 * (`writePage`/`writeApi`/`writeHook`/`writeTableSchema` + `createProject`/`selectProject`)
 * — the DTS declares them non-Promise, so like `db` they are plain host calls (no
 * yield-router). `apiCall` remains the one value-yielding app global (wired at its P4/P6
 * seam). Each impl below is UNSCOPED (host engine, libs/cli); core injects it only when
 * the agent holds the matching capability.
 */
export interface AppGlobalImpls {
  /** Project-rooted db (sync agent surface), provided by libs/cli's better-sqlite3
   *  store in Phase 2. Unscoped — core applies the per-verb table grant on top. */
  db?: DbApi;
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
  /** Agent-facing `tool` — dispatch to a host-registered tool (an OpenClaw plugin
   *  tool loaded via `@lmthing/openclaw-compat`). Value-yielding like `apiCall`:
   *  NOT injected here but wired through the yield router (`createToolGlobal` +
   *  `YieldRouterContext.toolResolver`). The host (libs/cli) supplies a resolver
   *  that dispatches to the loaded `PluginRegistry`; project-independent, so it is
   *  attached to EVERY session, not only project-app sessions. */
  tool?: ToolCallFn;
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
  /** Phase 9 authoring globals — write into the `store/apps/<id>/` catalog source of
   *  the currently-selected app. Provided by libs/cli (`createAppAuthoringGlobals`).
   *  Injected purely on the capability grant (NOT projectRoot): the appbuilder has no
   *  project of its own until `createProject` establishes one. */
  writePage?: (route: string, src: string) => AuthoringResult;
  writeApi?: (route: string, src: string) => AuthoringResult;
  writeHook?: (slug: string, src: string) => AuthoringResult;
  writeTableSchema?: (name: string, schema: unknown) => AuthoringResult;
  createProject?: (id: string, opts?: { title?: string }) => ProjectResult;
  selectProject?: (id: string) => ProjectResult;
  /** Plan S11 LIVE-PROJECT authoring globals — unlike the catalog writers above
   *  (which target `store/projects/<id>/` templates), these write into the SESSION'S
   *  OWN live project (`<lmthingRoot>/<projectId>/{hooks,events,functions}/`) and
   *  republish so the change goes live without a pod restart. Provided by libs/cli
   *  (`createProjectAuthoringGlobals`), bound to the session's project root, and
   *  injected purely on the `hooks:write` grant (see {@link injectAppGlobals}):
   *  the automator authors event hooks + emitter defs, the engineer authors
   *  project functions. */
  writeProjectHook?: (slug: string, src: string) => AuthoringResult;
  writeProjectEvent?: (name: string, src: string) => AuthoringResult;
  writeProjectFunction?: (name: string, src: string) => AuthoringResult;
  /** LIVE-project table writer (the `db:schema` twin of the three above): writes
   *  `<projectRoot>/database/<name>.json` and re-derives the project's db. Without it a
   *  live project can never gain a data model — `writeTableSchema` only targets a catalog
   *  template, and a project with no `database/*.json` boots NO db at all. */
  writeProjectTable?: (name: string, schema: unknown) => AuthoringResult;
  /** LIVE-project page/API writers (the `pages:write`/`api:write` twins): write
   *  `<projectRoot>/pages/<route>.tsx` / `<projectRoot>/api/<path>/<METHOD>.ts` and
   *  rebuild the served app. Without them a live project can gain a data model +
   *  automation but never a UI — "turn this into an app I can open" dead-ends (scenario 05). */
  writeProjectPage?: (route: string, src: string) => AuthoringResult;
  writeProjectApi?: (route: string, src: string) => AuthoringResult;
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
    scoped['remove'] = (table: string, opts: RemoveOpts): number => {
      assertTableAllowed('db:write', write, table);
      return db.remove(table, opts);
    };
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
 *   - **The Phase-9 authoring globals** (`writePage`/`writeApi`/`writeHook`/
 *     `writeTableSchema` + `createProject`/`selectProject`) are gated on the
 *     CAPABILITY GRANT ALONE, not `projectRoot`: the appbuilder legitimately has no
 *     project of its own — `createProject` is precisely what establishes the catalog
 *     app the other authoring writes target. THING and ordinary agents hold none of
 *     these caps, so nothing is injected for them (invariant preserved: no caps ⇒ no
 *     app globals), regardless of whether the host passes the impls.
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

  // Authoring/management globals — capability-gated only (project-independent).
  if (app['pages:write'] && impls.writePage) injectGlobal(ctx, 'writePage', impls.writePage as (...a: unknown[]) => unknown);
  if (app['api:write'] && impls.writeApi) injectGlobal(ctx, 'writeApi', impls.writeApi as (...a: unknown[]) => unknown);
  // Live-project page/API authoring (S11) — same `pages:write`/`api:write` grant, but these
  // write into the session's OWN project (not the catalog) and rebuild the served app. Present
  // only when the host supplies them (a project-rooted session); a catalog-only appbuilder
  // session leaves them absent, so a stray call there fails typecheck rather than mis-targeting.
  if (app['pages:write'] && impls.writeProjectPage) injectGlobal(ctx, 'writeProjectPage', impls.writeProjectPage as (...a: unknown[]) => unknown);
  if (app['api:write'] && impls.writeProjectApi) injectGlobal(ctx, 'writeProjectApi', impls.writeProjectApi as (...a: unknown[]) => unknown);
  if (app['hooks:write'] && impls.writeHook) injectGlobal(ctx, 'writeHook', impls.writeHook as (...a: unknown[]) => unknown);
  // Live-project authoring (S11) — same `hooks:write` grant, but these write into the
  // session's OWN project (not the catalog) and republish. Present only when the host
  // supplies them (a project-rooted session); a catalog-only appbuilder session leaves
  // them absent, so a stray call there fails typecheck rather than mis-targeting.
  if (app['hooks:write'] && impls.writeProjectHook) injectGlobal(ctx, 'writeProjectHook', impls.writeProjectHook as (...a: unknown[]) => unknown);
  if (app['hooks:write'] && impls.writeProjectEvent) injectGlobal(ctx, 'writeProjectEvent', impls.writeProjectEvent as (...a: unknown[]) => unknown);
  if (app['hooks:write'] && impls.writeProjectFunction) injectGlobal(ctx, 'writeProjectFunction', impls.writeProjectFunction as (...a: unknown[]) => unknown);
  if (app['db:schema'] && impls.writeTableSchema) injectGlobal(ctx, 'writeTableSchema', impls.writeTableSchema as (...a: unknown[]) => unknown);
  // The LIVE-project table writer — same `db:schema` grant, but it targets the session's
  // OWN project (not the catalog). Present only when the host supplies it (a project-rooted
  // session); a catalog-only appbuilder session leaves it absent.
  if (app['db:schema'] && impls.writeProjectTable) injectGlobal(ctx, 'writeProjectTable', impls.writeProjectTable as (...a: unknown[]) => unknown);
  if (app['project:manage']) {
    if (impls.createProject) injectGlobal(ctx, 'createProject', impls.createProject as (...a: unknown[]) => unknown);
    if (impls.selectProject) injectGlobal(ctx, 'selectProject', impls.selectProject as (...a: unknown[]) => unknown);
  }
}
