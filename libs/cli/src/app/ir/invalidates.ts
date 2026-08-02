/**
 * Derive a mutation's `invalidates` list — the endpoint names whose cached results a `create`/
 * `update`/`toggle` query should invalidate — from the query IR's own **write-set ∩ read-set** (§7),
 * instead of requiring a view author to hand-declare it on the mutate action (`MutateAction.invalidates`,
 * `view-spec/schema.ts`). A forgotten `invalidates` is a real defect class (§10 L-something): the
 * mutation succeeds, the list/dashboard reading the same table keeps its stale react-query cache, and
 * the user sees their own write vanish until a manual refresh.
 *
 * The write-set of a mutation is the ONE entity it targets (`ir.entity`). The read-set of a read query
 * is its own entity PLUS every entity reachable through a declared `include` relation (a dashboard
 * that includes `parts` reads the `part` table too, so a part mutation must invalidate it). A read
 * whose read-set intersects the mutation's write-set is a candidate; the mutation's own name is never
 * included (a query cannot invalidate itself).
 */

import type { TableSchema } from '@lmthing/core';
import type { QueryIr } from './query.js';

/** The set of entity/table names a read query actually reads from (its own entity, plus every
 *  entity reached through a declared `include` relation). */
export function readSet(query: QueryIr, tables: ReadonlyMap<string, TableSchema>): Set<string> {
  const out = new Set<string>([query.entity]);
  const table = tables.get(query.entity);
  for (const rel of query.include ?? []) {
    const def = table?.relations?.[rel];
    if (!def) continue;
    const target = 'hasMany' in def ? def.hasMany : 'belongsTo' in def ? def.belongsTo : undefined;
    if (target) out.add(target);
  }
  return out;
}

/** Is this query kind one whose result a mutation should invalidate (a read, not itself a mutation)? */
function isReadKind(kind: QueryIr['kind']): boolean {
  return kind === 'list' || kind === 'get' || kind === 'aggregate';
}

/**
 * Derive the `invalidates` list for one mutation (`create`/`update`/`toggle`) query, given every OTHER
 * query IR the project declares. Deterministic order (declaration order of `allQueries`, self excluded).
 */
export function deriveInvalidates(
  mutation: QueryIr,
  allQueries: readonly QueryIr[],
  tables: ReadonlyMap<string, TableSchema>,
): string[] {
  const out: string[] = [];
  for (const q of allQueries) {
    if (q.name === mutation.name) continue;
    if (!isReadKind(q.kind)) continue;
    if (readSet(q, tables).has(mutation.entity)) out.push(q.name);
  }
  return out;
}
