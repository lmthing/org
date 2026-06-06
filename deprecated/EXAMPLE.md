# REPL v2 — Annotated Example

A single walkthrough that exercises every rule in `REPL2_DESIGN.md`. The cooking
space drives a `make pasta` tasklist and delegates wine pairing to another space.

Block tags: `ts system` (auto-generated context), `md user` (user/harness messages),
`ts assistant` (LLM-generated code), `ts host` (host-injected, **invisible to the LLM**).

---

## 1. System block — auto-generated at session start

Generated from the active agent's space. Globals are always injected. Only the
**direct** dependency agents are listed with their action summaries (deeper levels
load lazily on first `delegate`).

```ts system
// ── globals (always injected) ────────────────────────────────
// ask(jsx)                       => Promise<T>   value-yielding (aborts stream)
// display(jsx)                   => void         fire-and-forget render
// inspect(...vars | [var, query])=> Promise<void> value-yielding (aborts stream)
// loadKnowledge(...path)         => Promise<T>    value-yielding (aborts stream)
// sleep(duration)                => Promise<void> value-yielding (ends turn, delays resume)
// tasklist(name)                 => Promise<Goal> value-yielding (host-managed DAG)
// fork<T>({instruction, output}) => Promise<T>    value-yielding (isolated VM)
// delegate(target, q|tasklist)   => Promise<T>    value-yielding (other space)

// ── space: cooking ───────────────────────────────────────────
// knowledge (tree only; values load on demand via loadKnowledge)
//   available
//     ingredients   [salt, oil, garlic, tomato, basil, ...]
//     pots          [sizes]
//     tools
//   foodTypes
//     pasta         [ravioli, spaghetti, ...]
// functions (scoped to this agent)
//   addIngredient(potId, ingredient, amount): void          // void → runs inline
//   putPotOnHeat(potId, heatLevel): void                    // void → runs inline
//   getPotTemperature(potId): number                        // sync → runs inline
//   checkPot(potId): { waterLevel, temperature, contents }  // sync → runs inline
// components
//   view: PotStatus
//   form: SaltinessSlider, ConfirmDish

// ── current agent: chef ──────────────────────────────────────
// instruct.md (body injected into the system prompt):
//   You are the chef. You cook dishes to order using the kitchen's pots and
//   ingredients, then pair them with wine via the sommelier.
//   Rules:
//   - Confirm the approach with the user before enabling a tasklist.
//   - Never invent ingredients — load availability knowledge first.
// actions (each maps to a tasklist):
//   cook_pasta → make_pasta — boil + sauce in parallel, cook, drain, combine. goal: combine
//   cook_soup  → make_soup  — ...
// dependencies (direct, eager):
//   sommelier/pairing — actions: suggest_pairing (recommend a wine), check_cellar (stock check)
```

```md user
USER: Make me some pasta and suggest a wine to go with it.
```

---

## 2. `ask()` — a value-yielding await aborts the stream

The harness evals statements as they stream (incremental statement eval) and aborts
at the first value-yielding await. The pending `ask` form is shown until resolved.

```ts assistant
// make_pasta fits, but confirm the approach before enabling the tasklist.
const approach = await ask(<form>
  <ConfirmDish label="Cook pasta with a simple tomato sauce?" />
</form>)
```

```md user
VARIABLES(
  approach: { confirmed: true }
)
```

---

## 3. `tasklist()` — host takes over the DAG (LLM never writes orchestration)

```ts assistant
const dish = await tasklist("make_pasta")
```

The harness aborts the stream and enters tasklist mode. The host resolves the DAG,
forking dependency-free tasks in parallel. **This block is not seen by the LLM.**

```ts host
// boil_water and make_sauce have no deps → run in parallel (within maxConcurrentForks=8)
const boil_water = fork<{ ready: boolean; potId: string; saltiness: number }>({
  instruction: "Fill a pot with water, salt it, bring to a rolling boil.",
  output: { ready: "boolean", potId: "string", saltiness: "number" },
})
const make_sauce = fork<{ sauce: string; servings: number }>({
  instruction: "Sauté garlic, add crushed tomatoes, basil; simmer 15 min.",
  output: { sauce: "string", servings: "number" },
})
const [boilRes, sauceRes] = await Promise.all([boil_water, make_sauce])
// only JSON-serializable values cross the VM boundary — no closures, no scope merge
```

