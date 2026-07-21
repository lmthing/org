---
id: design
output:
  slug: string
  goal: string
  actionId: string
  fields: array
  functions: array
  reused: boolean
  dir: string
dependsOn: []
role: explore
functions:
  - listScaffoldedSpaces
  - matchExistingSpace
---

Design the specialist agent from the seed (`topic`, `goal`). This is a PLANNING step: your ONLY
tools are the two dedup functions below (`listScaffoldedSpaces` reads the already-built spaces;
`matchExistingSpace` decides deterministically whether one already covers this topic) — no file or
research tools. Reason from the seed, build the plan object, and resolve it.

**FIRST — do NOT build a duplicate.** `synthesize_and_run` runs once per topic and derives the slug
purely from the topic, so two differently-worded requests for the SAME entity (e.g. "MetLife Silver
pension" vs "Pension — MetLife Silver", or "car insurance" vs "vehicle insurance" for one insurer)
would each mint a second space. Before designing anything, check whether an existing space already
covers this topic and, if so, REUSE it — resolve `reused: true` with the existing slug/dir and an
EMPTY plan, so the downstream build/register steps skip and the same topic yields exactly ONE space.
`matchExistingSpace` is conservative by design: it merges only when the entity AND a qualifier both
match, so genuinely distinct topics (a different provider, or a pension vs a health policy that merely
share a provider) still get their own space. Emit this first:

const existing = listScaffoldedSpaces();
const dup = matchExistingSpace((topic ?? goal ?? "") as string, existing);
if (dup.reused) {
  currentTask.resolve({ slug: dup.slug, goal: (goal ?? topic ?? "") as string, actionId: "answer", fields: [], functions: [], reused: true, dir: dup.dir });
}

Only if `dup.reused` is FALSE do you design a new space. Substitute REAL values for every `<…>` below
(a small model copying `<…>` verbatim is the #1 failure — never leave a placeholder in the resolved
values):

const slug = "<short-lowercase-slug derived from the topic, e.g. cocktail-advisor>";
// KNOWLEDGE FIELDS the agent needs. Each: { domain, field, aspects } where `aspects` is 2-4
// distinct sub-topic slugs (NOT "overview"). Add as many fields as the domain genuinely needs.
const fields = [
  { domain: "<domain_slug>", field: "<field_slug>", aspects: ["<aspect_a>", "<aspect_b>"] }
];
// Deterministic FUNCTIONS the agent needs (math / scoring / lookup). Often none.
// ANNOTATE THE TYPE — keep the annotation below even when the array is empty. An empty array
// literal declared with no type annotation does not typecheck once it is passed on: the checker
// cannot infer an element type and fails with "implicitly has an 'any[]' type". Every rewrite from
// there is a dead end too (redeclaring the name, or assigning to a const, are both errors).
const functions: Array<{ name: string; purpose: string }> = [];   // e.g. [{ name: "scoreMatch", purpose: "score a drink against a mood (0-10)" }]
const actionId = "answer";   // the single action the agent will expose
const goal = "<one-sentence refined goal for the agent>";
currentTask.resolve({ slug, goal, actionId, fields, functions, reused: false, dir: "" });
