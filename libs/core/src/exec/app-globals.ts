import type { VM } from '../sandbox/quickjs.js';
import { marshalToQuickJS } from '../sandbox/host-bridge.js';
import type { DbApi, QueryOpts, UpdateOpts, RemoveOpts, Row } from '../db/types.js';
import type { AppCapabilities } from '../spaces/capabilities.js';

/**
 * The INJECT side of the capability→{inject, dts} registry (the DTS side lives in
 * `buildAmbientDts`). Project-app globals are host primitives handed in by the
 * runtime host (libs/cli, Phase 2+) as UNSCOPED engine impls; core wraps each in a
 * capability-scope check before exposing it to the VM, so the security boundary is
 * host-side — an agent can only touch the tables/endpoints its `capabilities:`
 * frontmatter granted, enforced on EVERY call (not just at injection).
 *
 * Phase 1 wires the flagship SYNCHRONOUS `db` global (execShell-class: a same-process
 * host call, no yield). The value-yielding app globals (`apiCall`, `writePage`,
 * `writeApi`, `writeHook`) are injected in their owning phases (P3 api runtime, P9
 * authoring) once their yield-router resolvers exist; their DTS is already emitted
 * here in P1 so agents typecheck against them.
 */
export interface AppGlobalImpls {
  /** Project-rooted db (sync agent surface), provided by libs/cli's better-sqlite3
   *  store in Phase 2. Unscoped — core applies the per-verb table grant on top. */
  db?: DbApi;
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
 * Inject the granted project-app globals onto a VM. Gated on `projectRoot`: a
 * session/fork/delegate running OUTSIDE a project (no `projectRoot`) receives NO
 * app globals — the backward-compat invariant that keeps a top-level THING session
 * behaving exactly as before. In Phase 1 no caller supplies `appGlobals`, so nothing
 * is injected at runtime yet; the engine plugs into this seam in Phase 2.
 */
export function injectAppGlobals(
  vm: VM,
  opts: { app: AppCapabilities; projectRoot?: string; appGlobals?: AppGlobalImpls },
): void {
  if (!opts.projectRoot) return; // no project context ⇒ no app globals
  const impls = opts.appGlobals;
  if (!impls) return;
  const app = opts.app;

  const dbGranted = app['db:read'] || app['db:write'] || app['db:schema'];
  if (impls.db && dbGranted) {
    const ctx = vm.ctx;
    const handle = marshalToQuickJS(ctx, buildScopedDb(impls.db, app));
    ctx.setProp(ctx.global, 'db', handle);
    handle.dispose();
  }
}