---

## 4. Fork stream — `loadKnowledge` + `ask` in one `Promise.all`

Each fork is a fresh VM + LLM stream with the full history up to `await tasklist()`,
plus a task message. Several value-yielders batched in one `Promise.all` = one abort.

```md user
You are in make_pasta mode. DAG: [boil_water*, make_sauce*] → cook_pasta → drain_pasta → combine
Current task: boil_water — fill a pot, salt it, bring to a boil.
Output: { ready: boolean, potId: string, saltiness: number }
Call currentTask.resolve(output) when done.
```

```ts assistant
const [pots, salts, { saltiness }] = await Promise.all([
  loadKnowledge("available", "pots", "sizes"),
  loadKnowledge("available", "ingredients", "salt"),
  ask(<form><SaltinessSlider name="saltiness" label="How salty?" /></form>),
])
```

```md user
VARIABLES(
  pots: [ { id: "pot1", size: "2L" }, { id: "pot2", size: "5L" } ],
  salts: [ { id: "salt1", type: "table" }, { id: "salt2", type: "sea" } ],
  saltiness: 0.7
)
```

---

## 5. Void host calls run **inline** — no abort, no round-trip

`addIngredient` / `putPotOnHeat` are `void`, so they execute inline. The block ends
at the first value-yielding await — here `sleep`, to let the water start heating.

```ts assistant
const pot = pots.sort((a, b) => parseInt(b.size) - parseInt(a.size))[0]
addIngredient(pot.id, "water", "2L")          // inline
addIngredient(pot.id, "salt1", `${saltiness * 4}g`)  // inline
putPotOnHeat(pot.id, "high")                  // inline
await sleep("2min")   // value-yielding: ends the turn, resumes after the delay
```

```md user
VARIABLES(
  slept: "2min"
)
```

---

## 6. Waiting = turn-per-poll (no spin-loops)

Read the synchronous value, then `inspect` to end the turn. If not ready, `sleep`
to let more time pass before the next check.

```ts assistant
const temp = getPotTemperature(pot.id)
await inspect(temp)
```

```md user
VARIABLES(
  temp: 64
)
```

```ts assistant
// not boiling yet — wait before re-checking
await sleep("1min")
```

```md user
VARIABLES(
  slept: "1min"
)
```

```ts assistant
const temp = getPotTemperature(pot.id)
await inspect(temp)
```

```md user
VARIABLES(
  temp: 100
)
```

```ts assistant
// boiling — resolve the task. Output crosses the VM boundary as JSON.
currentTask.resolve({ ready: true, potId: pot.id, saltiness })
```

Resolving aborts the fork stream. Dependents become eligible.

---

## 7. Dependent task — upstream output as namespaced var **and** message

`cook_pasta dependsOn boil_water`. The host injects the upstream output both as a
`__task_*` VM variable and as a summary in the task message.

```md user
You are in make_pasta mode. DAG: [boil_water✓, make_sauce✓] → cook_pasta* → drain_pasta → combine
Current task: cook_pasta — cook pasta in the boiling salted water.
Inputs: boil_water → { potId: "pot1", ready: true }
Output: { drained: boolean, potId: string }
```

```ts assistant
// __task_boil_water is in scope (injected by host)
addIngredient(__task_boil_water.potId, "spaghetti", "200g")
const temp = getPotTemperature(__task_boil_water.potId)
await inspect(temp)
```

---

## 8. Error → history rewinds to the last successful line

With incremental statement eval, statements that already passed tsc + eval are
committed to history and the VM. On a failing statement the host **rewinds history to
the last successful line**, surfaces the failing line + error as an `md user` message,
and the LLM regenerates from there. Cap: 3 attempts on the same line, then abort the turn.

```ts assistant
const status = checkPot(__task_boil_water.potId)   // evaluated OK — retained
```

```md user
ERROR (attempt 1 of 3): the next statement failed — retry from here.
// const done = status.waterLevl < 0.2
//                     ^ Property 'waterLevl' does not exist on type
//                       '{ waterLevel: number; temperature: number; contents: string[] }'.
//                       Did you mean 'waterLevel'?
```

```ts assistant
const done = status.waterLevel < 0.2
await inspect(done)
```

---

## 9. `inspect` truncation + dotted-path query

