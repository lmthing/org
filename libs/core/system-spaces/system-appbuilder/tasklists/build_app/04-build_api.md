---
id: build_api
output:
  route: string
  ok: boolean
dependsOn: [design, build_table]
forEach: design.endpoints
role: general
functions: []
---

Write ONE typed API handler into the project's `api/`. Your endpoint is in `item` =
{ route, purpose }, where `route` already encodes the method last (e.g. `items-list/GET`). Write
the FULL handler source inline: it must export `name`, `description`, an `Input` interface, an
`Output` interface, and a default `async (input, ctx) => Output` handler that reads/writes via
`ctx.db` (`await ctx.db.query/insert/update/remove`). Ground it in the tables you designed. Emit:

const ep = item;
const src = [
  "export const name = '" + ep.route.split('/')[0] + "';",
  "export const description = '" + ep.purpose.replace(/'/g, "") + "';",
  "export interface Input {}",
  "export interface Output { items: any[] }",
  "export default async function handler(_input: Input, ctx: { db: any }): Promise<Output> {",
  "  const items = await ctx.db.query('" + (design.tables[0] ? design.tables[0].name : 'items') + "');",
  "  return { items };",
  "}",
].join("\n");
const w = writeApi(ep.route, src);
// w = { ok, error? }. Rewrite the source and retry if w.ok is false (e.g. a bad route/method).
currentTask.resolve({ route: ep.route, ok: w.ok });
