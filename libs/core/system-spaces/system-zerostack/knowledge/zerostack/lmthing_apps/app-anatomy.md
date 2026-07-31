Every path is relative to the LMThing data root, which is zerostack's working directory.

```
<projectId>/                    one dir per project; `user` is the default
├── project.json                descriptor { id, name/title, icon }
├── package.json                npm metadata + the app's react/@lmthing deps
├── tsconfig.json               the app's typecheck config
├── instructions.md             the project's own standing instructions
├── database/*.json             TABLE SCHEMAS — one file per table, name = basename
├── api/**/<METHOD>.ts          HTTP handlers — route is the DIRECTORY, method is the FILENAME
├── pages/*.tsx                 client-side React routes, esbuild-bundled per project
├── components/*.tsx            shared components imported by pages
├── hooks/*.ts                  in-proc automation: cron | event | webhook
├── events/*.ts                 (optional) typed emitter defs
├── spaces/*/                   project-scoped spaces (the app's own agents)
├── documents/                  user-uploaded documents
├── types/generated.d.ts        GENERATED from database/*.json — never hand-edit
└── .data/                      GENERATED — app.db, pages-build/, pages-dist/, pages-cache.json
```

## The four pillars

**`database/<table>.json`** — one JSON per table; the file's basename *is* the table name. Turned
into real `CREATE TABLE` statements in `.data/app.db` with `PRAGMA foreign_keys=ON`. Validated
fail-loud: every column needs a description, exactly one primary key, and references must resolve.
A schema that fails validation aborts the whole app boot — which presents as the entire app being
dead, not as one bad table.

**`api/**/<METHOD>.ts`** — the route is the directory path, the HTTP method is the **filename**:
`api/todos/GET.ts` → `GET /api/todos`; `api/todos/[id]/PUT.ts` → `PUT /api/todos/:id`. `[seg]`
becomes `:seg`. Each handler should `export const name` as its stable agent-facing id, unique per
project. A handler in a file named anything else is not routed at all.

Handlers run **worker-isolated** in Node. `ctx.db`, `ctx.apiCall` and `ctx.spawn` are **async
proxies to the main process** — every one returns a Promise. The worker is a crash boundary and
every database write executes main-side.

**`pages/*.tsx`** — client-side React routes, esbuild-bundled per project. `index.tsx` is the
directory path, `[id]` becomes `:id`, and `_app`/`_layout` are wrappers rather than routes. Pages
reach data only through `useApi` / `useApiMutation` / `apiCall` from `@app/runtime`. They are
browser bundles: an import of `node:*`, of anything under `api/`, or of `better-sqlite3` is a build
failure.

**`hooks/*.ts`** — three kinds: `cron` (declarative `trigger` only), `event` (subscribes to a
source-qualified `<sourceId>/<name>`), and `webhook` (external inbound POST). A hook is either
declarative (`trigger: 'space/agent#action'`) or imperative (`handler(ctx)`).

> `{type:'database'}` hooks were **removed**. A database write auto-emits a synthetic
> `project/db.<table>.<insert|update|delete>` event whose payload IS the written row; subscribe to
> that with an `event` hook.

## Generated — never hand-edit

- **`types/generated.d.ts`** — derived from `database/*.json`. Editing it silences a type error for
  exactly as long as it takes the next build to overwrite you. If a type is wrong, the schema is
  wrong.
- **`.data/`** — `app.db` (SQLite), `pages-build/`, `pages-dist/`, `pages-cache.json`. Read
  `app.db` freely; it is often the fastest way to see what a handler is really failing on. Do not
  make it the target of a fix.

## Also in the data root

- **`system/spaces/`** — the shipped system spaces. Re-materialized from the container image on
  every boot: edits vanish silently. Excellent reference, never a fix target.
- **`uploads/`**, **`sessions-ledger.jsonl`** — user uploads and session bookkeeping.
