# Live-prod scenario campaign — the repeatable workflow

This is the **process** behind `sdk/org/scenarios/*`, distilled from scenario 05 (the flagship
Latin-America lifecycle). It is written so you can point it at *something else* — a new scenario, a
new feature area, a new "does the product actually do what it promises" question — and run the same
loop end to end: **write a resumable live runner → run it Act by Act against prod → triage each
failure → fix it IN THE PRODUCT with a test → rebuild the image → verify live → report honestly.**

A scenario is not a feature test. It is a test of a *promise* under a long, messy, realistic
sequence of instructions. The most valuable output is the **honest narrative of where the product
broke down**, not a green checkmark.

---

## 0. The one-screen version

1. **Understand** — the scenario `.md` IS the executable spec. Read it, the harness (`README.md`),
   and the skills it touches.
2. **Scaffold** a resumable `run.mjs` (copy `_template/run.mjs`): checkpoint per Act, keepalive,
   resume-on-restart, scripted asks, assertions that read the **trace + real side effects**.
3. **Provision** a disposable prod user (`node provision.mjs <label>`); load integration/env secrets
   **before** the first session (a `PUT env` rolls the pod).
4. **Run Act by Act**, checkpointing after each, babysat by a `run_in_background` wait.
5. **Triage** every failure: harness-assertion bug vs REAL product bug (read the trace, the pod
   logs, reproduce minimally).
6. **Fix in the product** — surgical, with a unit test that *would have caught it*. Commit the
   submodule, then bump the parent pointer.
7. **Verify live** — code fixes need a new compute image: parent push → CI builds
   `compute:<7-char-parent-sha>` → upgrade the test pod → re-run the failing Act.
8. **Report** — verdict, every issue + fix sha, perf table, the honest narrative.

---

## 1. Scaffold the runner (the hardened harness patterns)

Copy `sdk/org/scenarios/_template/run.mjs`. The patterns that made S05 survivable — **do not skip
them**, every one was learned from a real mid-run failure:

- **Checkpoint after every Act** to `results/<id>-checkpoint.json` (label, project, sessionId, acts
  passed). A 3-hour run must resume from the last good Act, not restart. Support `--acts=3,4`.
- **Keepalive pinger** — a free-tier pod scales to zero on idle, which kills the in-memory session
  and 404s your next poll. `setInterval(() => pod.req('POST','/api/keepalive',{}), 30_000)`.
- **Resilient `send`** — wrap `thing.send`: on `404 unknown session` OR `entered error state`, wait
  for the pod, re-resume the persisted session (or start fresh) and retry. This *is* the Act-IV
  "restart → auto-resume" edge, exercised for real, and it keeps the run alive through pod rolls.
- **Scripted `onAsk`** — approve/deny consent cards per branch, and **settle any other ask (a Form)
  with `{}`** so a fully-autonomous run never hangs on a human prompt. (S05: "book me a flight"
  raised a booking Form; an unanswered ask times out and crashes the run.)
- **Assert on the TRACE and real side effects, not prose.** Which agent it delegated to, which
  consent-marked global it called, which rows appeared, tokens burned — not a paragraph of English.
  Gotchas: web research surfaces as `fetch` yields (count them, plus `webSearch`/`webFetch`);
  delegate-sub-session yields *do* appear in the parent stream; tolerate curly apostrophes in
  refusal text (`can['’]t`); a re-add / re-ask at the END guards against routing degradation.

## 2. Provision + drive

```bash
cd sdk/org/scenarios/harness
node provision.mjs <label>            # disposable user-<id> + pod + Azure keys (budget-free)
node smoke.mjs                        # prove prod is healthy first
node ../<id>/run.mjs                  # your runner writes its own report
```

- Load integration secrets via `mergePodEnv` **before** opening sessions (a `PUT env` rolls the pod;
  a session on the old replica dies with it). Sign inbound bodies as the provider would
  (`x-demo-signature: sha256=<hmac>`), deliver to the pod's `/api/inbound/<path>` (verify happens
  pod-side) or through the real gateway broker for a true end-to-end path.
- Keep the conversation **realistic** — drifting, incremental, unrelated chatter between the load-
  bearing turns. A promise that only holds under a scripted happy path isn't kept.

## 3. Triage a failure — harness bug or product bug?

Before "fixing" anything, find the *real* cause:

- **Read the trace** (`GET /api/sessions/:id/events`) for the exact `eval_error`/`typecheck_error`
  **statement**, and the pod logs (`kubectl logs`) for boot/hook-load failures.
- **Reproduce minimally** — a direct one-turn probe (fresh project, one message) isolates whether
  the failure is the phrasing, the agent, the runtime, or your assertion. S05: a *vague* automator
  ask hallucinated garbage identifiers; the *same* ask phrased directly authored cleanly — that
  distinction is the whole finding.
- **Distinguish**: a wrong assertion (curly quote, delegate-scope, `fetch` vs `webSearch`) → fix the
  runner and note it. A real defect → fix the product.

## 4. Fix in the product (surgical + tested)

Where fixes live and how they flow:

- **Prompting** (most failures are here): agent `instruct.md` under
  `libs/core/system-spaces/<space>/agents/<agent>/`. Over/under-delegation, over-scaffolding,
  malformed authoring, missing capability grants — fix the prompt, driven by an *observed* failure,
  minimal. THING's `instruct.md` is shared — call out any change loudly.
