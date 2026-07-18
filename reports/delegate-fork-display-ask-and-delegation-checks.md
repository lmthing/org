# Design report: delegate/fork `display()`, `ask()` for children, and rethinking delegation prose checks

Status: **proposal / not implemented.** Author's date context: 2026-07-18.

This report captures three runtime-design changes for the LMThing agent runtime
(`libs/core`). All three came out of the scenario campaign, where the same class of
bug kept recurring: a **child agent (delegate or fork) tries to communicate with the
user, but the runtime has no first-class channel for a child to talk to its _caller_**,
so children either leak into the real user's chat or silently drop information.

Every claim below is grounded in the current code. Symbol / line anchors follow the
`org/docs` convention (`path:Lstart` / `path#Symbol`).

---

## Background: the three channels a VM has today

A child VM (fork leaf or delegate) is built by `createChildVM`
(`libs/core/src/exec/bootstrap.ts:187-266`) and its surface is driven by one
`CapabilityProfile` (`libs/core/src/exec/capability.ts:66-105`) that gates **both**
which globals are injected **and** which ambient DTS is emitted
(`buildAmbientDts`, `bootstrap.ts:372-396`). The three relevant globals:

| global | gate | reaches | notes |
|---|---|---|---|
| `display(descriptor: unknown)` | **none** — universal (`bootstrap.ts:198`) | the shared `renderHost` **and** the fan-out tracer | fire-and-forget, accepts anything incl. JSX |
| `ask(descriptor): Promise` | `caps.ask` (`bootstrap.ts:197`) | `renderHost.ask` on the **session** | `ask:false` for both forks and delegates |
| `currentTask.resolve(value)` | present when a resolver is wired (`bootstrap.ts:129-138`) | the **parent caller**, once, at completion | the ONLY existing child→parent path |

The three profile factories set these flags:

- `sessionCapabilities` — `ask:true`, `orchestrate:true` (`capability.ts:110-112`)
- `forkCapabilities` — `ask:false`, `orchestrate:false` (`capability.ts:120-124`)
- `delegateCapabilities` — `ask:false`, `orchestrate:true` (`capability.ts:133-135`)

The key asymmetry: **`display()` is universal and always hits the user-facing surface,
while `ask()` is removed entirely for children, and the only real child→parent channel
(`currentTask.resolve`) is a fire-once return value with no reply.** The three proposals
below realign this.

---

## Proposal 1 — a delegate/fork `display()` should render on the **parent caller**, and accept **only strings**

### Problem

`display()` is a universal, non-capability-gated global, injected into *every* VM at
`libs/core/src/exec/bootstrap.ts:198` (outside every `if (caps.*)` gate — contrast
`ask` at `:197`, `fork`/`tasklist` at `:222-225`). Its body
(`libs/core/src/globals/display.ts:11-25`) unconditionally does two things:

1. `renderHost.display(value)` (`display.ts:22`) — and children are constructed with the
   **shared session `renderHost`** (delegate: `delegate.ts:194`; fork: `fork.ts:339`), so
   the value lands directly on the **real user's** render surface.
2. `onDisplay?.(value)` (`display.ts:23`) — for a child this writes a `type:'display'`
   tracer event (delegate: `delegate.ts:210-211`; fork: `fork.ts:351-352`), and
   `Tracer.write` fans every event out to all subscribers, incl. the server/UI stream
   (`sandbox/trace.ts:114-127`), so it *also* reaches the user's chat as a trace event.

Meanwhile the value a child actually returns to its caller flows **only** through
`currentTask.resolve` → `capturedResult` (delegate: `delegate.ts:218-221`, returned at
`delegate.ts:457`; fork: `fork.ts:318-330`). `display()` output never enters that return
value.

