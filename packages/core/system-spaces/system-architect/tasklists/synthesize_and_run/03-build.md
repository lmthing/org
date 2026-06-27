---
id: build
output:
  spaceDir: string
  agentSlug: string
  actionId: string
  ok: boolean
  errors: string
dependsOn: [understand, research]
optional: false
goal: false
---

Build the specialist agent **one file at a time** using the per-file builder functions,
then validate. There is NO giant spec object — you write each file with a small call and
get immediate feedback (a broken function is rejected by typecheck the moment you write it).

## Step 1 — Pick the space slug

You only choose a NAME. You do NOT compute a path, touch `process.env`, or build a `dir` —
the builder functions store everything under the project's spaces dir for you (the host
decides where: `.lmthing/<project>/spaces/<slug>`, default `.lmthing/user/spaces/<slug>`).

```typescript
const space = '<short_lowercase_slug>';   // e.g. "board-game-explainer" — used as the first arg to every builder
```

**Do NOT stop after this.** The builders in Step 2 are SYNCHRONOUS — their results are not
shown back to you, so there is nothing to wait for. Keep emitting statements through Step 4's
`currentTask.resolve(...)` in the same flow; pausing strands the build with no files written.

## Step 2 — Write the files (each call writes exactly ONE file; all are SYNC, no await)

**Create as many knowledge fields as the domain genuinely needs to be covered well** — a rich
domain may warrant many fields. Each field = an `index.md` OVERVIEW + 2+ aspect option files.
The agent SEES every field's overview in its prompt automatically, so adding fields costs the
agent little at runtime (it loads only the specific aspects it needs).

**CRITICAL: You MUST write ALL files (knowledge, agent, task) AND run `validateSpace` AND call `currentTask.resolve(...)` in the EXACT SAME TURN. Never resolve early with an incomplete build.**

Every builder takes the **space slug** (`space`) as its first arg — never a path. Write in any
order; `validateSpace` at the end checks the whole thing. Each builder returns `{ ok, ... }` —
check `.ok` and fix before continuing. Available builders:

- `writeAgentFile(space, { agentSlug, agentTitle, systemPrompt, knowledge?, functions?, components?, actions, defaultAction?, canDelegateTo? })`
  — the agent's `instruct.md`. List the knowledge refs (`"<domain>/<field>"` field-level, or
  `"<domain>/<field>/<option>"` to preload an option into the prompt), function names, and
  component names you WILL add; declare your `actions` (each `{ id, label, description, tasklist }`).
  `canDelegateTo` is optional (delegation targets like `"space/agent"` or `"agent#action"`).
  **systemPrompt: 2-3 imperative sentences** describing what the agent IS and its domain — NEVER a
  numbered "## Process". If you include knowledge, the systemPrompt must tell the agent to call
  `await loadKnowledge('<domain>', '<field>', '<option>.md')` (note the `.md` suffix).
  The agent runs AUTONOMOUSLY: it receives the user's request as `query` and answers it directly.
  Write the prompt to work from `query` — e.g. "Answer the user's `query` directly; if details are
  missing, assume sensible defaults and state them." Never write interactive, "ask the user…" steps.
  For the "useful UI" part: tell the agent to run its action's tasklist, then `display(...)` the
  structured result using built-in catalog components (e.g. `<Stack>` with `<Callout>` / `<Table>`),
  and finally `currentTask.resolve(result)`. Keep it to one display call — don't over-engineer.
  `tasklist()`/`delegate()` return loosely-typed values, so the agent can read result fields directly
  (e.g. `const result = await tasklist('diagnose', {}); display(<Callout>{result.diagnosis}</Callout>);`)
  — no cast needed.
- `writeTaskFile(space, tasklist, { id: string, instruction: string, output: Record<string, string>, dependsOn?: string[], goal?: boolean, optional?: boolean, condition?: string })`
  — one task file. Mark exactly ONE task per tasklist `goal: true` (its output is the final answer).
  **`output` MUST be a JS object — NEVER a string:**
  ```typescript
  // ✗ WRONG — these will fail at runtime:
  //   output: 'answer'
  //   output: 'answer: string'
  //   output: 'answer: string, sources: string[]'
  // ✓ RIGHT — an object mapping field names to type strings:
  //   output: { answer: 'string' }
  //   output: { answer: 'string', sources: 'string[]' }
  ```
  **Prefer `string` / `string[]` field types** (markdown or JSON-stringified content). Avoid bare
  `object` / `array` field types: the runtime validates the resolved value against the schema, and a
  small model frequently resolves an `object` field with a slightly-off shape → "Fork output does not
  match schema" and a wasted retry. Put structured data in a stringified field instead (e.g.
  `output: { itinerary: 'string', summary: 'string' }`, resolving `JSON.stringify(...)` or markdown).
  **Every task instruction MUST end with an explicit `currentTask.resolve({...})`** filling the
  fields named in its `output`. One task is enough for most agents.

  **🔑 TASK INSTRUCTIONS MUST BE AUTONOMOUS AND CODE-FIRST (the #1 cause of a synthesized agent
  failing at runtime).** The task runs in a fork driven by a SMALL model that has the user's request
  injected as `query` (a seed variable) plus any upstream task outputs. Write the instruction so the
  model emits CODE immediately — short, imperative, no conversational framing. Each instruction MUST:
  - **Use the injected `query`** as the full user input. NEVER write interactive "ask the user…" or
    "prompt for…" steps. If parameters are missing, instruct it to assume sensible defaults and note them.
  - **Open with the concrete code steps**, e.g. load knowledge → compute → resolve. Do NOT write a
    long prose paragraph first; a small model will mirror prose back (e.g. "I'll start by…") and burn
    the whole turn on typecheck errors.
  - **End with `currentTask.resolve({...})`** populating every `output` field.
  Template for a typical single goal task (adapt fields to the domain):
  ```typescript
  // instruction body for the goal task — note: starts with code, uses `query`, never asks:
  // "You answer the user's espresso question. The user's request is in `query`.
  //  Load knowledge, then produce a structured answer. Code:
  //  const k = await loadKnowledge('espresso','fundamentals','overview.md');
  //  Using `query` and `k`, decide the diagnosis and recommendation. If the user gave no
  //  parameters, assume a typical 18g→36g/30s shot and say so.
  //  currentTask.resolve({ diagnosis: '<your structured markdown answer>', recommendation: '<next-shot params>' });"
  ```
  Prefer a **structured `output`** (e.g. `{ summary: 'string', recommendation: 'string', sources: 'string' }`)
  over a single opaque string so the agent can render it as real UI (see below) — this satisfies the
  "useful UI" part of most requests without a custom component.
