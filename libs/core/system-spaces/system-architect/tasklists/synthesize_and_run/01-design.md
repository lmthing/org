---
id: design
output:
  slug: string
  goal: string
  actionId: string
  fields: array
  functions: array
dependsOn: []
role: explore
functions: []
---

Design the specialist agent from the seed (`topic`, `goal`). This is a PLANNING step: you have no
file or research tools here — just reason from the seed, build the plan object, and resolve it.

Substitute REAL values for every `<…>` below (a small model copying `<…>` verbatim is the #1
failure — never leave a placeholder in the resolved values):

const slug = "<short-lowercase-slug derived from the topic, e.g. cocktail-advisor>";
// KNOWLEDGE FIELDS the agent needs. Each: { domain, field, aspects } where `aspects` is 2-4
// distinct sub-topic slugs (NOT "overview"). Add as many fields as the domain genuinely needs.
const fields = [
  { domain: "<domain_slug>", field: "<field_slug>", aspects: ["<aspect_a>", "<aspect_b>"] }
];
// Deterministic FUNCTIONS the agent needs (math / scoring / lookup). Often none.
const functions = [];   // e.g. [{ name: "scoreMatch", purpose: "score a drink against a mood (0-10)" }]
const actionId = "answer";   // the single action the agent will expose
const goal = "<one-sentence refined goal for the agent>";
currentTask.resolve({ slug, goal, actionId, fields, functions });
