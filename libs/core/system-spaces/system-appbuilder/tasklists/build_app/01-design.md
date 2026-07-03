---
id: design
output:
  appId: string
  title: string
  tables: array
  pages: array
  endpoints: array
  hooks: array
dependsOn: []
role: general
functions: []
---

Design the whole app from `request`. This is the THINKING step: reason from the request into a
concrete build plan, then resolve it. You have no file tools here — just produce the plan object.

Substitute REAL values for every `<…>` below (never leave a placeholder in the resolved values).
Derive a short lowercase-slug `appId` from the request (letters/digits/hyphen, starts with a
letter). Each endpoint `route` MUST encode its HTTP method last, e.g. `items-list/GET` or
`items-create/POST`. Each page `route` is `index` (the app root) or a path like `items/[id]`.

const appId = "<lowercase-slug derived from the request, e.g. habit-tracker>";
const title = "<human-readable app title>";
// Each table: { name, schema } where schema = { title, description, columns:{...}, relations? }.
// Every column and relation needs a description; exactly one primaryKey column (uuid).
const tables = [
  { name: "<table_slug>", schema: { title: "<Title>", description: "<what it stores>", columns: { id: { type: "string", description: "unique id", primaryKey: true, generated: "uuid" } } } }
];
// Each endpoint: { route: "<name>/<METHOD>", purpose }. Methods: GET|POST|PUT|PATCH|DELETE.
const endpoints = [
  { route: "<name>/GET", purpose: "<what this endpoint returns or does>" }
];
// Each page: { route, purpose }. Use "index" for the root page.
const pages = [
  { route: "index", purpose: "<what the root page shows>" }
];
// Each hook (often none): { slug, purpose }. Cron or database-triggered automation.
const hooks = [];
currentTask.resolve({ appId, title, tables, pages, endpoints, hooks });