- `writeKnowledgeIndex(space, domain, field, { variable, default?, type?, description })` — the field manifest.
  **`description` is the field's OVERVIEW and becomes the index.md body** — a short paragraph that
  SUMMARIZES ALL the option files: introduce each aspect so the agent knows what each option covers and
  which to load. The agent always sees this overview in its prompt — make it substantive, not a label.
- `writeKnowledgeOption(space, domain, field, slug, content)` — one option `.md` (markdown body, no
  frontmatter) covering ONE specific ASPECT of the field. Write **at least 2 aspect options per field**,
  each a distinct sub-topic. Do NOT create a single `overview.md` — the overview goes in index.md (above).
  Keep each option brief (max 1–2 paragraphs).
- `writeFunctionFile(space, name, source)` — one space function. Single-export TS, NO imports, host
  primitives only. Returns `{ ok, errors }`; if `ok` is false, read `errors` and rewrite. Add a
  function when the domain needs deterministic computation (math, schedules, scoring, conversions,
  generators). **If the user explicitly asks for a "function"/"tool"/"calculator" that computes
  something, you MUST create it with writeFunctionFile and declare it on the agent — do NOT inline that
  logic in the task.** A small model is far more reliable calling a tested function than re-deriving
  math each turn. (Skip a function only for pure look-up/text agents.)
- `writeComponentFile(space, 'view'|'form', name, source)` — ONLY when the built-in catalog (~30 display
  + ~33 form components: Stack, Table, Callout, Form, Select…) can't express the UI. Usually skip this.

**Thread the researched knowledge in — DERIVE refs from what you WRITE, never hardcode.**
Research is optional and its domains/fields/option-slugs are whatever the research step
produced. `validateSpace` rejects any declared `knowledge:` ref or `loadKnowledge(...)` call
that points at a file you didn't write. So the agent's knowledge list and the systemPrompt's
`loadKnowledge` lines must be COMPUTED from `kn`, not invented:

```typescript
const kn = Array.isArray(research?.knowledge) ? research.knowledge : [];
// 1. For each field: writeKnowledgeIndex ONCE with `description` = the field OVERVIEW
//    (entry.description — becomes index.md body), then writeKnowledgeOption for EACH of
//    entry.options (the ≥2 aspect files). Loop over kn + entry.options.
// 2. Build the agent's knowledge refs from what you wrote, NOT from a hand-written list:
const knowledgeRefs = kn.map((e) => e.domain + '/' + e.field);   // ["chess_rules/pieces", ...]
// 3. Pass knowledgeRefs as writeAgentFile's `knowledge`. If kn is empty, pass `knowledge: []`.
```

**Do NOT make the agent bulk-load every field.** The agent's prompt ALREADY shows every field's
overview, so it must NOT pre-load or `inspect` all fields (with many fields that thrashes). Instead,
the systemPrompt (and the goal task instruction) should tell it to call
`await loadKnowledge('<domain>', '<field>', '<aspect>.md')` for ONLY the 1–3 specific aspects relevant
to the current `query`, on demand. Reference real aspect slugs from `kn` (`e.options[i].slug`), never
`overview`. Example line to embed: "Consult the field overviews above; for detail, load the specific
aspect you need, e.g. `await loadKnowledge('espresso','grind_size','dialing_in.md')`."

NEVER write a `loadKnowledge('x','y','z.md')` for a `z` slug that isn't in `kn` — it will
fail validation (and would fail at runtime). The overview is in index.md (auto-surfaced); the
`z` you load must be a real ASPECT slug from `e.options`, never `overview`.

## Step 3 — Validate (the gate)

```typescript
const v = validateSpace(space);
```

`validateSpace` checks every declared function/knowledge/component/tasklist exists and that each
tasklist has exactly one `goal: true` task. If `v.ok` is false, read `v.errors`, fix the offending
file with the matching builder, and re-run `validateSpace`. It returns `{ ok, errors, dir }` — `dir`
is the resolved absolute path the register step needs (you never construct it yourself).

## Step 4 — Resolve

```typescript
currentTask.resolve({
  spaceDir: v.dir,                      // resolved path from validateSpace — do NOT build it
  agentSlug: space,                     // the slug you chose in Step 1
  actionId: '<your first action id>',
  ok: v.ok,
  errors: v.ok ? '' : v.errors.join('; '),
});
```

Do NOT call `delegate()` here — it is not available in fork context. The register + execute steps
that follow handle live registration and running.
