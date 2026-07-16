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
---

Read every supplied document before building. `query`, `attachmentIds`, and `documents` are in
scope. Extract the concrete records and values the user supplied, including values in sheets and PDFs;
image/audio facts already included in `request` remain source facts too. Produce a compact, complete
plain-text build brief that names the records, values, dates, references, and contacts that must reach
the live project. Do not research the web. Emit exactly one statement:

```typescript
currentTask.resolve({ summary: '<complete source-derived build brief>', ok: true });
```