- **Runtime**: an authoring writer (`libs/cli/src/app/authoring/globals.ts`) flows up through core
  injection (`libs/core/src/exec/app-globals.ts`) + the per-grant DTS
  (`libs/core/src/typecheck/library-dts.ts`) + session-manager wiring + the agent's
  `capabilities:`. Rebuild `@lmthing/core` (`pnpm --filter @lmthing/core build`) so the cli sees new
  `AppGlobalImpls` types.
- **Always add a test that would have caught it.** Prefer a unit test of the exact seam (a writer
  rejecting bad input, a resolver rewriting a path) when the live failure isn't reproducible under
  vitest's resolution.
- **Validate authored source before it lands.** A model can write a live file with literal `\n`
  escapes; an unparseable hook/page silently breaks the pipeline and can destabilize the pod. Reject
  it at the writer (`{ok:false}`) so the agent retries — never leave a broken file behind.

## 5. The image loop (verifying a code fix live)

Prompt-only fixes to a **system space** can be hot-patched onto a running pod (below); **code**
fixes need a new compute image.

- **Concurrency**: many agents share ONE `sdk/org` submodule working tree. Stage only *your* files
  (`git add <paths>`), stash others' scenario-result edits before `git pull --rebase`, retry on
  conflict, never force-push. Submodule first (commit + push), then parent (`git add sdk/org` +
  rebase + push) to trigger CI.
- **CI**: the `Build and Push Images` workflow tags compute with the **7-character parent short
  sha** (`02435e7`, not `02435e7a`). The post-build `publish-build-data` / `update-manifests` git
  jobs frequently FAIL on a rebase race — that does **not** mean the image failed; check the
  `build (compute …)` job status directly, and confirm the tag exists in ACR before you patch.
- **Upgrade a test pod** (no ArgoCD auto-roll for `user-*` namespaces):
  ```bash
  kubectl set image deployment/lmthing compute=lmthingacr.azurecr.io/compute:<7-char-sha> -n user-<id>
  kubectl rollout status deployment/lmthing -n user-<id> --timeout=180s
  ```
  The old pod serves until the new one is ready — no outage. Spaces/tables/app persist on the PVC.
- **Hot-patch a system-space prompt** WITHOUT a rebuild (fast iteration on an instruct/capability):
  `PUT /api/projects/system/spaces/<spaceId>/files/<rel>` with `{content}` (read back via
  `GET …/files`). Code (core/cli) changes still need an image.
- **Gotchas**: an 8-char tag → `ImagePullBackOff: not found`; pods have **no readinessProbe** by
  design (a readiness probe fails on event-loop stalls and yanks the pod mid-session) — hence the
  keepalive; `pod.ready` (readyReplicas>0) precedes Envoy wiring the woken endpoint, so tolerate one
  early 503.

## 6. Re-wake discipline (how to babysit a multi-hour run without stalling)

**Only a `run_in_background: true` Bash re-wakes a stopped subagent on exit.** `Monitor`, poll
tools, and "I'll wait for X" do NOT — a stopped agent parked on them stalls forever. So:

- Launch the run itself, or a bounded wait that exits on `RUN-EXITED` / a milestone / a detected
  problem, as a `run_in_background` Bash — you are auto-re-invoked with its output.
- A 5-minute heartbeat watchdog is a background loop that `sleep`s, probes pod health + run
  liveness, and **exits** (waking you) each cycle; re-launch it each wake. (zsh gotcha: `status` is
  read-only — use another variable name.)
- Between wakes, make progress (read traces, prepare the next fix), don't busy-poll.

## 7. Report (the deliverable)

- **Verdict**: `PASS` / `CONDITIONAL PASS` (promise substantially met, one reliability frontier
  open) / `FAIL`.
- **Checks** passed/failed on the trace + side effects.
- **Every issue found + whether fixed + commit sha.**
- **Performance table**: wall clock, per-unit timings, first-byte, tokens.
- **The honest narrative** — where it lost the thread, where it needed telling twice, where the
  abstraction leaked into the user's face. Do not smooth this over.
- Paste the "Actual results" back into the scenario `.md` (plan + record in one file); save
  `results/<id>-report.md` + the raw trace.

---

## Worked example — scenario 05

Six months / nine countries / one growing project. Ran across four compute images as fixes landed
during the run. **CONDITIONAL PASS.** What worked: incremental space growth + no-clobber re-adds,
consent install/decline, routing (incl. Spanish, not-degraded), a real app that **builds and serves
at `/app/latam/`**, `webhook`+`internal` emitters firing, 0-token code-filter. Six product bugs
found and fixed: THING over-scaffolding on a vague opener; no live page/API writer
(`writeProjectPage`/`writeProjectApi`); automator filesystem-exploration + no data-in path;
`@lmthing/ui/elements/*` esbuild resolution breaking every project-app page build; the automator
writing hooks with literal `\n`; and an impossible request handled by refusal not a fake form. The
open frontier: the automator's model-authoring reliability on loosely-phrased compound asks (it
authors tables/pages/events cleanly but botched every hook in one run). Full record:
[`05-latam-trip-lifecycle.md`](./05-latam-trip-lifecycle.md) → *Actual results*.