Net effect (the `ecf6631` bug): a nested delegate that freelances a `display()`
mid-reasoning has its internal dump broadcast into the real user's chat as the turn's
visible reply — even though nothing asked it to display and its real answer goes back via
`resolve`. The current mitigation is **prose** ("answer your caller, resolve, never
`display()`") added to individual system agents (reader/sheet/dispatch), which is exactly
the kind of prose-enforced rule the runtime is supposed to make structural.

Two things are wrong at once:

- **Wrong audience.** A child's `display()` reaches the *user*, not the agent that
  called it. A child has no legitimate reason to draw on the real user's surface; its
  output is an intermediate for its caller.
- **Wrong payload type.** `display()` accepts `unknown` — strings, primitives, arbitrary
  objects, and JSX descriptors (`display.ts:11-25`). Rich JSX/component rendering only
  makes sense for the one agent that owns the user's surface (the top-level session).
  A child rendering a `<Callout>` into the user's chat (the `ecf6631` symptom) is never
  correct.

### Proposed change

1. **Scope `display()`'s audience by VM kind.** Instead of always writing to the shared
   session `renderHost`, a child's `display()` should render **to its parent caller** —
   i.e. it should surface where the caller can see it as part of *that delegate/fork's
   result trace node*, not on the top-level user surface. The natural seam: give child
   VMs a `renderHost` (or an `onDisplay`) that targets the caller's trace subtree rather
   than the session's user-facing `RenderHost.display` (`session/types.ts:10-11`).
   Concretely, decouple the two broadcasts in `display.ts:22-23` for children: keep the
   tracer event (it belongs under the child's trace node —
   `sandbox/trace-tree.ts:280-286` already nests it), drop the direct
   `renderHost.display` to the user surface for non-session VMs.

2. **Restrict a child's `display()` to `string` only.** For fork/delegate VMs, the
   injected `display` (and its DTS) should be typed `display(content: string): void`, not
   `display(descriptor: unknown)`. Passing a JSX descriptor or object from a child becomes
   a **typecheck error** (retryable) instead of a rich render leaking to the user. The
   session keeps the full `string | JSXDescriptor` signature. Note the fork prompt already
   hardcodes the richer type at `fork.ts:463` — that DTS line would narrow to `string` for
   children.

### Why this shape

- It converts a prose rule ("never `display()` in a child") into a structural one — the
  child *can* display, but only strings, and only to its caller. This is consistent with
  the repo rule *"Never forbid a tool in prose — the host enforces it, prose does not"*
  (`CLAUDE.md:82-83`).
- It preserves a genuinely useful capability (a child narrating progress to its caller)
  without the leak.

### Touch points

- `libs/core/src/globals/display.ts:11-25` — split string-only vs full descriptor; make
  the target injectable.
- `libs/core/src/exec/bootstrap.ts:198` — inject a caller-scoped, string-typed `display`
  for child VMs; keep the session variant unchanged.
- DTS: the `display` fragment in `COMMON_DTS` (emitted unconditionally at
  `bootstrap.ts:380`) must become kind-aware, or move to a gated fragment.
- `delegate/delegate.ts:194,210-211` and `fork/fork.ts:339,351-352` — retarget the
  child render/onDisplay.

### Open questions

- Does any current UI intentionally show a child's `display()` on the user surface (e.g.
  a streaming "specialist is thinking" affordance)? If so, that should move to
  `setActivity` (`bootstrap.ts:202`), which already exists for status.
- Should "string only" also coerce primitives (like the session `display` does at
  `display.ts:18-21`), or reject them? Recommendation: coerce number/boolean/bigint to
  string (same as today), reject objects/JSX at typecheck.

---

## Proposal 2 — `ask()` should be available to delegates and forks, addressed to the **parent caller**

### Problem

`ask()` is gated on `caps.ask` (`bootstrap.ts:197`) and both child profiles set
`ask:false` (`forkCapabilities` `capability.ts:120-124`; `delegateCapabilities`
`capability.ts:133-135`). Because one profile drives both injection and DTS
(`bootstrap.ts:375`), a child that calls `ask()` fails **typecheck** — the global isn't
even present. So a delegate/fork that hits a genuine ambiguity **cannot ask anyone**; it
must guess, or resolve a `{covered:false}`-style miss back to its caller and hope the
caller re-asks.

The deeper issue is that `ask()` is hard-wired to the **session's real user**:
`Session.handleYield` case `'ask'` calls `this.opts.renderHost.ask(...)` directly
(`session/session.ts:997-1001`). There is no notion of "ask my caller." The only
child→parent channel is `currentTask.resolve` (`delegate.ts:218-221`;
`fork.ts:318-330`) — a **one-shot, no-reply** result. There is no bidirectional / mid-run
channel from a child to its parent today.

This matters because a delegate is frequently the agent that discovers a missing fact
(*which of the two accounts? what date range?*). Forcing that clarification to be
impossible-in-child means either a bad guess or a wasteful round-trip through the caller.

