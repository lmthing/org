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
prelude: |
  const entries = Array.isArray(investigate) ? investigate : [];
  const seedSources = (scope && Array.isArray(scope.seedSources)) ? scope.seedSources : [];
  const rawSources = entries.map((e: any) => (e && Array.isArray(e.sources)) ? e.sources : []).flat().concat(seedSources);
  const all_sources = rawSources.filter((s: any) => s && s.url).filter((s: any, i: number, arr: any[]) => arr.findIndex((x: any) => x && x.url === s.url) === i);
  const combined_findings = entries.map((e: any) => "Q: " + String((e && e.question) || "") + "\nConfidence: " + String((e && e.confidence) || "low") + "\nFindings: " + String((e && e.findings) || "") + "\nGaps: " + String((e && e.gaps) || "")).join("\n\n");
  const gap_notes = entries.map((e: any) => String((e && e.gaps) || "")).filter((g: string) => g).join(" ");
---

Organize the raw investigation into themed clusters — you do NOT write the final narrative here,
`summarize` does that next. The mechanical aggregation ALREADY ran (see the prelude results in
scope): `entries` is the array of `{ question, findings, sources, confidence, gaps }`,
`combined_findings` is every entry's findings concatenated for easy reading, `all_sources` is the
deduped union of every entry's sources plus `scope.seedSources` (use it AS-IS — do not rebuild
it), and `gap_notes` collects the per-entry gaps. Read ACROSS the entries (don't just concatenate)
and produce:

- `themes`: an array of `{ heading, detail, confidence, sources }` (4-7 entries). Group entries
  that cover the same underlying theme (not necessarily the same question) under one heading.
  `detail` merges the grounded content from every entry in that group into one substantive
  paragraph. `confidence` for the theme is the weakest confidence among its merged entries (never
  round up). `sources` is the union of that group's `sources`.
- `gaps`: one paragraph rolling up `gap_notes` plus anything you notice the entries disagree on
  or leave unaddressed across the whole topic — be specific, not generic.

If `all_sources` is empty (no investigation found sources and there were no seed sources), say so
plainly in `gaps` and resolve with `themes: []`.

Emit ONE statement:

currentTask.resolve({ topic: plan.topic, themes, all_sources, gaps });
