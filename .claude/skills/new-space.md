---
name: new-space
description: Load when creating or modifying a space (agents, functions, components, tasklists, knowledge).
---

# Skill: Creating or Modifying a Space

A **space** is a directory that bundles agents, tasklists, functions, components, and knowledge. Loaded by `loadSpace(dir)` in `libs/core/src/spaces/load.ts`.

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
      MyForm.tsx        ← Single TSX form component (catalog components only)
    view/
      MyView.tsx        ← React view component (web only; terminal gets plain text)
  tasklists/
    my-tasklist/
      01-first-task.md
      02-second-task.md
  knowledge/
    domain/
      field/
        index.md        ← frontmatter: type, variable, default; body = OVERVIEW (covers all aspects, surfaced to the agent)
        aspect-a.md     ← one aspect, loaded on demand via loadKnowledge(domain, field, 'aspect-a.md')
        aspect-b.md     ← ≥2 aspects per field; do NOT use a single "overview.md"
```

The field's `index.md` body is captured as `KnowledgeField.description` (`load.ts`) and
rendered in the agent's system prompt, so the overview is always available without a
`loadKnowledge` call; option files hold the per-aspect detail.

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
canDelegateTo:
  - other-space/other-agent
---

You are a helpful assistant that...

(Detailed instructions in markdown. This becomes the "Agent Instructions" section of the system prompt.)
```

- `functions` and `components` scope what is injected into the VM and DTS overlay.
- `canDelegateTo` entries are eager-loaded; their action summaries appear in the system block under "Delegatable Agents".

## Functions (`functions/*.ts`)

Must export a named function matching the filename (without extension):

```typescript
export function myFn(arg: string): void {
  console.log(arg);
}
```

The function is transpiled (TypeScript → JS) and eval'd as a script in the VM, with `globalThis['myFn'] = myFn` appended. Use `console.log/warn/error` freely — they route to `renderHost.log`.

For async functions that return values, they can `await` normally inside the VM context. They cannot call value-yielding globals (`ask`, `sleep`, etc.) — those belong in model-generated code only.

## Form Components (`components/form/<Name>.tsx`)

A **single** TSX file (default export) built from catalog components only, exactly like a view component. The former `web.tsx`/`ink.tsx` two-file split has been removed.

Must define a `Props` interface (or inline type) and export a default React component:

```tsx
import { Slider } from '@lmthing/ui';

interface Props {
  label?: string;
  onSubmit?: (value: number) => void;  // ← mark callbacks optional; runtime injects them
  requiredProp: string;                // ← data props stay required
}

export default function MyForm({ label, requiredProp }: Props) { ... }
```

**Mark all callback props optional** (`onSubmit?`, `onChange?`). The runtime injects the submission handler — the model should never pass callbacks. Data props can stay required.

The overlay DTS generator (`overlay.ts`) automatically makes function-typed props optional in the ambient declaration so the model can write `<MyForm requiredProp="x" />` without providing `onSubmit`.

### Prefer the design system before authoring components

A cross-platform **design-system catalog** (`libs/core/src/ui/catalog.ts`) ships ~30 display + ~33 form components that render on **both** terminal and web with **no per-space files**. Reach for these first:

- **Display** — `display(<Stack><Heading>…</Heading><Table columns={…} rows={…}/><Callout variant="success">…</Callout></Stack>)`. Both renderers (`ink-renderer.tsx`, `conversation.tsx`) interpret the catalog; type names are case-insensitive.
- **Forms** — `const v = await ask(<Form><TextField name="title"/><Select name="env" options={["dev","prod"]}/></Form>)`. A `<Form>` resolves to an object keyed by field `name`; a bare control (`ask(<Select .../>)`) resolves to the single value. Terminal renders an interactive Ink form (`ink-form.tsx`, sequential field stepping); web renders themed controls (`CatalogForm.tsx`). Flattening/coercion is shared via `flattenForm`/`coerceValue` (`libs/core/src/ui/form.ts`).

Only write `components/form/<Name>` when you need custom UI beyond the catalog.

### Theming (web)

Web output is themeable. Components consume `--lm-*` CSS variables (palette + `--radius-lm-*`); the DevTools header toggles light/dark (`libs/ui/src/theme/theme.ts`). A space may ship a `theme.json` (`{ "accent": "#ff8800", "bg": "#101418", … }`) at its root — `serve.ts` injects it as `:root` var overrides.

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
- At most one task may have `goal: true` — this is the tasklist's return value. If none is set, the last task (by file order) is the goal.
- `dependsOn` references other task IDs in the same tasklist.
- `condition` (optional): a condition-DSL expression evaluated against upstream outputs, e.g. `garnish.done == true`.
- `optional: true` means failure is non-blocking.

## Validation Errors

`loadSpace(dir)` throws on:
- Missing `agents/` directory
- Zero agents
- An action's `tasklist` not found in `tasklists/`
- A `config.functions` entry with no matching file in `functions/`

Fix: check filenames and frontmatter match exactly (case-sensitive).

`loadSpace(dir, { requireAgents: false })` relaxes the first two — used for function-only **system spaces** (see below).

## System spaces (always-on toolkit)

Every user space is automatically merged with the **system spaces** in `libs/core/system-spaces/` (`system-global`, `system-engineer`, `system-architect`, `system-research`, `user-memory`, `user-thing`). The `system-global` space's functions are universally injected into every agent — `readFile`/`writeFile`/`editFile`/`glob`/`grep`/`listDir`, `webSearch`/`webFetch`, `remember`/`recall`/`recallAll`/`forget`, and `todoWrite`/`todoRead` — you do NOT declare them in the agent's `functions:` list, and you should not re-implement them. They appear in the system prompt under `# Built-in Tools`.

The user space **wins on name collisions**, so you can override a system tool by defining a function of the same name. To add/modify a system space or a `fork({ role })`, see `@.claude/skills/system-spaces.md`.
