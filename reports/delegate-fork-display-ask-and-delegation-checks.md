# Design report: delegate/fork `display()`, `ask()` for children, and rethinking delegation prose checks

Status: **proposal / not implemented.** Author's date context: 2026-07-18.

This report has two parts:

- **Part I — Design proposals (§1–4):** four runtime-design changes that came out of
  the scenario campaign, where the same class of bug kept recurring: a **child agent
  (delegate or fork) tries to communicate with the user, but the runtime has no
  first-class channel for a child to talk to its _caller_**, so children either leak into
  the real user's chat or silently drop information — plus the context-overload class on
  heavy task nodes.
- **Part II — Critical review of the last 2 days of commits (§5):** a per-commit design
  review of ~50 commits (2026-07-17 → 07-18), flagging what is under-thought or better
  done another way. It surfaces concrete correctness risks (an in-memory build-target that
  a mid-turn eviction can silently corrupt; a port-allocation race; a `--cwd` footgun) and
  a set of **missing structural mechanisms** that a dozen prose patches are compensating
  for. The review corroborates §1 and §4 independently.

Every claim below is grounded in the current code. Symbol / line anchors follow the
`org/docs` convention (`path:Lstart` / `path#Symbol`). Part II's line anchors come from the
reviewing pass; spot-check them before acting, as the tree moves.

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

# Part II — Critical review of the last 2 days' commits

A per-commit design review of the ~50 commits from 2026-07-17 22:37 → 2026-07-18 14:35
(the `docs(report)` commits for this file excluded). The goal was to flag anything
**under-thought or implementable a better way**, grounded in the diffs. Most commits are
sound and well-tested — the campaign's test discipline (revert-proven, load-bearing tests
on every mechanism change) is consistently good. What follows is only the findings worth
acting on, ordered by severity.

## 5.1 Correctness risks (verify / fix before trusting)

### C1 — the per-session build target is RAM-only and a mid-turn eviction can silently violate the "never build into `user`" invariant · `635ebbc` × `77d95de`
The two biggest runtime commits of the window interact badly, and neither references the
other.

- `635ebbc` introduces a per-session **build target** as in-memory closure state
  (`session-manager.ts:441`, `const buildTarget = { projectId }`), read by
  `resolveBuildTarget` (`session-manager.ts:443`). It is **never written into the session
  snapshot.** The commit's stated invariant is "THING never builds into its own `user`
  project" (`session.ts:666-676`).
- `77d95de` *institutionalizes* mid-turn eviction/rebuild of exactly that top-level session
  (its whole `sendResilient` re-send path exists because the session is evicted on a wide
  fan-out).

So the failure sequence is real: THING `createProject`s in one turn → session evicted →
resumed → `buildTarget.projectId` is back to `undefined` → `resolveBuildTarget()` returns
`null` → the delegated build lands in `user`, the precise outcome `635ebbc` says never
happens. The invariant is enforced only by transient RAM that `77d95de` routinely discards.
- **Fix:** persist the build target in the session snapshot (or a marker under
  `.lmthing/<id>`) so it survives resume; or have `resolveBuildTarget` fall back to "the
  most recently created project owned by this session," never silently to `user`.
- **Do first:** a live `create → evict → delegate-build` test. This is the highest-value
  check in the window.

### C2 — port allocation is racy and teardown can kill an innocent run's server · `b7b4bae`
`allocatePort()` binds `:0`, reads the port, and **closes the socket before returning**
(`scenarios/harness/lib/local.mjs:113-122`), then `spawnServer` takes seconds (pnpm → tsx →
node) before the child binds. The port is free for that whole window. The campaign fans out
one subagent per scenario on one host, so two runs can be handed the same port; the loser
exits `EADDRINUSE`, `waitUp` burns up to 120s (`:70-76`), and the retry calls
`killPort(run.port)` (`:98-107`) — which SIGKILLs **whatever now holds that port, i.e. the
winning run's server.** A lost race murders an innocent run.
- **Fix (decided): select the port from the persisted run state, not the OS.** The harness
  already assigns each run a unique, monotonic `runId` and persists per-run state under
  `runs/<n>/` (`local.mjs` `nextRunId`/`seedRun`). Derive the port deterministically from that
  state — e.g. `basePort + runId` (mod a range), or record the chosen port in the run's state
  file and pick the lowest free port not claimed by another live run's state. Because `runId`
  is already unique per run, two concurrent runs get distinct ports **by construction** — no
  `:0` reserve-then-release gap, no race. Keep `killPort` keyed to the run's own
  `serverPid`/`runId` so teardown can never touch another run's server, and watch the child
  `exit` event so a failed bind fails fast instead of polling for 120s.
