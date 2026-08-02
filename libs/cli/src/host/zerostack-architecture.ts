/**
 * The ARCHITECTURE.md written into the data directory for zerostack to read.
 *
 * ## Why this is long, and why it is here
 *
 * zerostack is a strong general engineer that has never seen this codebase and cannot reach it —
 * the runtime that interprets everything in the data directory lives in the pod image under
 * `/app`, which its file tools cannot read. So the things that make LMThing's on-disk formats
 * *unguessable* have to arrive as text, or every repair starts by rediscovering them badly:
 * `api/` filenames ARE the HTTP method, `ctx.db` is an async proxy whose missing `await` fails
 * silently, a page is a `.view.json` spec rather than TSX, `types/generated.d.ts` and `.data/` are
 * generated, and `system/spaces/` is re-materialized on every boot so edits there vanish.
 *
 * It also exists because its ABSENCE is a prompt: with no `ARCHITECTURE.md` in the working
 * directory zerostack asks "No ARCHITECTURE.md found … Create one? [y/N]", and it asks even under
 * `-p`.
 *
 * ## The split with AGENTS.md
 *
 * Both files are loaded as context. They must not repeat each other:
 * - **This file** is the REFERENCE — what LMThing is, what is in the data directory, and the exact
 *   shape of every format.
 * - **`AGENTS.md`** (`./zerostack-agents.ts`) is the RULES — what never to touch, how to verify a
 *   fix, how to report back.
 *
 * Everything below is grounded in `org/docs/`, which is this repo's source of truth. When a format
 * changes there, change it here in the same commit — a primer that lies is worse than none,
 * because it is the only description of this system zerostack will ever see.
 */

