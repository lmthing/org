# Architecture: Spaces

## Files

- `packages/core/src/spaces/load.ts` — `loadSpace(dir): Promise<Space>`
- `packages/core/src/spaces/frontmatter.ts` — YAML frontmatter parser
- `packages/core/src/spaces/agent.ts` — `getAgentFunctions`
- `packages/core/src/spaces/components.ts` — `getAgentComponents`

## Space Type

```typescript
interface Space {
  dir: string;
  agents: Record<string, AgentDef>;
  tasklists: Record<string, TasklistDir>;
  functions: Record<string, string>;         // name → TypeScript source
  components: {
    view: Record<string, string>;            // name → source
    form: Record<string, { web: string; ink: string }>;  // name → {web, ink}
  };
  knowledge: KnowledgeTree;
}

interface AgentDef {
  slug: string;
  title: string;
  instructBody: string;
  actions: ActionDef[];
  dependencies: string[];    // "space/agent" strings
  config: AgentConfig;       // { knowledge, functions, components }
}
```

## Loading Order

`loadSpace` loads everything eagerly:
1. `agents/` — each subdirectory → `loadAgent`
2. `tasklists/` → sorted `.md` files per tasklist
3. `functions/` → TypeScript source strings
4. `components/form/<Name>/{web,ink}.tsx` + `components/view/<Name>.tsx`
5. `knowledge/<domain>/<field>/` tree

## Agent Loading

`loadAgent(agentsDir, slug)` reads a single file: `instruct.md`.

All agent configuration lives in its YAML frontmatter:
- `title` — display name (defaults to slug)
- `knowledge`, `functions`, `components` — string arrays for scoping
- `actions[]` — `{id, label, description, tasklist}` entries
- `dependencies[]` — `"space/agent"` strings

The body of `instruct.md` (after the frontmatter) is the system prompt (`instructBody`).

## Scoping

`getAgentFunctions(space, agent)` filters `space.functions` to only the names listed in `agent.config.functions`.

`getAgentComponents(space, agent)` filters `space.components` to only the names listed in `agent.config.components`, returning `{ view: {...}, form: {...} }`.

This scoping is applied:
1. For the **system block** — only agent-specific symbols appear in the prompt
2. For the **DTS overlay** — only agent-specific symbols are declared
3. For **function injection** — only agent functions are evaled into the VM

## Validation

`loadSpace` throws on:
- No `agents/` directory
- Zero agent subdirectories
- Any `action.tasklist` that has no corresponding key in `tasklists`
- Any `config.functions` entry with no file in `functions/`

No validation for component names — missing components silently produce fallback declarations.

## File Conventions

| Path | Required | Contains |
|------|----------|---------|
| `agents/<slug>/instruct.md` | yes | frontmatter with all agent config + body = system prompt |
| `package.json` | no | npm dependencies for space functions; triggers `npm install` on `loadSpace` |
| `functions/<name>.ts` | no | `export function <name>(...) { ... }`; bundled with esbuild when `node_modules` present |
| `components/form/<Name>/web.tsx` | no | React component with `interface Props` |
| `components/form/<Name>/ink.tsx` | no | Ink component |
| `components/view/<Name>.tsx` | no | React view component |
| `tasklists/<slug>/<N>-<id>.md` | no | `---\nid: X\noutput: {...}\n---\ninstruction` |
| `knowledge/<domain>/<field>/index.md` | no | frontmatter: `type`, `variable`, `default`; body = field description |
| `knowledge/<domain>/<field>/<option>.md` | no | knowledge content |

## Dependencies

If a space has a `package.json`, `loadSpace` runs `npm install` automatically when `node_modules` is missing. Functions in `functions/` are then bundled with esbuild (`bundle: true`, `format: 'esm'`, `platform: 'browser'`) so their npm imports are inlined before injection into the QuickJS VM. `Space.nodeModulesDir` is set to the installed `node_modules` path.

## Space-to-Space Dependencies (npm spaces)

A space can declare other spaces as npm dependencies. Any `package.json` dependency whose installed directory contains an `agents/` folder is treated as a **dependent space** and loaded eagerly into `Space.dependentSpaces` (keyed by npm package name).

### Agent `dependencies` in `instruct.md`

```yaml
dependencies:
  - "@my-org/cooking-space/chef"   # specific agent from an npm space
  - "@my-org/cooking-space/*"      # all agents from an npm space
  - "sommelier/pairing"            # legacy: match by last dir component
```

`resolveDirectDeps(space, dependencies)` (in `spaces/agent.ts`) expands these to `ResolvedDep[]` — each with `{ space, agent, target }` where `target` is the exact string for `delegate()`.

### Delegation

The `DelegateRegistry` is seeded with dependent spaces (keyed by package name and dir) so `delegate("@my-org/space", "agent", "action_id", ...)` resolves correctly at runtime. The system block's **Delegatable Agents** section shows the exact `delegate()` call for each resolved dep.
