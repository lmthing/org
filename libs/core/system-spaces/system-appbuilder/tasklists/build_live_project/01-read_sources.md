---
id: read_sources
output:
  summary: string
  ok: boolean
dependsOn: []
role: explore
functions: []
prelude: |
  const documents = await Promise.all((attachmentIds as string[]).map((id) => readDocument(id)));
  inspect(documents);
---

Read every supplied document before building. `query`, `attachmentIds`, and `documents` are in
scope. The prelude has already surfaced every readable document's full content in a `DOCUMENT CONTENTS`
block. Read that block before extracting records; do not use the abbreviated `documents` preview as
source evidence. Extract concrete records and values only from the supplied material, including sheets
and PDFs; image/audio facts already included in `request` remain source facts too. Never fill in an
unseen value with a plausible example or a generalization. Produce a compact, complete plain-text build
brief that names the records, values, dates, references, and contacts that must reach the live project.

Transcribe VERBATIM — do not paraphrase away specifics — every one of these, because they are the proof
the sources were parsed and each one is a downstream table row/field:
- **Every identifier and code**: booking/confirmation references, flight numbers, order/permit ids,
  phone numbers, support hotlines (a short alphanumeric code, a dialable number). Copy the exact string.
- **Every numeric cell**: each amount, price, fee, quantity, and any stated total — with its currency
  (USD / TZS) and what row it belongs to. A spreadsheet cell you skip becomes a NULL column later.
- **Every named person, place, date, and any camera/EXIF or capture detail** an image carries.
- **A vision/audio-derived item that ISN'T already in a structured source is its own NEW record, not
  an illustration of one that IS.** A voice memo or photo often shows something the CSV/spreadsheet
  never listed — a new SKU, a new contact, a new attendee, a new stop. State it the same way you would
  a structured row that's missing a value: "NEW <kind> (from photo/audio): <description> — no match in
  <the structured source>." Never describe it merely as "a photo of the X already listed" or fold its
  count into an existing source's total — that phrasing is exactly what makes a downstream planner
  treat it as decoration for a row that already exists and drop its own row entirely.

Do not research the web. Emit exactly one statement:

```typescript
currentTask.resolve({ summary: '<complete source-derived build brief>', ok: true });
```