- Secondary (same root): `reapOrphanRuns` reads `join(r.dir, 'runner.pid')` (`:398`) but the
  pidfile is written to `outDir`; under `--out` the reaper sees no pidfile, declares the owner
  dead, and can kill a live run — resolving port + pid + liveness all from one per-run state
  record fixes this too.

### C3 — `--cwd` mutates global process state from a raw pre-parse argv scan · `b430f68`
`applyCwd` does `mkdirSync(dir,{recursive:true})` then `process.chdir(dir)`
(`cwd.ts:20-26`) during a pre-parse scan, before any command/flag validation. Two
consequences: a typo (`--cwd /srv/porject`) silently creates the wrong tree and runs
against an empty runtime instead of erroring; and because the only guard is `if (!raw)`,
`lmthing --cwd --port 9000` treats `--port` as the directory — it `mkdirSync('./--port')`
and chdirs there, and `parseArgs`' own `--cwd requires a value` check (`args.ts:99-104`)
never fires because the damage is done at import time.
- **Fix (decided): use a real arg-parsing library.** The whole footgun exists because
  `--cwd` is handled by a **hand-rolled pre-parse argv scan** (`applyCwd`) that runs before —
  and separately from — the actual parser (`parseArgs`, `args.ts`). Replace the bespoke
  scanning with a standard arg parser (Node's built-in `util.parseArgs`, or `commander` /
  `yargs`) that owns the *entire* argv, including `--cwd`. A library parser rejects
  `--cwd --port` (a flag can't be a flag's value), requires a value, and gives one validated
  arg table — so `--cwd` is read *after* parsing, and the `mkdirSync`/`chdir` happen only on a
  validated path. This also lets `applyCwd`'s duplicated `--env-file`-style scanning
  (`loadEnv`) collapse into the same parser instead of a second ad-hoc argv walk.

## 5.2 Missing structural mechanisms (recurring prose patches point here)

A dozen behavior commits in the window are **prose edits to system-space `instruct.md` /
tasklist nodes** that compensate for gaps the runtime should close structurally. They keep
recurring across scenarios and rounds because the mechanism doesn't exist. Four clusters:

### M1 — unchecked identifier strings in the model DTS *(biggest single gap; new proposal)*
`library-dts.ts:148-154` types DB identifiers as bare `string`: `query(table: string, …)`,
`where?: Record<string, unknown>`, `set: Record<string, unknown>`. So a **hallucinated
table name** (`2c892ec`), a **hallucinated field name** (`0beae4b` #3, `a96c37e`), and even
a raw SQL fragment passed as a `table` name all pass typecheck and then either throw at
runtime or **silently return nothing — which reads to the model as "no data" and primes it
to give up.** `2c892ec`'s own message admits it is an "INCOMPLETE … L1" prose patch and
names the real fix as an L3 DTS change; the class then recurred across steps 5/6/8/15/16 of
the next run.
- **Fix (decided): generate the DB types from the project schema.** The DTS is already
  generated per-capability, so generate a **per-project set of table types off the live
  schema** — a literal union of the real table names for the `table` param, and a real row
  `interface` per table so `where`/`set`/predicate keys are `keyof` that row. A wrong table or
  field name becomes a **retryable typecheck error** instead of a runtime throw or a silent
  empty. Generating from the schema (rather than hand-writing) means the types **stay correct
  as the project's tables evolve** — a new `writeProjectTable` / migration regenerates the
  union and row interfaces, so the model's DTS is always the ground truth. This one mechanism
  subsumes the DB-identifier parts of `2c892ec`, `0beae4b`, and `a96c37e`, and is the single
  highest-leverage change in the report.

### M2 — `display()` has no channel/scope typing *(corroborates §1 — independent second opinion)*
The prose reviewer arrived at §1 from the opposite direction: `display` is injected
**unconditionally and un-scoped** (`bootstrap.ts:198`), while `setActivity` immediately
below it (`bootstrap.ts:199-202`) is **already per-scope routed via `onActivity`** (main vs
fork/delegate). So the mechanism to fix the `display()` leak structurally *already exists* —
`display` just wasn't given it. This underlies `ecf6631` (a delegate's `display()` leaks to
user chat) and the display-vs-`setActivity` items in `2c892ec` and `0beae4b` (a placeholder
`display()` silently ends a turn with no answer). → implement as §1; additionally, "a turn
that produced no substantive `display()` is incomplete → retry" is host-observable and would
close the turn-ends-without-answer half.

