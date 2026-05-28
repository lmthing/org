# Skill: Creating or Modifying a Space

A **space** is a directory that bundles agents, tasklists, functions, components, and knowledge. Loaded by `loadSpace(dir)` in `packages/core/src/spaces/load.ts`.

## Minimal Space Layout

```
my-space/
  agents/
    my-agent/
      instruct.md       ← required (frontmatter = all config, body = system prompt)
  functions/
    myFn.ts             ← TypeScript, export function myFn(...)
  components/
    form/
      MyForm/
        web.tsx         ← React form component with Props interface
        ink.tsx         ← Ink terminal version
    view/
      MyView.tsx        ← React view component (web only; terminal gets plain text)
  tasklists/
    my-tasklist/
      01-first-task.md
      02-second-task.md
  knowledge/
    domain/
      field/
        _field.md       ← frontmatter: type, variable, default
        option-a.md
        option-b.md
```

## `agents/<slug>/instruct.md`

All agent configuration lives in a single frontmatter block. The body is the system prompt.

```markdown
---
title: My Agent
knowledge: []
functions:
  - myFn
  - otherFn
components:
  - MyForm
  - MyView
actions:
  - id: do_thing
    label: Do Thing
    description: Runs the thing tasklist
    tasklist: my-tasklist
dependencies:
  - other-space/other-agent
---

You are a helpful assistant that...

(Detailed instructions in markdown. This becomes the "Agent Instructions" section of the system prompt.)
```

- `functions` and `components` scope what is injected into the VM and DTS overlay.
- `dependencies` are eager-loaded; their action summaries appear in the system block under "Delegatable Agents".

## Functions (`functions/*.ts`)

Must export a named function matching the filename (without extension):

```typescript
export function myFn(arg: string): void {
  console.log(arg);
}
```

The function is transpiled (TypeScript → JS) and eval'd as a script in the VM, with `globalThis['myFn'] = myFn` appended. Use `console.log/warn/error` freely — they route to `renderHost.log`.

For async functions that return values, they can `await` normally inside the VM context. They cannot call value-yielding globals (`ask`, `sleep`, etc.) — those belong in model-generated code only.

## Form Components (`components/form/<Name>/web.tsx`)

Must define a `Props` interface and export a default React component:

```tsx
interface Props {
  label?: string;
  onSubmit?: (value: T) => void;   // ← mark callbacks optional; runtime injects them
  requiredProp: string;            // ← data props stay required
}

export default function MyForm({ label, requiredProp }: Props) { ... }
```

**Mark all callback props optional** (`onSubmit?`, `onChange?`). The runtime injects the submission handler — the model should never pass callbacks. Data props can stay required.

The overlay DTS generator (`overlay.ts`) automatically makes function-typed props optional in the ambient declaration so the model can write `<MyForm requiredProp="x" />` without providing `onSubmit`.

The `ink.tsx` sibling uses Ink + `ink-text-input` instead of React DOM.

## Tasklist Files (`tasklists/<name>/<N>-<id>.md`)

```markdown
---
id: boil_water
output:
  water_ready: boolean
dependsOn: []
optional: false
goal: false
---

Boil the water. Confirm when the pot is at a full rolling boil.
```

- Files are sorted by numeric prefix (`01-`, `02-`, ...).
- Exactly one task must have `goal: true` — this is the tasklist's return value.
- `dependsOn` references other task IDs in the same tasklist.
- `condition` (optional): a condition-DSL expression evaluated against upstream outputs, e.g. `garnish.done == true`.
- `optional: true` means failure is non-blocking.

## Validation Errors

`loadSpace` throws on:
- Missing `agents/` directory
- Zero agents
- An action's `tasklist` not found in `tasklists/`
- A `config.functions` entry with no matching file in `functions/`

Fix: check filenames and frontmatter match exactly (case-sensitive).
