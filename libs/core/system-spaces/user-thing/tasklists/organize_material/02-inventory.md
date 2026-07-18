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
prelude: |
  const documents = await Promise.all((attachmentIds as string[]).map((id) => readDocument(id)));
---

Build the specialist scope for ONE subject — `item`, a name from `enumerate.subjects`. The host has
already read every supplied document into `documents`; `request`, `sourceSummary`, `attachmentIds`,
and `specialistFacts` are also in scope, and the source text is authoritative over the short summary.

`item` already earned its own entry in the enumeration — a real, distinct scope, not a one-line stub.
Ground it ONLY in the material that belongs to `item`: pull in every fact `documents`/`specialistFacts`
carry about it, but do not borrow another subject's facts just because they share a document or a page,
and do not fold `item` into a bigger catch-all here — that is the over-splitting a LATER step
consolidates when two entries genuinely name the same thing, not a reason to merge on sight.

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
