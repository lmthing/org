# Experiment: Architect end-to-end stress test (trace-driven, fix-and-restart)

A reusable prompt for running a **complex, realistic LMThing experiment** the way we
did on 2026-06-12: drive the architect through a hard multi-stage task under `--trace`,
watch the trace as it runs, and when something goes wrong that's fixable in *prompting*
or in *core/globals*, **stop, fix it, test the fix, and restart** — iterating until the
whole flow is green. The point is not just to "get an answer" but to surface and fix
real runtime/prompting bugs under load.

---

## How to use

1. Pick a **subject** and the **specialist agent** the architect should synthesize about it
   (fill the `<<SUBJECT>>`, `<<SPECIALIST_SLUG>>` placeholders below). Make it genuinely
   demanding — multiple distinct research angles, real knowledge, custom code, UI, and a
   DAG tasklist.
2. Paste the **Operator prompt** into a fresh Claude Code session in this repo.
3. Let it run. It will background the CLI, poll the trace ~every minute, and intervene on
   real failures.

Swap the subject freely (e.g. "on-device small language models", "solid-state battery
chemistry", "the EU AI Act compliance landscape", "competitive analysis of vector DBs").
The harness is domain-agnostic.

---

## Operator prompt (paste this)

> Run a complex, trace-driven experiment on the **architect** agent and fix any real
> issues you find along the way.
>
> **The task for the architect** (pass verbatim as the CLI message, with the placeholders
> filled): use the deep researcher to research a subject by asking it SEVERAL separate
> questions, then design and scaffold a brand-new specialist agent space about it.
>
> ```
> Your job: use the Deep Research Analyst agent to research a subject thoroughly by asking
> it SEVERAL separate questions, then design and scaffold a brand-new specialist agent
> space about that subject. Do NOT run your synthesize_and_run tasklist for the research —
> drive the deep researcher yourself via delegate(). Never call ask(); you have everything
> below.
>
> Subject: <<SUBJECT>>.
>
> STEP 1 — Register the deep researcher:
>   const reg = await registerSpace('<<ABS_REPO>>/fixtures/deep_research');
>   // reg.agentSlug === 'researcher'; action id is 'research_report'; pass the topic in context.
>
> STEP 2 — Ask the deep researcher THREE separate research questions (Promise.all is fine),
> each a different angle on the subject. Pass each as:
>   delegate(reg.spaceKey, reg.agentSlug, 'research_report',
>     { query: '<question>', context: { topic: '<question>' } });
> Bind each result (q1/q2/q3). Use display() for short progress; keep compact summaries.
>
> STEP 3 — Using the three reports, scaffold a NEW space '<<SPECIALIST_SLUG>>' that is FULL:
>   - an agent with a real system prompt that calls loadKnowledge at runtime
>   - real KNOWLEDGE distilled from the research: ≥1 domain/field with 2+ option files,
>     each containing actual findings AND the source URLs the researcher returned
>   - ≥1 custom FUNCTION (single export, no imports)
>   - ≥1 VIEW component and ≥1 FORM component (web + ink)
>   - a TASKLIST with a goal task that resolves a structured result, wired to an action
>   Build the space one file at a time (writeAgentFile / writeTaskFile / writeKnowledgeIndex / writeKnowledgeOption / writeFunctionFile / writeComponentFile) → validateSpace → registerSpace; display any errors.
>   Build knowledge content by REFERENCING your research variables, never by re-typing them.
>
> STEP 4 — delegate() to the new space to answer a concrete sample question, and
> display(JSON.stringify(result, null, 2)). Report what you built.
> ```
>
> **Operator protocol:**
>
> 1. **Pre-flight.** Confirm `pnpm build` output exists (`libs/cli/dist/cli/bin.js`),
>    `.env` has `AZURE_*` + `TAVILY_API_KEY`, and `.issues/` is empty. Pick a model
>    (`--model M`). Use an absolute path for the deep_research registration.
> 2. **Launch** the architect in the background with a trace:
>    ```bash
>    node libs/cli/dist/cli/bin.js --space ./fixtures/architect --agent architect \
>      --model M --claude --trace /tmp/arch-traces/runN.jsonl "<task message>" \
>      > /tmp/arch-traces/runN.stdout.log 2>&1
>    ```
>    (`--claude` = non-interactive stdin; the task must never call `ask()`.)
> 3. **Monitor ~every minute.** Arm a heartbeat that summarizes progress and surfaces
>    errors, and EXITS when the run ends. Detect "alive" with a pgrep pattern that does
>    NOT also match the monitor's own command line (e.g. `pgrep -f "agent architect --model M"`
>    — and do not put that exact phrase elsewhere in the monitor body, or it self-matches
>    and never terminates). Useful signals from the trace (NDJSON):
>    - event types: `jq -r '.type' run.jsonl | sort | uniq -c`
>    - yields: `jq -c 'select(.type=="yield") | {kind}' run.jsonl`
>    - delegate results: `select(.type=="yield_resolved" and .kind=="delegate") | .value`
>    - retry depth: `select(.type=="llm_response") | .attempt` (sustained >3 on one
>      statement = stuck, not self-healing)
>    - scaffold/validate outcome: grep the stdout log for `Scaffold result` / `Validation result`.
> 4. **Judge, don't just watch.** Transient typecheck retries and the deep researcher's
>    cosmetic final-display errors are self-healing (delegate auto-captures the tasklist
>    result) — do NOT restart for those; restarting wastes completed real research. The
>    decisive checkpoint is the architect's own **scaffold → validate → register → delegate**
>    phase.
> 5. **When you hit a real, fixable failure** (a crash, a `{ok:false}` the model can't
>    recover from, hallucinated/garbled data, a wrong-shape spec, a prompting gap): STOP the
>    run, diagnose it from the trace, and fix it at the right layer —
>    - **prompting** → `system-spaces/system-architect/agents/architect/instruct.md`,
>      `fixtures/deep_research/...`, or the universal preamble `context/system-block.ts`;
>    - **core/globals** → `eval/turn-loop.ts`, `globals/*.ts`, `spaces/*.ts`,
>      `system-spaces/.../functions/*.ts`.
>    Prefer making the runtime **liberal/self-correcting** (normalize what the model
>    actually emits; turn cryptic crashes into actionable errors) over fighting a strong
>    model prior with more prompt text — prompt-only fixes often fail twice.
> 6. **Test every fix** before restarting: add/extend a co-located test that would have
>    caught it (`architect-functions.test.ts`, `turn-loop-yield.test.ts`, etc.), run
>    `npx vitest run -t <name>` then the full suite, and `pnpm --filter @repl/core build`
>    if you touched `src/` (system-space `functions/*.ts` transpile at runtime — no build).
> 7. **Restart** with a fresh trace (`runN+1.jsonl`), `rm -rf` the half-built generated
>    space first, and repeat from step 3.
>
> **Success criteria:**
> - The architect delegated to the deep researcher ≥3 times, each returning a real cited report.
> - each per-file builder (writeAgentFile/writeTaskFile/…) → `ok:true`; `validateSpace` → `ok:true, errors:[]`.
> - The generated space on disk has agent + multi-option knowledge **with source URLs** +
>   function + view & form components + a goal tasklist + a wired action — no empty shells,
>   no double extensions.
> - The final `delegate()` to the new space returns a substantive, knowledge-grounded answer.
> - Full test suite green; `.issues/` empty; CLAUDE.md updated if behavior changed.