export const ZEROSTACK_ARCHITECTURE_MD = `# LMThing — architecture, and the directory you are standing in

You are an AI coding agent running inside an **LMThing compute pod**, with your working directory
set to that user's **data root**. This document explains what LMThing is, what is in this
directory, and the exact on-disk shape of everything you may be asked to fix.

Read \`AGENTS.md\` alongside this for the operating rules (what is off-limits, how to verify, how to
report). This file is the reference; that one is the contract.

---

## 1. What LMThing is

LMThing is a system where **AI agents build and run software for one person**. A user talks to an
agent; the agent writes and edits real files — database schemas, HTTP handlers, pages, automations
— and those files immediately *become* a running web application, with no build step the user ever
sees and no deploy.

Three facts about the wider system explain almost everything about this directory:

1. **Every user gets their own private pod.** A single-tenant container running \`lmthing serve\`.
   It holds their data, runs their agents, and serves their apps. Nothing here is shared with
   another user. The directory you are in is that pod's persistent volume.

2. **The model writes TypeScript; it does not call tools.** LMThing's agents emit TypeScript one
   statement at a time, and the pod evaluates each statement as it streams in, inside a **QuickJS
   WASM sandbox**. There is no shell and no filesystem on that surface. This is why *you* exist:
   you are the one component in the system with a real shell and real file access.

3. **A project IS an application.** There is no separate "app" concept. A project directory with a
   \`database/\`, an \`api/\`, some pages and some hooks is a live, served web app. Edit those
   files and the app changes.

### The pieces outside this directory

You cannot reach these, but you need to know they exist, because they are what interprets the
files you edit:

| Piece | What it does |
|---|---|
| the pod runtime (\`/app\`) | \`lmthing serve\` — loads this directory, runs agents, serves apps |
| the gateway | auth, billing, pod control. The pod talks to it; you do not |
| LiteLLM | the model proxy every agent (including you) runs through |
| the SPAs | chat / studio / computer — the web UIs the user sees |

**The bug is almost never in the runtime.** It is in the data: a schema, a handler, a page spec, a
hook. You cannot change the runtime, and you very rarely need to.

---

## 2. The data directory

\`\`\`
./                              <- you are here (the LMThing data root)
├── AGENTS.md                   your operating rules      (generated each boot — do not edit)
├── ARCHITECTURE.md             this file                 (generated each boot — do not edit)
├── system/spaces/              the shipped system agents (RE-MATERIALIZED EACH BOOT — read-only)
├── uploads/                    files the user uploaded
├── sessions-ledger.jsonl       per-session token/cost bookkeeping
├── .zerostack/                 your own config + session store (leave it alone)
└── <projectId>/                ONE DIRECTORY PER PROJECT — this is where the work is
\`\`\`

\`user\` is the default project. Every other directory here is a project the user created.

### Inside a project

\`\`\`
<projectId>/
├── project.json                { id, name/title, icon } — the descriptor
├── package.json                npm metadata + the app's react/@lmthing deps
├── tsconfig.json               the app's typecheck config
├── instructions.md             the project's standing instructions for its agents
├── database/<table>.json       TABLE SCHEMAS — one file per table
├── api/**/<METHOD>.ts          HTTP handlers — route is the DIRECTORY, method is the FILENAME
├── pages/<route>.view.json     PAGES, as specs (+ a GENERATED <route>.tsx wrapper beside each)
├── pages/components/*.view.json   reusable element compositions
├── pages/_shell.view.json      the app shell: nav, brand, assistant dock
├── components/*.tsx            React components (only in older//catalog apps that use TSX pages)
├── functions/*.ts              reusable helpers
├── hooks/<slug>.ts             automation: cron | event | webhook
├── events/<name>.ts            typed emitter defs (event PRODUCERS)
├── spaces/<id>/                the project's own AI agents
├── documents/                  documents the user uploaded to this project
├── types/generated.d.ts        GENERATED from database/*.json — NEVER hand-edit
└── .data/                      GENERATED — app.db, pages-build/, pages-dist/, pages-cache.json
\`\`\`

**How the layers connect.** A change ripples downward, and this is the single most useful mental
model for diagnosing anything here:

\`\`\`
database/*.json   declares tables
      |                 v
      |            .data/app.db   (real SQLite)
      v                 ^
types/generated.d.ts    | async ctx.db proxy
                        |
api/**/<METHOD>.ts  ----+   handlers read/write rows
      ^
      | useApi / useApiMutation / apiCall  (by endpoint NAME, never by URL)
      |
pages/*.view.json   sections bind to ONE endpoint each

hooks/*.ts  <-- cron ticks, and events the database emits on every write
\`\`\`

---

## 3. \`database/<table>.json\` — table schemas

One JSON file per table. **The table name is the file basename** and is not stored inside the JSON:
\`database/articles.json\` defines table \`articles\`. Table names are snake_case
(\`^[a-z][a-z0-9_]*$\`). Each file is compiled into a real \`CREATE TABLE\` at boot, into
\`.data/app.db\`, with \`PRAGMA foreign_keys=ON\`.

\`\`\`json
{
  "title": "Articles",
  "description": "A synthesized article shown in the user's feed.",
  "columns": {
    "id":        { "type": "string",  "description": "unique id", "primaryKey": true, "generated": "uuid" },
    "title":     { "type": "string",  "description": "headline shown in the feed", "required": true },
    "score":     { "type": "number",  "description": "relevance rank; higher surfaces first", "default": 0 },
    "read":      { "type": "boolean", "description": "whether the user opened it", "default": false },
    "tags":      { "type": "json",    "description": "topic tag strings" },
    "createdAt": { "type": "date",    "description": "when it entered the feed", "generated": "now" }
  },
  "relations": {
    "citations": { "hasMany": "citations", "via": "articleId", "description": "sources it was built from" }
  }
}
\`\`\`

**Column types are exactly five**: \`string | number | boolean | date | json\`. Anything else
throws. \`date\` is an ISO string; \`json\` is an arbitrary JSON value.

**Validation is fail-loud, and it takes the whole app down.** Each of these throws at load:

- a missing or blank table \`description\`;
- a missing or blank \`description\` on **any** column;
- zero columns;
- not **exactly one** \`primaryKey\` column;
- an unknown \`type\`, or a \`generated\` other than \`uuid\` / \`now\`;
- a relation pointing at a table that does not exist.

So **one bad schema file presents to the user as the entire application being dead** — not as one
broken table. When an app boots blank or throws at startup, read *every* \`database/*.json\`, not
just the one you suspect: the error naming table A is often caused by table B's dangling relation.

Per-column flags: \`required\` emits \`NOT NULL\`, \`unique\` emits \`UNIQUE\` (both skipped on the
primary key), \`generated: "uuid" | "now"\` auto-fills on insert, \`default\` supplies a default.

---

## 4. \`api/**/<METHOD>.ts\` — HTTP handlers

**The route is the directory path; the HTTP method is the FILENAME.**

\`\`\`
api/articles/[id]/GET.ts   ->  GET  /articles/:id
api/sources/POST.ts        ->  POST /sources
\`\`\`

Only five filenames are routed: \`GET.ts\`, \`POST.ts\`, \`PUT.ts\`, \`PATCH.ts\`, \`DELETE.ts\`.
**Any other \`.ts\` in a route directory is ignored entirely** — helpers and \`types.ts\` are safe
to put there, but a handler named \`handler.ts\` or \`index.ts\` is not routed at all. That single
fact explains a large share of "the endpoint 404s" reports.

A \`[seg]\` directory is a dynamic parameter and becomes \`:seg\` in the route.

### The module contract

\`\`\`ts
import { HttpError } from '@app/runtime';        // throw this for 4xx/5xx

export const name = 'getArticle';                // stable id — MUST be unique in the project
export const description = 'Get one article by id, with its citations.';

export interface Input { id: string }            // becomes the request JSON Schema
export type Output = Article;                    // becomes the response JSON Schema

export default async function handler(input: Input, ctx: Ctx): Promise<Output> {
  const rows = await ctx.db.query('articles', { where: { id: input.id }, include: ['citations'] });
  const article = rows[0];
  if (!article) throw new HttpError(404, 'article not found');
  return article;
}
\`\`\`

- **\`name\` is required and must be unique per project.** It is read by a *static parse*, not by
  evaluating the module. A missing \`name\`, or a duplicate anywhere in the project, throws at load.
  It is also the id that pages use to call the endpoint — they never build a URL.
- **\`Input\` / \`Output\`** are turned into JSON Schema per endpoint. This matters beyond
  documentation: a \`create\` page section **derives its form fields from the endpoint's \`Input\`
  schema**. An endpoint with no request body renders a form with "Nothing to fill in." above a Save
  button.
- **default export** is the async handler.

### \`ctx.db\` is ASYNC — the highest-yield bug in this codebase

Handlers run **worker-isolated** in Node; the worker is a crash boundary and every database write
executes in the main process. \`ctx.db\`, \`ctx.apiCall\` and \`ctx.spawn\` are therefore **async
proxies**, and every call returns a Promise.

A missing \`await\` **does not throw**. It assigns a pending Promise where rows were expected, and
everything downstream operates on the wrong thing — the endpoint returns \`{}\` or \`null\`, the
page renders empty, and nothing anywhere reports an error.

> When a handler "returns nothing", or the UI shows \`undefined\` with a 200 response, grep the
> handler for \`ctx.db\`, \`ctx.apiCall\` and \`ctx.spawn\` without an \`await\` **before** you
> investigate anything else.

\`ctx.db\` verbs: \`query(table, opts)\`, \`insert\`, \`update\`, \`remove\`. \`query\` takes
\`{ where, include, orderBy, limit }\`; \`include\` follows a declared relation.

---

## 5. \`pages/\` — the UI is a SPEC, not React

This is the format most likely to surprise you. **A page in a generated app is a validated JSON
object, not a React component.**

| path | what it is |
|---|---|
| \`pages/<route>.view.json\` | the page spec — **this is what you edit** |
| \`pages/<route>.tsx\` | a GENERATED wrapper that renders it — **never hand-edit** |
| \`pages/components/<Name>.view.json\` | a reusable element composition |
| \`pages/_shell.view.json\` | the app shell: nav, brand, assistant dock |

The wrapper \`.tsx\` exists so the page build pipeline never has to know specs exist — routing,
hashing, caching and bundling are unchanged. It is regenerated from the spec; editing it is
overwritten, and editing it *instead of* the spec is a common wasted repair.

The same spec renders on the web **and natively in the mobile app**, which is why there is no React
escape hatch.

### The shape

A page is \`{ route, title?, layout?, sections }\`. **Eight section kinds, and the set is closed:**

\`list\` · \`detail\` · \`create\` · \`stats\` · \`markdown\` · \`chat\` · \`toolbar\` · \`timeline\`

Elements inside a section come from a closed catalogue of 24: \`row col grid spacer divider surface
heading text caption markdown badge statcard meter keyvalue table timeline rating image icon banner
empty button link field\`.

**Bindings are paths, never expressions.** There are exactly eight roots:

\`$\` · \`$.field\` · \`$props.x\` · \`$route.param\` · \`$data.<sectionId>.path\` · \`$result.field\` ·
\`$form.field\` · \`$client.timezone\`

There is **no** ternary, no arithmetic, no string interpolation, and no \`!\`. Two consequences
follow, and they are the usual cause of "the page can't show that":

- **The endpoint must return everything the section displays.** A name from another table, a total,
  a group-by, a percentage, a status label, a boolean a control depends on — each has to be a
  **computed field on the one endpoint that section reads**. There is no client-side code to derive
  it.
- **A toggle must be an endpoint that flips the value server-side**, because there is no \`!\` to
  negate with.

If a surface genuinely cannot be expressed in this vocabulary, **say so and name the part**. That
is the correct answer; there is no other builder to hand it to.

### The older TSX medium

Some apps — mainly ones installed from the store catalog — have real \`pages/*.tsx\` React routes.
They are still served. File routing: \`index.tsx\` collapses to its directory, \`[id]\` becomes
\`:id\`, and \`_app.tsx\` / \`_layout.tsx\` are wrappers rather than routes.

**A page is browser code.** It reaches data only through \`@app/runtime\`:

| import | purpose |
|---|---|
| \`useApi(name, input?)\` | read an endpoint; returns \`{ data, error, isLoading, refetch }\` |
| \`useApiMutation(name, { invalidates? })\` | write; returns \`{ mutate, isPending, error }\` |
| \`apiCall(name, input?)\` | one-shot imperative call |
| \`Link\`, \`navigate\`, \`useParams\` | client-side routing |

\`name\` is the endpoint's exported \`name\`, never a URL. An import of \`node:*\`, of anything
under \`api/\`, or of \`better-sqlite3\` from a page is a **build** failure, not a runtime one.

---

## 6. \`hooks/<slug>.ts\` — automation

Each file default-exports exactly one hook def; the slug is the filename. Three types:

| \`type\` | fires on |
|---|---|
| \`cron\` | a schedule — exactly one of \`every\` or \`daily\` |
| \`event\` | a **source-qualified** event address |
| \`webhook\` | an external inbound POST to a bound \`path\` |

Every \`cron\` and \`event\` hook must carry **exactly one** of:

- \`trigger: 'space/agent#action'\` — hands the work to an AI agent (spends model budget), or
- \`handler: async (ctx) => …\` — a plain Node function, no model involved. \`ctx\` gives
  \`{ db, delegate, callConnection, tasklist, input }\`.

Declaring both, or neither, throws.

### Two things that silently break hooks

1. **The event address must be source-qualified.** \`project/db.recipes.insert\` matches;
   a bare \`db.recipes.insert\` matches nothing, silently.
2. **\`{ type: 'database' }\` no longer exists.** It was removed outright. To react to a database
   write, subscribe an \`event\` hook to the synthetic \`project/db.<table>.<insert|update|delete>\`
   address — the payload **is** the written row.

\`\`\`ts
export default {
  type: 'event',
  on: { event: 'project/db.recipes.insert' },
  handler: async (ctx) => {
    const row = ctx.input;             // the inserted row
    await ctx.db.update('recipes', { where: { id: row.id }, set: { indexed: true } });
  },
};
\`\`\`

---

## 7. \`spaces/\` — the agents

A **space** is a bundle of AI specialists. They live at \`<projectId>/spaces/<id>/\` (the project's
own) and \`system/spaces/<name>/\` (the shipped ones — read-only, see below).

\`\`\`
<space>/
├── agents/<slug>/
│   ├── charter.md      identity + guardrails (body only, NO frontmatter)
│   └── instruct.md     YAML frontmatter (config) + operating instructions
├── functions/<fn>.ts   deterministic TypeScript helpers — no model in the loop
├── knowledge/<domain>/<field>/    index.md + one .md per aspect, loaded on demand
├── tasklists/<slug>/   index.md + NN-<id>.md DAG steps
├── components/{view,form}/<Name>.tsx
├── events/<name>.ts    emitter defs
└── hooks/<slug>.ts     event consumers
\`\`\`

### Space loading is fail-loud and ALL-OR-NOTHING

One bad reference aborts the **entire space**, so every agent in it disappears at once. The symptom
is almost always \`Agent "x" not found\` rather than anything resembling the real mistake. Each of
these throws at load:

- **A frontmatter key outside the allow-list.** It is exactly: \`title\`, \`knowledge\`,
  \`functions\`, \`components\`, \`actions\`, \`defaultAction\`, \`canDelegateTo\`,
  \`dependencies\`, \`capabilities\`, \`model\`, \`triggers\`. A near-miss like \`capabilties\`
  aborts the load — deliberately, because silently granting nothing would be worse.
- **A \`functions:\` entry with no matching file** in that space's own \`functions/\` directory.
  Note it must be a *sibling*: an agent cannot name a function from another space.
- **A \`components:\` entry** in neither \`components/view/\` nor \`components/form/\`.
- **A \`knowledge:\` ref** whose \`<domain>/<field>[/<aspect>]\` does not resolve.
- **An \`actions[].tasklist\`** naming a directory that does not exist.

> When an agent "is not found", read its whole \`instruct.md\` frontmatter against that list before
> anything else. It is nearly always one line of YAML.

**\`canDelegateTo\` is the exception** — it points *across* spaces, so the loader cannot check it.
A typo there fails silently at runtime: the agent simply never delegates and improvises instead.
Entries look like \`space/agent\` or \`space/agent#action\`; \`[]\` means no delegation and
\`["*"]\` means unrestricted.

### Space functions run in a sandbox

A \`functions/<fn>.ts\` file is plain TypeScript; the **export name must equal the file basename**.
There is no frontmatter and no model — the source is injected into the agent's QuickJS VM and
called as ordinary code.

Inside that sandbox there is **no filesystem, no \`child_process\`, and no Node built-ins**. A
function that needs the outside world uses \`fetch\`. If you are fixing a space function, do not
reach for \`fs\` or \`path\` — they are not there, and the failure is a confusing runtime error
about an undefined global rather than a clear import error.

### Capabilities decide what an agent can do

An agent's \`capabilities:\` frontmatter grants globals — \`db:read\`, \`db:write\`, \`db:schema\`,
\`api:write\`, \`views:write\`, \`hooks:write\`, \`project:manage\`, \`store:read\`, and so on.

The rule that matters when you are debugging: **not granted means not injected AND absent from the
type declarations.** So calling an ungranted global is a *typecheck* error, not a runtime one, and
not a rule the model could bend. If an agent "refuses" to write a page, check whether it holds
\`views:write\` — the sole UI-authoring grant. A page is validated view-spec data (there is no
freehand-TSX writer in the system), so a missing \`views:write\` is why the author isn't there.

---

## 8. Generated, and never hand-edited

| path | why |
|---|---|
| \`<project>/types/generated.d.ts\` | derived from \`database/*.json\`. Editing it silences a type error only until the next build. **If a type is wrong, the schema is wrong.** |
| \`<project>/.data/\` | \`app.db\` (SQLite), \`pages-build/\`, \`pages-dist/\`, \`pages-cache.json\`. **Read \`app.db\` freely** — it is often the fastest diagnostic — but never make it the target of a fix. |
| \`pages/<route>.tsx\` (beside a \`.view.json\`) | regenerated from the spec |
| \`system/spaces/\` | **re-materialized from the container image on every boot.** Changes are erased with no error and no trace. Read it as the best available reference for how a space should look; write your fixes into the *project*. |
| \`AGENTS.md\`, \`ARCHITECTURE.md\` | rewritten by the pod on every boot |

---

## 9. Diagnosing — symptom to cause

| symptom | look here first |
|---|---|
| whole app blank, or boot throws | a \`database/*.json\` that fails validation, or a schema/generated-types divergence. Read every schema file |
| app renders but the screen is empty | a layout container collapsed to zero height. Not a data bug — structural checks all pass and still show nothing |
| endpoint 404s | the handler file is not named \`<METHOD>.ts\`, or the directory nesting is wrong |
| handler returns nothing; UI shows \`undefined\` | a missing \`await\` on the async \`ctx.db\` proxy |
| a create form says "Nothing to fill in." | the endpoint it submits to declares no \`Input\` body |
| a page cannot show a value | there is no client code — that value must become a computed field on the endpoint |
| page will not build | server code imported into a browser bundle (\`node:*\`, \`api/\`, \`better-sqlite3\`) |
| edits to a page seem to do nothing | you edited the generated \`.tsx\` instead of the \`.view.json\`; or the last build failed and \`pages-dist/\` is stale |
| a type error that will not go away | someone edited \`types/generated.d.ts\` instead of the schema |
| \`Agent "x" not found\` | a bad ref in that space — one line of frontmatter aborted the whole space |
| an agent never delegates | a \`canDelegateTo\` typo; nothing validates it |
| a hook never fires | an unqualified event name, or a removed \`{type:'database'}\` hook |
| a fix "worked" then reverted | it was written into \`system/spaces/\` |

---

## 10. Verifying a fix

Do not report a repair you have not exercised.

- **Typecheck the app** — each project ships its own config:
  \`tsc --noEmit -p <projectId>/tsconfig.json\`. This is the best mechanical finish line, and the
  right thing to give a validation loop. It is necessary, not sufficient: it says nothing about
  whether a schema validates, a route is reachable, or a page renders.
- **Read the database directly** — \`<projectId>/.data/app.db\` is plain SQLite. It settles the
  question most "the list is empty" bugs turn on: *are there rows?* No rows means the write path is
  broken; rows present but the API returns none means the read path is.
- **Read the build output** — \`.data/pages-build/\` and \`.data/pages-cache.json\` hold the last
  page-build result. An empty or stale \`pages-dist/\` beside a healthy \`pages/\` means the build
  **failed**; find that error before editing further.
- **Re-check schema validity** after any \`database/*.json\` change: every column described,
  exactly one primary key, every relation resolving.
- **Run the thing that was broken.** "It should now work" is the phrase that most reliably marks an
  unverified fix.

---

## 11. Style rules that are enforced

**Never write a raw colour in any web surface.** No hex, no literal \`rgb()\`/\`hsl()\`, no stock
Tailwind palette utilities (\`gray-500\`, \`blue-600\`). Use design tokens — \`var(--foreground)\`,
\`bg-primary\`. This is a hard CI gate and fails even when the rendering looks correct. (View specs
mostly avoid the issue: they carry \`tone\`/\`toneMap\`, not colours.)

TypeScript in this repo is strict. Match the surrounding file's conventions — quote style and
semicolons vary per package, so read the neighbours rather than assuming.
`;