### M3 — no source→row coverage invariant in the appbuilder pipeline *(new proposal)*
`42106e1`, `13e8c84`, `8a52325`, and `842723f` #4a all fight the same thing: parsed source
data silently vanishing (or rendering as a hardcoded `$0.00`) somewhere between
`read_sources` and the live tables/pages. The current design passes free-text **"briefs"**
between nodes and **tunes one node's prose so a downstream node's heuristic will re-interpret
it favorably** — a brittle cross-node coupling that is guaranteed to recur.
- **Proposal:** give the handoff a **schema** — each extracted item a typed candidate
  (`{kind, values, source: 'structured'|'vision'|'audio', matchedStructuredSource,
  isNew}`) — and add a **host/code-node coverage gate**: every parsed source id must map to
  ≥1 landed row or labelled fact, and every live-figure prop must trace to a real endpoint
  field, else the build fails. "Don't drop it" / "don't hardcode the total" become
  assertions, not pleas. (`8a52325`'s `usdTotal={0}` case also has a typed-lever option: a
  branded `LiveFigure` type that only `useApi(...)` produces, making a literal a typecheck
  error.)

### M4 — non-idempotent host writers + no re-entry detection *(new proposal)*
`842723f` #3 (a forEach-item retry re-runs `writeProjectTable(name, schema, rows)` and
**re-inserts rows with fresh ids** → duplicates), `842723f` #4 / `07749b5` `03-plan_app`
(a second build pass **spawns a parallel duplicate app**), and `07749b5` 09–11 (a **failed
component write is still imported and 404s the whole app**) are all the pipeline's own
retry/re-run/partial-failure semantics leaking into per-node prose guards (each node must
`listProjectDir` before seeding, each page must re-derive an `okComponentNames` filter).
- **Fix (decided): writing to something that already exists must force a read first.** Make
  the host writers **read-before-write**: a `writeProjectTable` / `writeProjectPage` /
  `writeProjectComponent` against a target that **already exists** must first read the current
  content and reconcile against it, rather than blindly re-emitting. Concretely — a write to
  an existing table seeds/updates against the rows already there (a retry that re-runs the
  same statement is then a no-op or an update, never a duplicate insert); a second build pass
  reads the existing tables/pages and edits them in place instead of spawning a parallel app;
  and a page write reads the set of landed components so it can't import one that isn't there.
  This makes the write path **converge by construction** — the writer sees prior state before
  it acts — so no per-node prose guard (`listProjectDir` before seeding, re-derived
  `okComponentNames` filter) is needed. It also matches the engineer's existing discipline
  (return code for the caller to persist) and the general "look at the target before
  overwriting" rule. Moves the four+ prose patches (`842723f` #3/#4, `07749b5`) to "the host
  guarantees it."

### M5 — closed-enumeration args fall back to a default *(reviewed → WON'T FIX: fallback is acceptable)*
The review flagged that `loadKnowledge('organizing','split', X)` with an invented guide name
(`crafts`/`studio`/`retail`) **silently falls back to `'default'`**, and proposed erroring on
a miss. **Decision: keep the fallback.** A `default` guide is a sensible, safe degradation —
an unrecognised option gets generic-but-correct guidance rather than a hard failure, which is
the right behavior for a *knowledge menu* (unlike a DB identifier in M1, where a wrong name
means wrong/no data). The existing mitigations are sufficient: `6b87b5b` already appends the
real option list so the model sees the exact names, and the "use the EXACT name from the menu
line" prose nudges toward them. No structural change; M5 is closed. *(Contrast M1: an
enumeration only needs to error when a miss produces a wrong result, not when it degrades to a
reasonable default.)*