---

## Variants

- **Different agent under test:** point `--agent` at `solver` (verifier-gated coding) or
  `engineer`, and rewrite STEP 3/4 accordingly — same operator protocol.
- **Keyless / deterministic:** drive via `--mock <file>` (see `fixtures/solver/mock.mjs`)
  to reproduce a failure without API calls; every `--trace` assertion still works.
- **Tougher research:** require 4–5 research angles, a cross-source contradiction the
  specialist must reconcile, and a tasklist with a real DAG (`dependsOn`) + a condition.

- **Web observability (monitor through the DevTools UI + agent API):** launch with
  `--web <port>` instead of a bare run, so the whole delegation/fork/tasklist tree is
  observable live (and replayable from the `--trace` file). Drive and monitor it
  **headless via the agent HTTP API** — this also validates the "minimum-context"
  control surface:

  ```bash
  node libs/cli/dist/cli/bin.js --space ./fixtures/architect --agent architect \
    --model M --claude --web 3480 --trace /tmp/arch-traces/run1.jsonl \
    > /tmp/arch-traces/run1.stdout.log 2>&1 &

  # kick off the task (web mode does NOT auto-start — the message does)
  curl -s -X POST localhost:3480/api/message --data @/tmp/arch-task.json -H 'content-type: application/json'

  # monitor every ~minute (instead of jq) — the ASCII tree shows status/duration/retries:
  curl -s localhost:3480/api/state
  curl -s "localhost:3480/api/events?since=<lastSeq>"          # incremental tail
  curl -s "localhost:3480/api/node/<forkId>?tab=statements"    # drill into a failing fork
  ```

  The `--trace` file is also served at `/trace.jsonl`, so the same run is replayable in
  the browser at `http://localhost:3480/?trace=/trace.jsonl` (timeline scrubber).
  Full API guide: `libs/cli/src/web/AGENT.md` (also at `/api/help`).

  Two **model-adherence** findings this surfaced (both pre-existing, orthogonal to the
  observability layer — not runtime bugs):
  - In `--web`, each `POST /api/message` is one session turn; a strong model often
    **stops after the first STEP** of a multi-step program rather than chaining across
    yields. Pushing it with a follow-up `POST /api/message` (routed to `session.continue()`,
    scope preserved) reliably advances it (and exercises the multi-turn web REPL).
  - The deep-research `extract_facts` task is flaky: the fork **redefines** the
    `extractKeyFacts()`/`formatCitation()` helpers (already provided as space functions),
    and the multi-line redefinitions break across statement boundaries ("Function
    implementation is missing…") → retries exhaust → the required task fails. The
    inspector's Statements tab pinpoints this immediately. Fix at the deep_research
    prompt (don't redefine provided functions) before expecting a clean end-to-end.

  **Cleanup gotcha:** if the architect runs the per-file builders against an *existing* fixture
  (e.g. it tries to "create" `fixtures/deep_research` instead of `registerSpace`-ing it),
  it overwrites that fixture's files. `git status fixtures/` after a run and
  `git checkout` / `rm` any stray changes.
