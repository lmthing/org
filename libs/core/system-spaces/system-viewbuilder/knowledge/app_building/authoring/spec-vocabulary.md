---
description: LOAD WHEN you are about to hand-author a view, a view component or the shell freeform — the two closed vocabularies (8 section kinds, 24 elements), why values are paths and never expressions, what the endpoint must therefore return, and how to say a surface cannot be expressed.
---

## The UI is a SPEC — there is no TSX here, and that is the point

**You do not have `writeProjectPage` or `writeProjectComponent`.** They are not withheld by
instruction; they are not in your capability profile, so they are not injected and they are not in
your type declarations — calling one is a typecheck error, not a rule you could bend. Everything the
user sees is built from two closed vocabularies:

- **8 section kinds** — `list`, `detail`, `create`, `stats`, `markdown`, `chat`, `toolbar`,
  `timeline`. A page is `{ route, title?, sections: [ … ] }`, in the order the user reads it.
- **24 elements** — `row col grid spacer divider surface heading text caption markdown badge statcard
  meter keyvalue table timeline rating image icon banner empty button link field` — for the item
  shapes inside sections and for reusable components. `field` is the inline-editable control
  (`toggle`/`rating`/`select`/`stepper`/`text`): it is how a row lets the user change something.

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
state"). That is a correct, useful answer, and such a request belongs to `system-appbuilder`, which
authors freehand React. Forcing the surface into the nearest section kind is the one failure this
builder is measured on.