## 5.3 Maintainability / smaller cleanups

- **Architect fixes are validated by prompt-substring greps, not behavior · `e6b7557`,
  `8350be3`.** Their "contract tests" (`prompt-contract.test.ts`) assert regexes against the
  *generated prompt text* (`toMatch(/readDocument\(/)`, `/never invent one/i`) — they pass
  whether or not a synthesized agent obeys, and break on harmless rewording; "revert → red"
  only proves the substring was added. These two are the least-verified fixes in the window.
  Add one end-to-end test that builds a specialist and asserts its *runtime* behavior
  (grounding; resolve-on-every-branch), the way the core commits are revert-proven.
- **`loadKnowledge` now has two resolution engines · `ea8c914`.** The on-demand path
  re-walks disk with a hand-built dir list (`systemSpaces.map(s => s.dir + '/knowledge')`,
  repeated 3× in `delegate.ts`), while the declarative preload reads the already-merged
  in-memory `Space.knowledge.domains`. They can drift — a **dynamically `registerSpace`'d**
  space's knowledge is in the in-memory map but not the base-dir list, so on-demand
  `loadKnowledge` still can't see it. Resolve on-demand against the merged in-memory index
  (fall back to disk only for the lazy body read); at minimum hoist the thrice-repeated map.
- **The `20_000`-char "pathological guard" is a copy-pasted magic constant** — independently
  `INSPECT_STR_CAP` (`inspect.ts`), `LOAD_KNOWLEDGE_MAX_CHARS` (`turn-loop.ts`), and
  `READ_DOCUMENT_MAX_CHARS`, each commit noting it "mirrors" the others. One concept, three
  definitions that will drift. Hoist to a shared constant.
- **The "value silently dropped" archetype is fixed unevenly.** `17374e3` solved its
  instance structurally (throw on a mismatched attachmentId); `8350be3` solved the same
  shape (a delegate's *second* nested tasklist result is dropped by `delegate.ts`
  `capturableTasklists`, so the caller gets its own stale input back) with prose. The
  general rule — *a runtime path that discards a value the caller expected should error or
  diagnose, never return a stale/empty stand-in* — should be applied at the
  `capturableTasklists` seam, not per-scaffold.
- **The scenario harness hand-rolls a YAML subset parser that is accreting field-discovered
  bugs · `ccea7d0`** (the 2nd such bug: `change` came back as a literal string and threw at
  09 step 14). It still can't handle quote-escapes or `,`/`}`/`]` in bare scalars. The
  "zero-dep" rationale is weak inside a pnpm workspace. Add `js-yaml`/`yaml` as a harness
  devDependency and delete it, or at least **fail loudly** on out-of-subset constructs
  instead of returning a wrong-typed value.
- **Running the scenario harness from TS source via tsx bypasses the `dist` bundle ·
  `6916d5c`.** `local.mjs` now runs the CLI from `src`, so the one integration layer that
  could catch the `worker-load-entry` packaging class (CLAUDE.md's documented prod-only
  failure) no longer exercises `dist/`. Keep from-source for dev speed, but pin the harness
  (or a CI smoke pass) to the built bin.
- **`77d95de` treats a symptom.** `sendResilient` re-sends the *identical* message relying
  on assumed appbuilder idempotency (see M4), and `--max-sessions 40→80` is a probability
  band-aid — a big enough fan-out still evicts the top-level session. The real fix is to make
  the **root session non-evictable** (evict only leaf fork/delegate sessions) so the
  documented interrupt is rare-by-construction; keep `sendResilient` as belt-and-suspenders.
