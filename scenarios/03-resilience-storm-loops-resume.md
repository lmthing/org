# Scenario 03 — Resilience: storms, cycles, and a pod restart mid-flight

**Persona.** Priya's project is popular. Her inbound channel gets bursts of traffic, her automations
call each other, and her free-tier pod scales to zero and restarts under her. She wants none of that
to matter.

**Why this scenario exists.** Every other scenario tests the happy path at human pace. This one
tests the system at machine pace and under interruption: **coalescing**, the **cascade depth cap**,
**self-write / self-trigger exclusion**, **per-hook cooldown**, and **auto-resume after a restart**
with the system message the user is supposed to see. The loop guard is the difference between an
automation platform and a runaway billing incident.

## Feature coverage

| Feature | Where |
|---|---|
| High-frequency inbound webhook burst → throughput + latency | Step 2 |
| db-write burst during one eval → **coalesced to a single fire** | Step 3 |
| Hook cascade **depth cap** (A→B→A ping-pong terminates) | Step 4 |
| **Self-write exclusion** (a hook's own write doesn't re-trigger it) | Step 3 |
| **Self-trigger exclusion** (`hook.fired` can't re-trigger the hook that fired it) | Step 4 |
| Per-hook **cooldown** + budget-pending ≤1/slug | Step 2 |
| Worker isolation: a **throwing / hanging** space emitter is contained | Step 5 |
| Pod restart → **auto-resume** + system message | Step 6 |
| Cold-wake from scale-to-zero | Step 6 |

## Setup

```bash
cd sdk/org/scenarios/harness && node ../03-resilience/run.mjs
```

The runner builds the project through THING (so the hooks are *authored*, not hand-planted), then
switches to direct pod calls to generate load — a scenario that measures throughput must not be
rate-limited by the thing measuring it.

## Steps & expected outcomes

### Step 1 — Build the load target through THING
**Prompt:** *"Create a project `firehose`. Install the demo integration. Store every inbound message
in a `messages` table, and keep a `counters` table with one row counting how many you've stored."*

**Expect:** a code-handler hook on `integration-demo/message.received` that inserts + increments.
No agent in the hot path (a counter that costs a model call is a bug).

### Step 2 — The storm (throughput + latency)
The runner fires **200 signed inbound deliveries** at `/api/inbound/demo` — 50 sequential (to
measure honest per-delivery latency), then 150 with a concurrency of 20.

**Expect:**
- Every delivery returns `200 {ok:true, events:1}` — **no 5xx, no dropped connection**.
- `messages` ends with **exactly 200 rows** — no duplicates, none lost.
- `counters` ends at exactly 200 — the increment is not lost to a race.
- **Zero LLM calls** for the whole storm (the hot path is code).
- The pod stays alive; the event loop is not starved (a THING turn issued *during* the storm still
  completes — the single Node thread must not be monopolized).

**Record:** p50 / p95 / max latency per delivery, total wall clock, rows/sec.

**Edge — burst dedupe:** replay the *same* delivery (same message id + signature) 10×. Expected:
the dedupe layer keeps it to one stored row (or, if the emitter has no dedupe key, exactly the
documented behaviour — the runner records which and flags it as an issue if it is neither).

### Step 3 — Coalescing + self-write exclusion
**Prompt:** *"When a message is stored, tag it with its word count."*

That hook writes back to `messages` — the same table it subscribes to. This is the classic
self-retrigger footgun.

**Expect:**
- The hook's own `update` does **not** re-fire the hook (self-write exclusion). Assert the tag hook
  runs **exactly once per row**, not twice, not unboundedly.
- A burst of N writes inside one eval collapses to a **single** hook fire (coalescing) — assert the
  fire count is ≪ N (and record the exact ratio).
- Budget-pending ≤ 1 per slug: while a hook run is in flight, at most one more is queued.

### Step 4 — The cycle (depth cap + self-trigger exclusion)
Deliberately author a ping-pong: hook **A** on `project/db.a.insert` writes to table `b`; hook **B**
on `project/db.b.insert` writes to table `a`. Then insert one row into `a`.

**Expect:** the cascade **terminates at the depth cap** — a bounded number of rows in each table, an
explicit cap-reached warning in the pod log, and a pod that is still healthy afterwards. It must not
run away, and it must not crash.

**Then** subscribe a hook to `integration-lmthing/hook.fired` that itself writes a row (which fires
`hook.fired` again). **Expect:** self-trigger exclusion stops it dead — the audit hook does not
trigger itself.

**Record:** the observed cap depth and the total rows written before termination.

### Step 5 — A bad space emitter must not take the pod down
The runner installs a project-local space whose emitter `emit()` (a) throws, and (b) in a second
variant, spins for 60 s.

**Expect:** store code runs **worker-isolated** — the throw is contained (logged, event dropped) and
the hang is **timeout-bounded**. In both cases: the pod stays up, other hooks keep firing, and the
instrumented path (the internal signal that triggered it) is unaffected. Fire-and-forget means
fire-and-forget.

### Step 6 — Restart mid-flight → auto-resume + system message
While a THING turn is **in progress** (a long-running delegate), the runner calls
`POST /api/restart` on the pod (the same thing an env save from the Integrations tab does).

**Expect:**
1. The pod comes back (K8s restarts it; cold-wake path).
2. The session is **resumable**: `POST /api/sessions {resumeSessionId}` restores the conversation —
   the trace snapshot replays, the prior user/assistant turns are present.
3. A **system message** is posted into the session announcing the restart/config change (this is the
   documented Integrations-tab behaviour: a save restarts the pod and auto-resumes THING with a
   "`<id>` configured" system message).
4. Work that was durably committed before the restart (rows, files) survives; the in-flight turn
   does not silently claim success.

**Then** scale the pod to zero (idle) and issue a request: it must **cold-wake** and serve, and the
resumed session must still be there.

**Record:** restart → resumable latency; cold-wake → first byte.

## Assertions the runner makes

- 200 deliveries → exactly 200 rows, 200 counter, 0 LLM calls, 0 5xx
- Coalesced fires ≪ writes; tag hook runs exactly once per row
- The A↔B cycle terminates; row counts bounded; pod healthy after
- `hook.fired` audit hook does not self-trigger
- A throwing/hanging space emitter never takes down the pod or the instrumented path
- Post-restart: session resumes, history intact, system message present, committed data intact

## Performance targets

| Metric | Target |
|---|---|
| Inbound delivery p95 (code-handler path) | < 800 ms |
| Storm throughput | ≥ 10 deliveries/s sustained |
| LLM calls during the storm | **0** |
| Cascade termination | bounded, < 10 s, pod healthy |
| Restart → session resumable | < 60 s |
| Cold-wake → first byte | < 15 s |

## Actual results

_Filled in by the scenario runner — see `sdk/org/scenarios/results/03-resilience-report.md`._
