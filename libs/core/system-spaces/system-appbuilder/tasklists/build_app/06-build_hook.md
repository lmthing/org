---
id: build_hook
output:
  slug: string
  ok: boolean
dependsOn: [design, build_table]
forEach: design.hooks
optional: true
role: general
functions: []
---

Write ONE automation hook into the project's `hooks/`. Your hook is in `item` = { slug, purpose }.
Write the FULL `.ts` source inline: its default export is EITHER a cron trigger
(`{ type: 'cron', every: '1d', trigger: '<space>/<agent>#<action>' }`) or a database trigger
(`{ type: 'database', on: { table, event }, trigger }`, where `event` is `insert`|`update`|
`remove`). Ground `table` in a table you designed and `trigger` in a real agent action. Emit:

const h = item;
const table = design.tables[0] ? design.tables[0].name : 'items';
const src = [
  "export default {",
  "  type: 'database',",
  "  on: { table: '" + table + "', event: 'insert' },",
  "  trigger: 'system-appbuilder/app-architect#build_app',",
  "};",
].join("\n");
const w = writeHook(h.slug, src);
// w = { ok, error? }. Rewrite and retry if w.ok is false.
currentTask.resolve({ slug: h.slug, ok: w.ok });
