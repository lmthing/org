---
id: synthesize
output:
  topic: string
  themes: array
  all_sources: array
  gaps: string
dependsOn:
  - scope
  - plan
  - investigate
optional: false
goal: false
role: explore
functions: []
---

Organize the raw investigation into themed clusters — you do NOT write the final narrative here,
`summarize` does that next. `investigate` is an ARRAY of `{ question, findings, sources,
confidence, gaps }` (one entry per planned question). Read ACROSS the entries (don't just
concatenate) and produce:

- `themes`: an array of `{ heading, detail, confidence, sources }` (4-7 entries). Group entries
  that cover the same underlying theme (not necessarily the same question) under one heading.
  `detail` merges the grounded content from every entry in that group into one substantive
  paragraph. `confidence` for the theme is the weakest confidence among its merged entries (never
  round up). `sources` is the union of that group's `sources`.
- `all_sources`: every entry's `sources` PLUS `scope.seedSources`, deduped by URL (drop empties).
- `gaps`: one paragraph rolling up every entry's own `gaps` plus anything you notice the entries
  disagree on or leave unaddressed across the whole topic — be specific, not generic.

If every investigation came back with empty `sources` and `scope.seedSources` is also empty, say
so plainly in `gaps` and resolve with `themes: []` and `all_sources: []`.

Emit one PLAIN TypeScript statement (do NOT wrap it in markdown code fences):

currentTask.resolve({ topic: plan.topic, themes, all_sources, gaps });