- **Overfit vector — grammatical whack-a-mole · `297fa77`, `a96c37e`.** Both teach an
  intent-routing rule by enumerating surface phrasings, and `297fa77` asserts a literal
  example sentence (`don't let me/us forget`) in a **CI test** — baking a scenario phrasing
  into a gate, so the next un-enumerated phrasing ("keep this on my radar") misses again.
  State the invariant once at the semantic level; test that the *rule* exists, not that a
  specific sentence appears.
- **Commit hygiene · `3c453ee`.** A small, correct `feat(web): redirect` (~one pure
  function) ships a 6.3MB diff touching the whole `apps/web` tree plus
  `.claude/hooks/session-start.sh`, burying the actual change and hurting bisectability.

## 5.4 What's done right (keep as the model)

`842723f`'s **DAG restructure** (`enumerate → inventory forEach → consolidate`, with the
contract test updated) and `e2571b0`'s **knowledge-file addition** are the correct
structural / `loadKnowledge` altitude — proof the team fixes these properly when the
mechanism exists. `0e2d388` (the `MODEL_HABITS` registry — one choke point, extensible
without touching the turn loop, comments-out rather than drops so the trace stays honest),
`17374e3` / `8178e65` (attachment fixes — structural, behaviorally revert-proven), and
`3c453ee`'s redirect logic itself are all clean. The recurring prose patches cluster
precisely where mechanisms M1–M5 don't yet exist — that's the signal for where to invest.

---

## Summary

### Part I — design proposals

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

### Part II — review findings

**Correctness (do first) — decided directions:**

| id | Risk | Decided fix |
|---|---|---|
| C1 | RAM-only build target + mid-turn eviction → build silently lands in `user` (`635ebbc`×`77d95de`; `session-manager.ts:441-443`) | *(needs decision — see §5.1 C1; persist the target so it survives eviction)* |
| C2 | Port reserve-then-release race; `killPort` can kill another run's server (`b7b4bae`; `local.mjs:113-122`) | **Select the port from the persisted per-run state (`runId`)** — unique by construction, no race |
| C3 | `--cwd` does `mkdirSync`+`chdir` from a pre-parse argv scan; eats the next flag (`b430f68`; `cwd.ts:20-26`) | **Use a real arg-parsing library** for all of argv incl. `--cwd` |

**Missing structural mechanisms (retire recurring prose patches):**

| id | Mechanism | Status | Retires |
|---|---|---|---|
| M1 | **Generate DB table types from the project schema** — literal-union table names + `keyof`-row `where`/`set` in the DTS | ✅ decided (top priority) | `2c892ec`, `0beae4b`#3, `a96c37e` |
| M2 | **Scope-aware `display()`** (= §1; `setActivity` already does it) | ✅ = Proposal 1 | `ecf6631`, `2c892ec`/`0beae4b` display items |
| M3 | Typed `read_sources→plan_app` handoff + **source→row / prop→endpoint coverage gate** | proposed | `42106e1`, `13e8c84`, `8a52325`, `842723f`#4a |
| M4 | **Read-before-write host writers** — writing an existing target reads it first & reconciles | ✅ decided | `842723f`#3/#4, `07749b5` |
| M5 | Closed-enumeration args falling back to `default` | ❌ won't fix — fallback is acceptable | — |

**Cleanups:** behavioral (not prose-grep) tests for the architect layer (`e6b7557`,
`8350be3`); unify `loadKnowledge`'s two resolution engines (`ea8c914`); hoist the triplicated
`20_000` cap; apply the "never return a stale stand-in" rule at `delegate.ts`
`capturableTasklists`; replace the hand-rolled scenario YAML parser (`ccea7d0`); pin the
scenario harness to `dist` in CI (`6916d5c`); make the root session non-evictable
(`77d95de`); drop literal-sentence CI assertions (`297fa77`, `a96c37e`); split the
`3c453ee` mega-diff in future.

The single highest-leverage investment is **M1 (generated DB table types)** — it converts an
entire recurring "hallucinated name → silent empty → model gives up" class into retryable
typecheck errors, and the campaign is already paying for it in repeated prose rounds. C1 is
the highest-leverage *correctness* fix — verify it with a live create→evict→delegate test
before the next campaign run.
