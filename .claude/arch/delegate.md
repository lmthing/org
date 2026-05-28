# Architecture: Delegate + Registry

## Files

- `packages/core/src/delegate/registry.ts` — `DelegateRegistry` (resolves "space/agent" strings)
- `packages/core/src/delegate/delegate.ts` — `runDelegate` (executes the delegation)

## Two Delegation Modes

### Mode 1: Query-based
```typescript
delegate("sommelier/pairing", {
  query: "suggest a wine for pasta carbonara",
  context: { dish: "pasta carbonara" },
  output: { wine: "string", reason: "string" }
})
```
The child agent picks one of its own actions and runs that action's tasklist. Its goal output is coerced to the requested `output` schema.

### Mode 2: Action-based
```typescript
delegate("sommelier/pairing", "suggest_pairing", {
  query: "pasta carbonara",
  context: { dish: "pasta carbonara" }
})
```
Explicitly names the action to run. Skips action selection; runs the named tasklist directly.

## Registry

`DelegateRegistry` maps space directories to loaded `Space` objects:
```typescript
const spaceMap = new Map([[spaceDir, space]]);
const registry = new DelegateRegistry(spaceMap);
```

Currently built in `session.ts:handleYield` for each delegation. In future, could be eagerly populated for all direct dependencies.

`registry.resolve("sommelier/pairing")` splits on `/`, looks up the space, and returns `{ space, agent }`. Throws if not found.

## Execution

`runDelegate` creates a fresh child session (own VM + history) seeded only with the `context` object passed by the caller. The child:
- Never sees parent history
- Receives a system block for its own space/agent
- Runs until it produces a goal output (via a fork/tasklist invocation)
- Returns the goal output to the parent as VARIABLES

## Caps

Enforced across the entire delegation tree:
- `maxDepth` (default 5): how deep delegations can nest. Exceeded → reject.
- `maxConcurrentForks` (default 4): shared concurrency budget across all forks spawned by all delegates in the tree.
- Cycle detection: if a delegation target is already in the active call stack, reject immediately.

These are passed through `runDelegate` opts and decremented/checked at each level.

## Current Implementation Note

In the current session.ts implementation, `DelegateRegistry` is built fresh per `handleYield` call with only the current session's space. For cross-space delegation to work, the registry would need to load the target space lazily. This is a known gap — extend `handleYield` to load the target space and add it to the map when the target space dir differs from `this.opts.spaceDir`.
