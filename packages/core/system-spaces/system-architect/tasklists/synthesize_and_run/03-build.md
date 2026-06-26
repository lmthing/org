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
- `writeTaskFile(space, tasklist, { id, instruction, output, dependsOn?, goal?, optional?, condition? })`
  — one task file. Mark exactly ONE task per tasklist `goal: true` (its output is the final answer).
  **Every task instruction MUST end with an explicit `currentTask.resolve({...})`** filling the
  fields named in its `output`. One task is enough for most agents.
- `writeKnowledgeIndex(space, domain, field, { variable, default?, type?, description })` — the field manifest.
- `writeKnowledgeOption(space, domain, field, slug, content)` — one option `.md` (markdown body, no frontmatter).
- `writeFunctionFile(space, name, source)` — one space function. Single-export TS, NO imports, host
  primitives only. Returns `{ ok, errors }`; if `ok` is false, read `errors` and rewrite. Only add a
  function if domain logic genuinely can't use readFileRaw/writeFileRaw/execShell/fetch/process.env.
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
