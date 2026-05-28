# Architecture: Delegate + Registry

## Files

- `packages/core/src/delegate/registry.ts` — `DelegateRegistry` (resolves package/agent strings to loaded Space + AgentDef)
- `packages/core/src/delegate/delegate.ts` — `runDelegate` (executes the delegation)

## Signature

```typescript
delegate(packageName, agentName, action, opts?)
```

- `packageName` — npm package name of the target space (e.g. `"@my-org/sommelier"`) or a legacy dir-component name (e.g. `"sommelier"`)
- `agentName` — agent slug within that space (e.g. `"pairing"`)
- `action` — action ID to run (required; no query-only mode)
- `opts?` — `{ query?: string; context?: unknown }`

Example:
```typescript
delegate("@my-org/sommelier", "pairing", "suggest_pairing", {
  query: "pasta carbonara",
  context: { dish: "pasta carbonara" }
})
```

## Registry

`DelegateRegistry` maps arbitrary string keys to loaded `Space` objects. Both the space's directory path and its npm package name are registered as keys, so resolution works for both formats.

```typescript
const spaceMap = new Map<string, Space>();
spaceMap.set(spaceDir, space);
for (const [pkgName, depSpace] of Object.entries(space.dependentSpaces)) {
  spaceMap.set(pkgName, depSpace);
  spaceMap.set(depSpace.dir, depSpace);
}
const registry = new DelegateRegistry(spaceMap);
```

`registry.resolve(target)` splits at the last `/`, checks `space.packageName`, `space.dir`, and last dir component via `matchesSpace`. `registry.resolveLazy(target)` falls back to loading from the filesystem when not found.

`registry.addSpace(key, space)` adds a space without overwriting an existing entry — used by `runDelegate` to seed nested registries with the resolved space's own `dependentSpaces`.

## Execution

`runDelegate` creates a fresh child session (own VM + history). The child:
- Receives a system block built from its own space/agent + its own `directDeps`
- Is seeded only with the `context` passed by the caller
- Runs until it produces a goal output (via a `tasklist()` call)
- Returns the goal output to the parent as VARIABLES

## Caps

Enforced across the entire delegation tree:
- `maxDepth` (default 5): how deep delegations can nest. Exceeded → reject.
- `maxConcurrentForks` (default 4): shared concurrency budget across all forks in the tree.
- Cycle detection: if the target is already in the active call stack, reject immediately.

These are passed through `RunDelegateOpts` and decremented/checked at each level.
