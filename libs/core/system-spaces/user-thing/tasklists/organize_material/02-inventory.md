---
id: inventory
output:
  topic: string
  goal: string
  research: string
dependsOn: [enumerate]
forEach: enumerate.subjects
role: explore
functions: []
canDelegateTo:
  - system-vision/vision
prelude: |
  const documents = await Promise.all((attachmentIds as string[]).map((id) => readDocument(id)));
  const imageIds = documents
    .filter((d) => d && d.mediaType && String(d.mediaType).startsWith('image/'))
    .map((d) => d.attachmentId);
  const visionDetail = imageIds.length > 0
    ? await delegate('system-vision', 'vision', {
        query: 'Describe everything visible in detail: every distinct item or subject, its own color/material/markings/state, and how many of each.',
        attachmentIds: imageIds,
      })
    : '';
---

Build the specialist scope for ONE subject — `item`, a name from `enumerate.subjects`. The host has
already read every supplied document into `documents` (an image attachment comes back
`{kind:'unsupported'}` there); `request`, `sourceSummary`, `attachmentIds`, and `specialistFacts` are
also in scope, and the source text is authoritative over the short summary — **including images**:
`visionDetail` (delegated straight to the vision specialist in this task's own prelude) is the real
description of every image attachment, and it is what `research.findings` below must quote for any
`item` an image contributes to, not `specialistFacts`' lossy one-line paraphrase of it.

`item` already earned its own entry in the enumeration — a real, distinct scope, not a one-line stub.
Ground it ONLY in the material that belongs to `item`: pull in every fact `documents`/`specialistFacts`/
`visionDetail` carry about it, but do not borrow another subject's facts just because they share a
document or a page, and do not fold `item` into a bigger catch-all here — that is the over-splitting a
LATER step consolidates when two entries genuinely name the same thing, not a reason to merge on sight.

Resolve `{ topic, goal, research }`, where `research` is a JSON-stringifiable object with `topic`,
`executive_summary`, `findings`, `conclusion`, and empty `sources` (supplied material is not web
research). Emit exactly one statement:

```typescript
currentTask.resolve({
  topic: String(item),
  goal: '<what this specialist advises on>',
  research: JSON.stringify({
    topic: String(item),
    executive_summary: '<one-line summary of what is known about item>',
    findings: [ { heading: '<facet>', detail: '<the relevant facts from the supplied material>' } ],
    conclusion: '',
    sources: [],
  }),
});
```
