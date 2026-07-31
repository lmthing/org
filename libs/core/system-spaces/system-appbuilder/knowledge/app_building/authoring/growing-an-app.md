---
description: LOAD WHEN the project ALREADY has pages and you are adding to it — the most common job you have. Extend a page instead of overwriting it, write into the columns a table HAS, and converge rather than double when you are run twice.
---

# GROWING an app that already exists — ADD a section, never REWRITE a page

Most of your work lands on a project the user has been living in for weeks. "Add an invoices
section" means the app gains a section — it does **not** mean the pages it already had are yours
to re-author from scratch. `writeProjectPage` OVERWRITES the file at that route, so re-authoring
`index` to link to your new section DELETES the dashboard the user had. The app still builds,
every route still returns 200, and the user opens their vault to a stub — the worst kind of
failure, because nothing looks broken. (This happened: a home page that had shown a household's
renewals, policies and accounts came back as `Home · [Invoices]`, while the `vault-dashboard` API
kept happily serving the whole household to nobody.)

So, before you write a page whose route may already exist:

```typescript
const existing = listProjectDir('pages');                       // ['index.tsx', 'bookings.tsx', …]
const home = readProjectFile('pages/index.tsx').content;        // .content — read what is THERE
// …author the NEW source as a SUPERSET of `home`: keep every useApi(...) it already has and
// every section it already renders, then ADD your card/section/link.
const p = writeProjectPage('index', grownSource);
```

The writer enforces this: replacing a page with one that fetches **none** of the API routes it
used to fetch is REJECTED (`refusing to overwrite pages/index.tsx: … this DELETES the section(s)
the user already has`). That is not a bug to route around — it means you rewrote instead of
extending. Read the page, keep its sections, add yours. `writeProjectPage(route, src, { replace:
true })` exists ONLY for when the user explicitly asked you to REMOVE those sections.

The same rule holds for a TABLE the app already has — **write into the columns it HAS, never a
parallel set of your own.** Before you write a row into an existing table (from a hook, an API
route, anywhere), read its schema and use ITS column names:

```typescript
const schema = readProjectFile('database/recipes.json').content;   // title_gr, title_en, cuisine_id, cook_time…
// …now insert with THOSE columns:
db.insert('recipes', { title_gr: 'Ρεβίθια στο φούρνο', cuisine_id: 'cuisine-greek', cook_time: '120' });
```

A hook that files a submitted recipe as `{ title, cuisine, ingredients }` into a `recipes` table
whose pages render `title_gr` / `cuisine_id` produces a row that is **in the database and blank on
the screen** — every column the book renders is NULL. The user submitted a recipe through the app's
own form and it came back as an empty card. (This happened, live, in scenario 10.) `writeProjectTable`
now MERGES a redefinition rather than substituting it — so your invented columns can no longer
un-declare the ones holding every existing row — but the merge only keeps the app rendering; it does
not make YOUR row renderable. Only writing the real columns does that.

If the concept genuinely has no column yet, ADD one (`writeProjectTable` with the extra column) —
adding `is_favourite` to `recipes` is right; adding `title` next to `title_gr` is a duplicate that
splits the data in two. And if the table already has CHILD tables for the detail (`recipe_ingredients`,
`recipe_instructions`), fill those too — a JSON blob in a new `ingredients` column is invisible to the
page that renders the child rows.

`writeProjectHook`/`writeProjectApi` ENFORCE this: source whose `db.insert('t', {…})` or
`db.update('t', { set: {…} })` names a column `t` does not have is REJECTED, with the table's real
columns in the error:

> `db.insert('recipes', …) writes a column the table does not have: "ingredients" (did you mean
> "ingredients_text"?). The columns of "recipes" are: id, title_gr, cuisine_id, ingredients_text, …`

That is not an obstacle to route around — it is the schema telling you what to write. Re-author the
source with the named columns (or add the column first). Guessing `ingredients` at a table that has
`ingredients_text` used to write nothing at all: SQLite threw, the hook's own catch marked the
submission "failed", and the recipe the user filed through the app's form never appeared in the book.

### Running twice must CONVERGE on the same app, never double it

You may be called more than once for the same job — the caller retried, thought your first answer
was incomplete, or split one build across several messages. A second run must leave the app in the
state it would have been in after ONE run. It must not produce a second copy of anything.

Converging is a LOOK-UP you do while building, not a phase you do instead of building:

```typescript
const tables = listProjectDir('database').entries;   // ['invoices.json', …] — what is ALREADY here
// A concept that already has a table: EXTEND that table. Do not create a second one for it.
// A table that already has rows: insert only what is MISSING — match on the row's real identity
// (a policy number, a serial, a date+vendor), never on a count.
const already = db.query('invoices', {});            // → what a previous run already seeded
```

**SURVEYING IS NOT BUILDING.** A turn that ends having only listed what exists has delivered
NOTHING. Discovery is the first few lines of your build — never its output. Do not end a turn
reporting "assessment complete", "current project state", or "ready to build": those are not
deliverables, and the caller now has to ask you again for work you were already asked to do. (This
happened: three consecutive build turns came back with nothing but an inventory of the empty
project — one of them 11 seconds long — and the app only got built on the fourth attempt, when the
caller gave up and shouted the data inline.) The tables, the APIs, the seeded rows and the pages
ARE the output. Keep going until they exist.

**A repair request naming a missing page is a WRITE, not a diagnosis.** If tables or APIs already
exist but the requested app has no page, write the `index` page and its needed read API immediately.
Do not spend that repair turn listing directories, reporting the current state, or asking the caller
to try again: the missing page is the deliverable. Inspect only when preserving an existing page;
an absent page has nothing to preserve.

Two failures this prevents, both of which shipped to a real user's vault:

- **A second table for the same concept.** One run names it `service_log`, the next `services`; one
  says `items`, the next `inventory`. The user opens their app to two sections holding different
  subsets of the same facts, and no way to tell which one is real. If a table for the concept already
  exists — even under a name you would not have chosen — use it. Its name is not yours to improve.
- **Re-seeding rows that are already there.** Every policy in the vault appeared TWICE, and the second
  copy quietly disagreed with the first (a €180/month premium came back as `2160` — annualized by the
  re-seed). Duplicated rows are worse than missing ones: the user cannot tell which figure is true,
  and every count and total the app shows is now wrong.

Seed by matching on the row's real identity (a policy number, a serial, a date+vendor), not by
counting: if `db.query` already returns a row with that policy number, that policy is seeded. Skip it.

**The home page (`index`) is the app's DASHBOARD, not a menu.** It must (a) fetch and render the
project's real data — the counts, the rows, what is due — through a `GET` route (`useApi`), and
(b) link to EVERY page the app has (`listProjectDir('pages')` — a page nothing links to is a page
the user cannot find). A home page with no `useApi` call is an empty app; a home page that links
only to the section you just added has orphaned all the others.
