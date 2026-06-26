# Architecture: Delegate + Registry

## Files

- `packages/core/src/delegate/registry.ts` — `DelegateRegistry` (resolves package/agent strings to loaded Space + AgentDef)
- `packages/core/src/delegate/delegate.ts` — `runDelegate` (executes the delegation)

## Signature

```typescript
delegate(packageName, agentName, action?, opts?)
```

- `packageName` — npm package name of the target space (e.g. `"@my-org/sommelier"`), a legacy dir-component name, a space dir path, or `LMTHING_SPACE_DIR`
- `agentName` — agent slug within that space (e.g. `"pairing"`)
- `action` — **optional** action ID to run. Omit it to run the child model-driven (it sees its own `# Actions` and may run one of its tasklists or just `currentTask.resolve()`). `runDelegate` only throws on a *specified-but-missing* action.
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

`runDelegate` always calls `registry.resolveLazy(target)`, which looks up the map first then falls back to loading the space from the filesystem (by dir path) when not cached.

`registry.addSpace(key, space)` adds a space without overwriting an existing entry — used by `runDelegate` to seed nested registries with the resolved space's own `dependentSpaces`.

## Execution

`runDelegate` creates a fresh child session (own VM + history). The child:
- Receives a system block built from its own space/agent + its own `directDeps`
- Is seeded with `context` passed by the caller (and `query` as a free-text instruction)
- Has a `currentTask` global injected with `{ resolve(value) }` — the child must call `currentTask.resolve(result)` to return a value
- Runs `runTurnLoop` until the model calls `currentTask.resolve(...)`, then returns `capturedResult` to the parent

## Caps

Enforced across the entire delegation tree:
- `maxDepth` (default 5): how deep delegations can nest. Exceeded → reject.
- `maxConcurrentForks` (default 4): shared concurrency budget across all forks in the tree.
- Cycle detection: if the target is already in the active call stack, reject immediately.

These are passed through `RunDelegateOpts` and decremented/checked at each level.

## Invariants / gotchas

- **`delegate()`'s `action` is optional.** `delegate(pkg, agent)` (or `delegate(pkg, agent, opts)`) runs the child **model-driven**: no `actionDef` is required, the child sees its own `# Actions` in its system prompt, and may run one of their tasklists or just `currentTask.resolve()`. Passing an `action` keeps the original behavior. `runDelegate` only throws on a *specified-but-missing* action.
- **Delegate auto-captures tasklist result.** When a delegate agent calls `tasklist(name)` whose `name` is one of the agent's action tasklists, the result is automatically set as `capturedResult` even without an explicit `currentTask.resolve()` call. With a specific `action` the capturable set is just that action's tasklist; with **no action** (model-driven delegation) it is ALL of the agent's action tasklists. Prevents silent null returns when the model forgets to call resolve after the tasklist.
- **Delegate user message guides tasklist use.** When the action has a `tasklist` field, the delegate user message includes an explicit hint: `Implement this action by calling tasklist("name", context)`. Prevents the model from writing direct code that bypasses the orchestration and leaves the result uncaptured.
- **A delegate that calls a bare `global` tool it doesn't declare needs the universal toolkit in its overlay.** `runDelegate` folds `systemFunctionSources` into both the typecheck overlay and the system block — so e.g. the `memory` agent (which calls `remember()`) resolves the universal tool. Without this the typecheck overlay would reject the call.
- **`defaultAction` agent frontmatter → deterministic session routing (weak-model robustness).** An `AgentDef.defaultAction` (a string action id with a tasklist) makes `Session.start` run that action's tasklist via the reliable delegate path (which auto-captures the tasklist result) **instead of the model-driven turn loop** — then, if the action returns `{spaceKey, agentSlug, actionId}` (a builder action), it chains a second delegate to that new space so the final answer shows. The weak model only handles small salvage-backed sub-tasks inside the DAG; the multi-step orchestration can't be truncated. The architect declares `defaultAction: synthesize_and_run`; `writeAgentFile` auto-sets `defaultAction` for any synthesized agent that has exactly one action. `session.continue()` is unaffected (only the first freeform turn routes).
