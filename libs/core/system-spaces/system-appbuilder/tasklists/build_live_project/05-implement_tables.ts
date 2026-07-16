// implement_tables — DETERMINISTIC code node (converted from a model-driven .md node).
// Writes ONE planned table (schema + source-derived rows) into the LIVE project's database/,
// once per element of plan_tables.tables (forEach). No model turn, so no generated-code errors:
// it just forwards the plan's schema + rows to the typed writer on ctx.
//
// inputs: { ...seed, plan_tables, item, index } — `item` is the current { name, schema, rows }.
// ctx.writeProjectTable(name, schema, rows) → { ok, error? } (proxied to the host authoring globals).

export const node = {
  id: 'implement_tables',
  output: { name: 'string', ok: 'boolean' },
  dependsOn: ['plan_tables'],
  forEach: 'plan_tables.tables',
};

export async function run(ctx, inputs) {
  const t = (inputs && inputs.item) || {};
  const rows = Array.isArray(t.rows) ? t.rows : [];
  const w = await ctx.writeProjectTable(t.name, t.schema, rows);
  return { name: t.name, ok: !!(w && w.ok) };
}