### Proposed change

Give forks and delegates an `ask()` that **addresses the parent caller, not the real
user**. Two variants, pick per the interaction model we want:

- **(a) Ask-the-caller-agent.** The child's `ask` yields a *question to its immediate
  caller*; the caller (which may itself be a delegate/fork, or ultimately the session)
  decides how to answer — from its own context, or by escalating its own `ask` upward
  until it reaches the session's real `renderHost.ask`. This makes `ask` a proper
  bidirectional child→parent channel that mirrors how `delegate` already flows down.

- **(b) Ask-through-to-the-user, attributed.** The child's `ask` is forwarded up the
  chain to the session's `renderHost.ask`, but tagged with the originating child's scope
  so the UI shows *who* is asking. Simpler, but it puts a modal question from deep in a
  subtree onto the user.

Recommendation: **(a)** as the model, with the session as the terminal answerer, because
it composes (each level can satisfy or forward) and it keeps the interactive surface
owned by the session. (b) is effectively the degenerate case where every caller forwards.

Mechanically this needs, per the research:

1. A new **profile flag** (or reuse `ask` with a new meaning) so `caps.ask` can be true
   for children with the child semantics — `CapabilityProfile` at `capability.ts:66-105`,
   set in `forkCapabilities`/`delegateCapabilities`.
2. Injection + DTS wired through `bootstrap.ts:197` / `:375` for children.
3. A new **yield kind** and **router case** — today `ask` is only handled in
   `Session.handleYield` (`session.ts:997-1001`). A child `ask` needs a router leg
   analogous to `case 'delegate'` in `eval/yield-router.ts:179-188` that walks to the
   caller instead of the session's `renderHost`.
4. The child→parent transport: extend the currently-fire-once `currentTask` channel
   (`bootstrap.ts:129-138`) into something that can carry a question and await a reply, or
   add a sibling `currentTask.ask`.

### Why this shape

- It closes the "guess or waste a round-trip" gap for the agent that actually found the
  ambiguity.
- It keeps the real user's modal surface owned by the session (under variant (a)), so a
  10-way fan-out can't spray ten questions at the user.
- It's symmetric with `delegate`/`display`-to-caller: children talk to their **caller**,
  the session talks to the **user**.

### Risks

- **Interactivity in a fan-out.** A `forEach` fork that all call `ask` could deadlock the
  batch waiting on answers. The caller-answers model (variant a) mitigates this: a
  tasklist orchestrator can answer from its own context without user involvement.
- **`ask` currently ends/suspends the turn via the yield protocol** (`ask.ts:80-91`).
  A child `ask` must suspend only the child's subtree, not the whole session, unless it
  bubbles all the way to the session.

### Touch points

- `libs/core/src/exec/capability.ts:66-124` (profile flag), `bootstrap.ts:197,375`
  (inject + DTS), `eval/yield-router.ts:179-188` (new router leg),
  `session/session.ts:997-1001` (terminal answerer), `globals/ask.ts:64-92` (make the
  yield target injectable), `delegate/delegate.ts` + `fork/fork.ts` (caller-side answer
  handling on the `currentTask` channel).

---

## Proposal 3 — rethink the delegation **prose checks**

### Problem

There is exactly **one** heuristic that scans instruct *prose* to infer delegation
intent, and it is fragile. In `loadSpace` at `libs/core/src/spaces/load.ts:482-499`:

```js
const instructProse = instructBody.replace(/```[\s\S]*?```/g, ''); // load.ts:488
if (canDelegateTo && canDelegateTo.length === 0 && instructProse.includes('delegate(')) // load.ts:489
  onWarn(`agent "${slug}" ...: canDelegateTo: [] ... but the instruct body calls delegate() ...`); // load.ts:496-498
```

Problems with this check:

- It is a **plain substring match** (`.includes('delegate(')`) on prose. Commit
  `6cfb21e` already had to bolt on a fenced-code-block strip (`load.ts:488`) because the
  check was firing on `delegate(` inside authored code *examples* (e.g. the automator
  showing `writeProjectHook` source whose handler calls its ctx `delegate`). The strip
  only handles *fenced* blocks — `delegate(` in inline backticks, or in a prose sentence
  ("the runtime will `delegate(...)` for you"), still false-fires.
