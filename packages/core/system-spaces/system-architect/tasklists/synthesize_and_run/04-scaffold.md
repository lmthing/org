---
id: scaffold
output:
  dir: string
  agentSlug: string
dependsOn: [design]
optional: false
goal: false
---

Write the space files to disk using `scaffoldSpace()`.

Derive the base directory — prefer the project spaces dir if set, otherwise fall back to
stripping the last segment of the architect's own space dir:
```typescript
const base = process.env.LMTHING_PROJECT_SPACES_DIR ?? (process.env.LMTHING_SPACE_DIR ? process.env.LMTHING_SPACE_DIR.replace(/\/[^/]+\/?$/, '') : '/tmp/architect-spaces');
const spaceDir = base + '/' + spec.agentSlug;
```

Then scaffold:
```typescript
const result = scaffoldSpace(spaceDir, spec);
```

`scaffoldSpace` now writes everything from the spec automatically:
- `agents/<slug>/instruct.md` with computed knowledge/functions/components/dependencies frontmatter
- `functions/*.ts` files
- `knowledge/<domain>/<field>/index.md` + `<option>.md` files (from spec.knowledge)
- `components/view/*.tsx` and `components/form/*/{web,ink}.tsx` (from spec.components)
- `tasklists/<name>/NN-<id>.md` files

If `result.ok` is false, display the error and resolve with `{ dir: '', agentSlug: '' }`.
The validate step's condition will block further progress.

On success, resolve with `{ dir: result.dir, agentSlug: spec.agentSlug }`.
