A brief has four parts. Missing any one of them is the usual reason a call comes back useless.

**1. Where.** The absolute-ish path from the data root: `user/pages/todos.tsx`, or just
`the project "recipe-box"`. zerostack starts in the data root and can find things, but a search it
does not have to run is a search that cannot find the wrong file.

**2. What is wrong.** The symptom as observed, not your theory. "The todos page renders an empty
list; the API returns 200" is worth more than "I think the query is broken" — a theory in the brief
narrows its search to your guess, and if you are wrong it will not look anywhere else.

**3. What "fixed" means.** State the observable outcome. "The page lists the rows that are in
`.data/app.db`." Without this it will stop at the first plausible change.

**4. How to prove it.** Name the command. `tsc --noEmit -p <project>/tsconfig.json`. Reading the
SQLite file directly. If you cannot name one, say so explicitly and ask it to find one — that is a
legitimate sub-task, and it is better than leaving the question unasked.

## Add the context it cannot have

Everything from your `zerostack/lmthing_apps` knowledge that bears on the symptom goes **into the
brief**, not left for it to discover. `api/` filenames being HTTP methods, `ctx.db` being async,
`types/generated.d.ts` being generated — these are unguessable, and each one costs it several
minutes and several wrong turns to work out from scratch, if it works it out at all.

## A brief that works

```
In the project "recipe-box" (./recipe-box from the data root), the recipes list page
renders empty. GET /api/recipes returns 200 with an empty array, but .data/app.db has
14 rows in the recipes table.

Notes on this codebase you will not guess:
- api/ handler filenames ARE the HTTP method: api/recipes/GET.ts serves GET /api/recipes.
- ctx.db is an ASYNC proxy to the main process. A missing await does not throw — it
  returns a pending Promise where rows were expected. Check this first.
- Do not edit types/generated.d.ts or anything under .data/ — both are generated.

Fixed means: GET /api/recipes returns the 14 rows.
Prove it by reading .data/app.db directly and by running the handler.
```

## What not to do

- **Do not send a wall of source.** It has the files. Send paths.
- **Do not ask two unrelated things in one brief.** It will do the first well and the second badly.
  Two calls on the same `sessionId` cost less than one confused answer.
- **Do not say "fix everything" or "clean this up".** With no finish line it will keep going until
  the timeout, and you will get a large diff nobody asked for.
- **Do not pre-approve destructive work.** Never write "delete the database and rebuild it" into a
  brief. The data directory is the person's only copy.
