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

**HARD LIMIT: maximum 3 knowledge fields total.** If research produced 6–8 fields, merge
related topics under broader headings (e.g. merge "history"+"mythology"+"archaeology" →
"history_and_lore"; merge "demographics"+"economy"+"infrastructure" → "practical"). Writing
more than 3 fields risks hitting output limits mid-build and corrupting the program.

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
  `tasklist()` returns `unknown`, so the agent prompt must show CASTING the result to its field shape,
  e.g. `const result = await tasklist('diagnose', {}) as { diagnosis: string; recommendation: string };`
  — without the cast, `result.x` fails typecheck ("'result' is of type 'unknown'") and wastes a turn.
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
- `writeKnowledgeOption(space, domain, field, slug, content)` — one option `.md` (markdown body, no frontmatter). Keep content extremely brief (max 1–2 paragraphs).
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
// 1. Write every option file the research produced (writeKnowledgeIndex once per field,
//    writeKnowledgeOption once per option) — do this in a loop over kn + entry.options.
// 2. Build the agent's knowledge refs from what you wrote, NOT from a hand-written list:
const knowledgeRefs = kn.map((e) => e.domain + '/' + e.field);   // ["gavdos/overview", ...]
// 3. Build the loadKnowledge lines for the systemPrompt from the SAME data, using the real
//    option slugs (slug + '.md'), e.g. for the first option of each field:
const loadLines = kn
  .map((e) => "await loadKnowledge('" + e.domain + "', '" + e.field + "', '" + e.options[0].slug + ".md')")
  .join('; ');
// 4. Pass knowledgeRefs as writeAgentFile's `knowledge`, and embed `loadLines` verbatim in
//    the systemPrompt. If kn is empty, pass `knowledge: []` and write NO loadKnowledge calls.
```

NEVER write a `loadKnowledge('x','y','z.md')` for a `z` slug that isn't in `kn` — it will
fail validation (and would fail at runtime). When in doubt, reference only `e.options[0].slug`.

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