- It infers a **capability** ("this agent intends to delegate") from **prose**, which is
  precisely the anti-pattern the codebase forbids elsewhere: *"Never forbid a tool in
  prose — disable it in tasklist frontmatter ... the host enforces it, prose does not"*
  (`CLAUDE.md:82-83`).
- It is **purely advisory** — it only `console.warn`s via `onWarn`
  (`load.ts:496-498,582,592`). It shares **no code** with the real gate.

The real gate is entirely frontmatter/runtime and is independent of prose:
`evaluateDelegatePolicy` (`exec/target-match.ts:121-138`) → `isDelegateAllowed`
(`target-match.ts:177-191`), enforced at yield time at three VM boundaries
(`session/session.ts:1108-1110`, `delegate/delegate.ts:396-398`, `fork/fork.ts:525-527`)
with a retryable `formatDelegateDenial` (`target-match.ts:195-210`). This is correct and
should stay.

### Proposed change

Rethink the *advisory prose check* — it is the only prose-derived capability heuristic
left, and it is the fragile one. Options, in order of preference:

1. **Replace the prose heuristic with a frontmatter/DTS-level signal.** Because
   `canDelegateTo:[]` already means `delegate` is **not injected and absent from the
   DTS** for that agent (via `delegateCapabilities`/policy → `caps.delegate`), any real
   `delegate()` call the agent tries at runtime already **fails typecheck** (retryable,
   with `formatDelegateDenial`). The load-time warning is trying to catch a
   *misconfiguration* (author wrote delegate logic but forbade it) earlier than the first
   run. That intent is legitimate, but it should be detected structurally, not by
   grepping prose — e.g. surface it when the transpiled/typechecked instruct references
   the `delegate` symbol, reusing the typecheck pass rather than a regex.

2. **If we keep a lint, make it AST/token-based, not substring-based.** Strip *all* code
   contexts (fenced *and* inline) or, better, only flag a `delegate(` that would be a real
   call in the agent's own turn — never one inside authored code the agent is *writing for
   another runtime* (hooks, emitters, code nodes). The current fenced-only strip is a
   partial fix for a problem that recurs wherever an authoring agent embeds code.

3. **Demote or remove it.** Since the runtime gate already makes a forbidden `delegate()`
   a clean, retryable typecheck error, the load-time warning is low-value and
   false-positive-prone. If we can't make it precise, removing it loses little and drops a
   maintenance/foot-gun surface. (This is safe: the research confirmed the heuristic and
   the gate share no code — `target-match.ts` enforcement is untouched by removing
   `load.ts:489`.)

Recommendation: **(1)** — derive the warning from the same typecheck/symbol information
the runtime already computes, so "does this agent use `delegate`?" is answered by the
compiler, not a regex over English prose. Failing that, **(3)**.

### Broader principle

The general lesson from `6cfb21e` and this review: **capability facts about an agent
should be derived from frontmatter + the typechecked program surface, never inferred by
scanning prose.** The runtime already lives by this for enforcement (one
`CapabilityProfile` drives injection + DTS + gate). The one place that still violates it
is this advisory lint. Rethinking it means either grounding it in the typecheck pass or
retiring it.

### Touch points

- `libs/core/src/spaces/load.ts:482-499` — the heuristic to replace/remove.
- `libs/core/src/exec/target-match.ts` — the real gate (leave as-is; reference only).
- Tests: `libs/core/src/exec/delegate-policy.test.ts:376-405` pin the current warning
  behavior and would move with it.

---

## Proposal 4 — context overload on a heavy task node: split into smaller tasks + `forEach`, and read upstream inputs partially via `inspect()`

### Problem

This is the `08-small-shop` / `plan_pages` failure written up in the `d87c76d` ledger
(`scenarios/campaign/attempts/08-small-shop.md`), generalized. On a large app build, the
required `10-plan_pages` node throws (leading hypothesis: a per-fork budget trip), which
aborts the **whole** 12-node `build_live_project` tasklist and silently salvages to
`pageCount:0, built:false, status:done`. Two structural facts make it happen, both now
confirmed in code:

