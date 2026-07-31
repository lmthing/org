A repair is not done until something that failed now passes. Ask for the command and its output,
and put the command into the brief so there is no ambiguity about what "fixed" means.

## Typecheck

The project ships its own `tsconfig.json`:

```
tsc --noEmit -p <projectId>/tsconfig.json
```

This is the best `validateCmd` for `zerostackLoop` in most cases — it is mechanical, fast, and the
loop can read its own failures between iterations.

Caveat: a clean typecheck says nothing about whether the schema is *valid*, whether a route is
reachable, or whether the page renders. It is necessary, not sufficient.

## The database

`<projectId>/.data/app.db` is plain SQLite. Reading it directly is the fastest way to settle the
question that most "the list is empty" bugs turn on: **are there rows?**

- No rows → the write path is broken (or the data was never seeded). Stop looking at the page.
- Rows present but the API returns none → the read path: a missing `await`, a wrong table name, a
  filter that matches nothing.

Read it; do not edit it as a fix. A row inserted by hand papers over the bug that stopped the app
from inserting it.

## The page build

`.data/pages-build/` and `.data/pages-cache.json` carry the last build result, and `.data/pages-dist/`
the output. An empty or stale `pages-dist/` with a healthy `pages/` means the build failed — find
that error before touching the source, because edits against a stale bundle appear to change
nothing and send the investigation somewhere else entirely.

## Schema validity

After any change to `database/*.json`, confirm every table still validates: each column described,
exactly one primary key per table, every reference resolving to a table that exists. Then confirm
`types/generated.d.ts` agrees with the schemas — a divergence between them bricks app boot, and it
is exactly what a hand-edit to the generated file creates.

## Running it

Ask zerostack to actually exercise the thing that was broken — call the handler, run the script,
execute the code path. "It should now work" is the phrase that most reliably marks an unverified
fix, and when you see it in a result, send it back to run something.

## What proof to report

Name the command and quote what it printed. If nothing was run, say that plainly: an unverified
change is a real outcome, and reporting it honestly is worth far more than a confident summary that
turns out to be wrong.
