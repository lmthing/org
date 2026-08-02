---
description: LOAD WHEN you are about to hand-author a view, a view component or the shell freeform — the two closed vocabularies (8 section kinds, 24 elements), why values are paths and never expressions, what the endpoint must therefore return, and how to say a surface cannot be expressed.
---

## The UI is a SPEC — there is no TSX here, and that is the point

**You do not have `writeProjectPage` or `writeProjectComponent`.** They are not withheld by
instruction; they are not in your capability profile, so they are not injected and they are not in
your type declarations — calling one is a typecheck error, not a rule you could bend. Everything the
user sees is built from two closed vocabularies:

- **12 section kinds** — `list`, `detail`, `create`, `stats`, `markdown`, `chat`, `toolbar`,
  `timeline`, `board`, `calendar`, `chart`, `outlet`. A page is `{ route, title?, sections: [ … ] }`,
  in the order the user reads it.
  - `board` buckets rows into COLUMNS by a `group` binding — the pipeline surface. Moving a card is
    an ordinary `rowActions` mutation; there is no drag.
  - `calendar` places rows on a month grid by a `date` binding.
  - `chart` plots one endpoint's rows: `charts: [{ kind: 'bar'|'line'|'area'|'donut', x, y, series? }]`.
  - `outlet` is legal ONLY in a layout, exactly once — see "A layout" below.
- **32 elements** — `row col grid spacer divider surface` · `heading text caption markdown code
  quote` · `badge statcard meter keyvalue table timeline rating chart calendar steps` · `image icon
  avatar` · `banner empty` · `button link field tabs accordion` — for the item shapes inside sections
  and for reusable components. `field` is the inline-editable control (`toggle`/`rating`/`select`/
  `stepper`/`text`/`date`/`number`/`textarea`/`multiselect`/`slider`): it is how a row lets the user
  change something. `tabs` and `accordion` are the declarative replacement for client state inside an
  element tree, the way `toolbar.reveals` is for whole sections.

## A layout — one frame for a route family

`writeProjectViewLayout(prefix, { sections })` → `views/<prefix>/_layout.view.json`. Every route under
`prefix` renders inside it, at the position marked by its one `{ kind: 'outlet' }` section. Author one
when several pages share an entity header or a sub-nav: the header is fetched ONCE for the family, and
each child page reads it as `$data.<layoutSectionId>.…` instead of repeating the query.

## The assistant is NOT yours to author

Every app has a chat dock, on every page, wired to the project's own agent. It is renderer chrome —
there is no `assistant:` key for you to remember and no way to forget it. The `chat` SECTION is a
different thing: an assistant embedded in the page's own flow, which you author only when the page
IS a conversation.

Values are **paths, never expressions**: `$`, `$.field`, `$props.x`, `$route.<param>`,
`$data.<sectionId>.<path>`, `$result.<field>`, `$form.<field>`, `$client.timezone`. No `? :`, no
arithmetic, no `${…}`. A binding that resolves to null renders NOTHING, which is what replaces every
`x ? … : null` guard. Colour is a semantic `tone` (or a declared `toneMap`), never a hex and never a
class name; formatting is a `format:` modifier on the value.

Because there is no client code, **the endpoint must return everything the section shows.** A name
from another table, a total, a group-by, a "which one is current" pick, a status label, a percentage,
a boolean a control depends on — each is a COMPUTED FIELD on the one endpoint that section reads.
And because there is no `!`, a save/pin/dismiss/archive toggle must be an endpoint that FLIPS the
value server-side when the new value is omitted.

**When the vocabulary genuinely cannot express a surface, SAY SO.** Name the part and the reason
("the compare grid needs a multi-select that drives a query — the spec language has no client
state"). That is a correct, useful answer — there is no other builder to hand it to, so an honest
"this cannot be expressed" IS the deliverable for that part. Forcing the surface into the nearest
section kind is the one failure this
builder is measured on.
