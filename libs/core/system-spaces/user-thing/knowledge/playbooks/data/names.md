---
description: Table and field names are unchecked strings — how a guessed name silently reads as "no data", and how to recover a throw or an empty result in the same reply.
---

# Verify the name before you conclude anything from the result

**Unsure of the exact table name? Call `db.tables()` first** — it returns the project's real table
list. A guessed name that doesn't exist still typechecks (`table` is a plain string, not a checked
literal): depending on the guess it can either silently return nothing (so a wrong guess and a
genuine miss read identically) OR throw a raw runtime error naming the table you got wrong — either
way, never conclude "no data" from a table name you didn't verify, and never treat the THROW as a
reason to give up.

A thrown error is information, not a stop sign: it is telling you the exact name you guessed is
wrong, so call `db.tables()` (or re-list the app's own endpoints) right there in the SAME reply, find
the real name AMONG WHAT IT RETURNS, and re-issue the call with that name — don't re-guess a second
literal, and don't retreat to a placeholder `display()` because a query failed once.

## The same discipline applies one level down, to FIELD names

`db.tables()` only confirms the TABLE exists; it says nothing about which columns a row actually has.
A `where`/`set` key you pass to `db.query`/`db.update`, or a `.find()`/`.filter()`/`.some()` predicate
you write over rows you already fetched, references a field by a plain string too — a plausible name
that doesn't exist doesn't throw and doesn't fail typecheck, it just silently matches nothing (a
`where`/`set` on a column that isn't there) or silently evaluates false (a predicate checking a field
the row doesn't have) — and either way it reads exactly like "there's nothing here" when there is.

Before you reference a field by name, confirm it: read one real row (`db.query(table, {limit:1})`,
or `inspect(row, {keys:true})` on a row you already hold) and match your code to the keys it
ACTUALLY has, never to the label the request's wording suggests.

And when you're hunting for "the record about X" among a handful of rows, compare X against the row's
actual VALUES, field by field — never `JSON.stringify(row).toLowerCase().includes(x)`: a stringified
row also contains its KEY NAMES, so a generic column every row happens to share can make your search
word match every row regardless of what any of them are actually about, and you'll silently act on
whichever one came first — not the one that's really the answer.

## This discipline is just as binding when you WRITE

The keys you pass to `db.insert`, and the `set` keys of a `db.update`, must be REAL columns. A
guessed column on a write does not fail silently the way a bad predicate does — it THROWS
`no such column`. Treat that throw exactly like a wrong table name: it is information, telling you
the real column isn't what you typed. `inspect` a real row (or `db.query(table, {limit:1})`) for its
actual keys right there in the SAME reply and re-issue the write with the correct ones — never
re-guess a second name, and never abandon the write because it threw once.

## When the direct read keeps fighting you, hand the question off

A typecheck error on a column, a table name that wasn't real, a query you'd have to guess at — that
is your cue for `await tasklist('answer_across_spaces', { query })`, whose reason step verifies the
real tables, runs the queries, and returns prose. What you never do is end the turn on the friction
itself — a table list, row counts, or any inspected value displayed as the "answer" answers nothing.