1. **Upstream outputs are threaded into a downstream node RAW and uncapped — twice.**
   `getUpstreamOutputs` (`libs/core/src/tasklist/orchestrator.ts:127-135`) returns each
   dependency's full accumulated output *by reference*. That map reaches the node's VM
   through `forkWithMeta` (`orchestrator.ts:255-263`) and is then materialized **two
   ways, both verbatim**:
   - **bound as live variables** — `seedVars: { ...task.seed, ...task.upstreamOutputs }`
     at `fork/fork.ts:361`, and
   - **also fully `JSON.stringify`'d into the first user message** — `inputSummary` at
     `fork.ts:373-380` (the per-entry dump is `JSON.stringify(v)` at `fork.ts:375`, **no
     length cap, no `serialize()`/`strCap`, no preview**).

   So `10-plan_pages` (`dependsOn: [plan_app, plan_endpoints, plan_components,
   user_stories]`) is force-fed the *entire* endpoint list + component list, in the
   prompt, up front. This is a **prompt cost that scales with the app, not the task** —
   exactly the ledger's diagnosis. The orchestrator keeps upstream raw *by design*
   (`orchestrator.ts:66-71`), so there's no size guard anywhere on this path.

2. **A required non-`forEach` node has no fallback.** When such a node throws,
   `runTasklist` aborts with `Required task "X" failed: …` (`orchestrator.ts:293-306`) —
   there is no tasklist-level salvage for it. Contrast a `forEach` node, which gets, *per
   item*: **input scoping** (each item fork receives only `{ item, index }`, not the whole
   array — `runFork({ item, index })` at `orchestrator.ts:300`, seed merge at
   `orchestrator.ts:258`), **3 retries** (`FOREACH_ITEM_ATTEMPTS = 3`,
   `orchestrator.ts:14`, loop at `orchestrator.ts:298-307`), and **per-item salvage** to a
   schema-valid placeholder (`orchestrator.ts:308-311`). A monolithic required node gets
   *none* of these.

### Proposed change — two complementary levers

**(4a) When a node's context would overload, decompose it into a planning node + a
`forEach` expansion.** Instead of one `plan_pages` fork that receives the full endpoint +
component lists and plans *every* page in one context, split it:

- a **lightweight planner** node that only decides the *set* of pages — one terse spec per
  page (route, title, which endpoints/components it needs) — producing an **array**; then
- a **`forEach` expansion** node (`forEach: plan_pages.pages`) where each item fork plans
  *one* page. Each fork is automatically scoped to just its own item
  (`orchestrator.ts:300`), so its context is O(one page), not O(whole app); it inherits the
  3-retries + per-item-salvage resilience for free; and one heavy page can degrade to a
  placeholder instead of aborting the entire build.

This is the same "openable-early / freeform-grow" principle the ledger proposed, but
generalized into a **repeatable strategy**: *a required node whose cost scales with app
size should be a planner that emits a list + a `forEach` that expands the list.* It
converts a fragile monolith into a resilient fan-out using machinery that already exists —
no new runtime primitive. (The minimal-index-page fallback from the ledger is a special
case: split "finalize" so a bare openable page lands right after `05-implement_tables`.)

**(4b) Thread upstream inputs as a *preview*, and let a node read them partially via
`inspect()`.** Splitting alone isn't enough if each item fork still gets the full upstream
blob force-fed in its prompt. The runtime already has the exact mechanism to fix this — it
just isn't applied on the upstream path:

- The top-level VARIABLES block the model reads is **previewed** — `serialize()` with
  `DEFAULT_STR_CAP = 200` (`libs/core/src/globals/serialize.ts:15-17`), emitted per
  variable at `context/variables.ts:12` (turn loop `eval/turn-loop.ts:788`).
- The documented **escape hatch** to expand any previewed value is
  `inspect([var, { slice: [a, b] }])` — `applyQuery`'s string/array slice
  (`globals/inspect.ts:91-97`), formatted with the wide `INSPECT_STR_CAP = 20_000`
  (`inspect.ts:189-190, 200`).
- Crucially, **`inspect()` is a universal, non-capability-gated global injected into every
  child VM** — including every fork / `forEach`-item / delegate task node
  (`exec/bootstrap.ts:203`, unconditional, inside `createChildVM`).