Plain values use `inspect(value)`. Capped JSON serialization replaces over-cap values
with a type/size placeholder + a re-query hint; the LLM drills in with the **query form**
`inspect([var, query])` where `query` is an object (`path`, `slice`, `filter`, `keys`,
`count`, `sample`, `search`, `depth`) — same query model as the previous repl.

```ts assistant
const log = checkPot(__task_boil_water.potId)
await inspect(log)
```

```md user
VARIABLES(
  log: { waterLevel: 0.18, temperature: 100, contents: [… 14 items, truncated
        — inspect([log, { slice: [0, 3] }]) to expand ] }
)
```

```ts assistant
await inspect([log, { path: "contents", slice: [0, 3] }])
```

```md user
VARIABLES(
  log.contents[0..3]: [ "spaghetti (200g)", "water (2L)", "salt1 (2.8g)" ]
)
```

---

## 10. Tasklist on disk — directory of numbered step files

A tasklist is a directory; each task node is a numbered markdown file whose frontmatter
defines the node and whose body is the instruction. Numbering is ordering/display only —
the DAG comes from `dependsOn`. `condition` uses a restricted DSL (`field op value`,
`AND`/`OR`) evaluated by the host against accumulated task outputs (not raw JS).

```
tasklists/make_pasta/
├── 1. Boil water.md      # id: boil_water
├── 2. Make sauce.md      # id: make_sauce
├── 3. Cook pasta.md      # id: cook_pasta   dependsOn: [boil_water]
├── 4. Combine.md         # id: combine      dependsOn: [cook_pasta, make_sauce]  goal: true
└── 5. Garnish.md         # id: garnish      dependsOn: [combine]  optional + condition
```

```yaml
# tasklists/make_pasta/5. Garnish.md
---
id: garnish
dependsOn: [combine]
optional: true                       # failure does not block the goal
condition: combine.servings > 1 AND make_sauce.sauce == "tomato"
output: { garnished: boolean }
---
Add a basil garnish.
```

If `garnish` throws, the goal still resolves; a required task's failure would abort
the tasklist with the error surfaced.

---

## 11. Goal resolves → control returns to the main stream

```md user
VARIABLES(
  dish: { name: "spaghetti al pomodoro", servings: 2, sauce: "tomato" }
)
```

---

## 12. `delegate()` — cross-space, both modes

Mode 1 (child picks an action; its tasklist goal output is coerced to the requested
`output` schema). Mode 2 (caller names an action; output is that action's tasklist
goal). The child gets only the passed context — no parent history.

```ts assistant
// mode 1 — let sommelier/pairing pick the action
const wine = await delegate("sommelier/pairing", {
  query: "Recommend a wine for this dish.",
  context: { dish },
  output: { name: "string", reason: "string" },
})
```

```md user
VARIABLES(
  wine: { name: "Chianti Classico", reason: "high acidity cuts the tomato" }
)
```

```ts assistant
// mode 2 — name an action of the child agent explicitly
const cellar = await delegate("sommelier/pairing", "check_cellar", {
  query: "Is the Chianti in stock?",
  context: { wine },
})
// the await aborts and the resolved value is auto-injected below — no inspect needed
```

```md user
VARIABLES(
  cellar: { inStock: true, bottles: 3 }
)
```

Caps apply across this tree: max delegation depth 5, max 8 concurrent forks, optional
token budget — exceeding any surfaces an error to the LLM.

---

## 13. Session end — no sink

There is no sink. The session ends when the agent emits a turn with **no pending
value-yielding await** — nothing left to resume, so the agent is done. Here the chef
presents the result and stops.

```ts assistant
display(<PotStatus
  title={`${dish.name} with ${wine.name}`}
  notes={wine.reason}
/>)
// no value-yielding await → session ends
```

---

## Runtime properties exercised above

- **No git.** State lives in the QuickJS VM; a lightweight disk snapshot (scope +
  history) every N turns enables crash recovery by rehydrating the VM.
- **Full history**, rolling-summarized near the context window: the oldest code
  blocks + VARIABLES collapse into a compact summary turn while recent turns stay verbatim.
- **`fork` and `delegate` are separate implementations**; both isolate a VM and only
  pass JSON-serializable values across the boundary.
- **`.d.ts` overlay** (functions + component props) drives incremental tsc per block.
