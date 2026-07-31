Generated apps fail in a small number of recurring shapes. Suspect them in this order — the cheap
checks are also the common ones.

## The app is entirely blank / boot throws

**Schema divergence or an invalid table schema.** `database/*.json` is validated fail-loud: a
missing column description, zero or two primary keys, or a reference to a table that does not exist
aborts the *whole* app boot. One bad table therefore presents as the entire app being dead.

Read every `database/*.json`, not just the one you suspect. The error naming table A is often
caused by table B's dangling reference.

**A collapsed layout.** If the app boots and the HTML is present but the screen is empty, this is
not a data bug at all — a container with zero height renders an app blank while every build and
validation step passes. Structural checks (the accessibility tree, server-rendered markup) list the
content correctly, so they cannot see it. Walk the ancestor chain from the empty element up,
looking for a height that resolves to zero.

## An endpoint 404s

**The filename is not the HTTP method.** `api/todos/handler.ts` or `api/todos/index.ts` is not
routed. It must be `GET.ts`, `POST.ts`, `PUT.ts`, `PATCH.ts` or `DELETE.ts`. This one is by far the
most common generated-app routing bug and costs nothing to check.

**The directory nesting is wrong**, or a dynamic segment is written `:id` instead of `[id]`.

## A handler returns nothing, or the UI shows `undefined`

**A missing `await`.** `ctx.db` is an async proxy to the main process. `const rows = ctx.db.query(...)`
does not throw — it assigns a pending Promise where rows were expected, and everything downstream
quietly operates on the wrong thing. Grep the handler for `ctx.db`, `ctx.apiCall` and `ctx.spawn`
without an `await` before investigating anything else.

## The page will not build

**Server code imported into a browser bundle.** `pages/` and `components/` are bundled for the
browser: `node:*`, anything under `api/`, and `better-sqlite3` are all build failures. Data reaches
a page only through `useApi` / `useApiMutation` / `apiCall` from `@app/runtime`.

**A stale build.** An empty or old `.data/pages-dist/` alongside healthy `pages/` almost always
means the last build *failed*. Find the error in the build output rather than re-editing the source
blind — editing against a stale bundle produces changes that appear to do nothing.

## A type error that will not go away

**Someone edited `types/generated.d.ts`.** It is regenerated from `database/*.json`. The fix is
always in the schema.

## A hook never fires

**The event name is not source-qualified.** It must be `<sourceId>/<name>`, e.g.
`project/db.recipes.insert`. A bare `db.recipes.insert` matches nothing and fails silently.

**It is a `{type:'database'}` hook.** That kind was removed. Database writes auto-emit
`project/db.<table>.<event>` with the written row as the payload; subscribe with an `event` hook.

## A CI/style failure that looks fine on screen

**A raw color.** LMThing forbids hex, literal `rgb()`/`hsl()`, and stock Tailwind palette utilities
(`gray-500`, `blue-600`) in any web surface. Use design tokens — `var(--foreground)`, `bg-primary`.
This is a hard gate even when the rendering is correct.