So the change is: on the upstream-threading path, replace the raw full `JSON.stringify(v)`
dump (`fork.ts:375`, and the seed dump at `fork.ts:368-372`) with a **`serialize()`
preview** (strCap 200, same as the VARIABLES block). The full value **stays bound as the
live variable** (`fork.ts:361` unchanged), so the node can pull exactly the slice it needs
on demand via `inspect(['plan_endpoints', { slice: [...] }])`. A downstream planner then
reads *what it needs* instead of swallowing *everything* up front — attacking the cost
driver directly, while the variable remains complete and typed (`fork.ts:392-400`). This
is fully compatible with the "upstream stays RAW" design intent (`orchestrator.ts:66-71`):
the *variable value* is still raw and complete; only the *prompt echo* becomes a preview.

### Why this shape

- **4a** turns "a required node throws → whole tasklist dies → silent `pageCount:0`" into
  "one item degrades → placeholder → build still opens," reusing `forEach`'s existing
  retry+salvage+scoping. It's the structural fallback the required-node path lacks.
- **4b** removes the reason the node overloads in the first place, using the
  preview+`inspect` model the runtime *already* trusts for the top-level VARIABLES block —
  no new concept for the model to learn, and `inspect()` is already in scope in every fork.
- Together they address both failure axes the ledger separated: the **structural
  fragility** (no fallback) and the **cost driver** (raw upstream blobs).

### Touch points

- `libs/core/src/fork/fork.ts:368-380` — swap `JSON.stringify(v)` in `seedSummary` /
  `inputSummary` for a `serialize(v)` preview; keep `seedVars` (`fork.ts:361`) raw.
- `libs/core/src/tasklist/orchestrator.ts:127-135, 255-263` — no change needed for 4b (the
  variable stays raw); for 4a, this is authoring-side (split the tasklist DAG), not a
  runtime change — the `forEach` machinery (`orchestrator.ts:284-315`) already supports it.
- System-space authoring: `system-appbuilder`'s `build_live_project` tasklist — restructure
  `plan_pages`/`implement_pages` into planner + `forEach`, and land a minimal openable page
  early.
- Docs: `org/docs/runtime/fork-and-tasklists.md` (required-vs-forEach failure semantics;
  the preview-upstream + `inspect` contract).

### Open questions

- **Preview vs. schema.** A downstream planner often needs the *shape* of upstream data,
  not every row. The DTS overlay (`fork.ts:392-400`) already gives it the typed shape for
  free; the preview only needs to convey enough sample content to disambiguate. Confirm 200
  chars is enough signal, or add a per-dependency `previewCap`.
- **When to auto-split vs. author-split.** 4a is currently an authoring pattern. Worth
  asking whether the orchestrator should *detect* a repeatedly-budget-tripping required
  node and surface a "split me" diagnostic, rather than relying on authors to anticipate
  it.
- **Confirm the actual throw first.** The ledger's next probe still stands: grep
  `runs/11/step-02.full.json` for `"Required task"` / `BudgetExceededError` / `forkDepth`
  to verify it's a budget trip inside `plan_pages`, before committing to the fix shape.

---

## Summary

| # | Change | Core seam | Enforced by |
|---|---|---|---|
| 1 | Child `display()` → renders to the **caller**, **string-only** | `globals/display.ts:11-25`, `bootstrap.ts:198` | typecheck (string DTS) + retargeted render |
| 2 | `ask()` available to **delegate/fork**, addresses the **parent caller** | new profile flag `capability.ts:66-124`, new yield leg `yield-router.ts:179`, `bootstrap.ts:197/375` | capability profile + new router case |
| 3 | Rethink the **prose delegation lint** — derive from typecheck/frontmatter, not a prose grep | `spaces/load.ts:488-489` | (advisory only; real gate `target-match.ts:177` unchanged) |
| 4 | **Context overload on a heavy node** → split into planner + `forEach`; thread upstream as a **preview** + read partially via `inspect()` | `fork.ts:368-380` (preview), `orchestrator.ts:284-315` (`forEach`), `inspect.ts` / `bootstrap.ts:203` | `forEach` retry+salvage + typecheck-typed variables |

Common threads: **children should talk to their _caller_, not the real user; capability
facts should be structural, not prose-inferred; and heavy context should be _scoped and
pulled on demand_, not force-fed.** Proposals 1 and 2 give a child a proper, caller-scoped
output (`display`) and question (`ask`) channel; proposal 3 removes the last place a
capability is guessed from English; proposal 4 turns a monolithic, no-fallback node into a
resilient `forEach` fan-out and replaces raw upstream force-feeding with the
preview+`inspect()` model the runtime already trusts.
