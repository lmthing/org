# Trace fixtures — the failure-fixture bank

Recorded model transcripts, replayed offline through the **real** host pipeline by
`mockFromTrace` (`../trace-replay.ts`). No provider credentials, no nondeterminism:
the model is out of the loop and only the host runs.

Grounded reference → [`org/docs/contributing/testing.md`](../../../../../../org/docs/contributing/testing.md#replaying-a-recorded-trace-mockfromtrace).

## Why a bank

The whole model boundary is one injected `streamFn`, and the tracer sits downstream of
it, so a `--trace` file already contains everything the model contributed to a run and
nothing else. Feeding those responses back in re-runs boundary carving, model-habit
sanitization, prose demotion, typecheck, eval, yield binding and error rewriting against
a known transcript.

Two kinds of fixture live here:

- **known-good** — a healthy run. A prompt/parser/mercy-layer change that silently alters
  statement extraction breaks the replay. `hello-yield.trace.ndjson` is the seed one.
- **known-bad** — a *failure* transcript harvested from a real run (narration instead of
  code, an unterminated string literal, a missing `await` on a yielding call, a
  hallucinated global, a leaked `<think>` tag). The test asserts what the host does with
  it. When a mercy layer is added or fixed, the same fixture flips from
  "reproduces the failure" to "neutralized" — in the same change.

## Harvesting a fixture from a real run

```bash
# 1. record — any real run, any model
node libs/cli/dist/cli/bin.js --space <dir> --trace /tmp/run.ndjson "<message>"

# 2. replay it (CLI): a .ndjson/.jsonl --mock path routes through mockFromTrace
node libs/cli/dist/cli/bin.js --space <dir> --mock /tmp/run.ndjson "<same message>"
LM_MOCK_MODE=fingerprint node libs/cli/dist/cli/bin.js --space <dir> --mock /tmp/run.ndjson "<same message>"

# 3. keep it
cp /tmp/run.ndjson libs/core/src/testing/fixtures/<name>.trace.ndjson
```

Then add a test in `../trace-replay.test.ts` (or nearer the layer under test) that runs a
`Session` with `mockFromTrace('<name>.trace.ndjson')` and asserts the observable outcome —
displays, the `statement` trace events, the final state.

`hello-yield.trace.ndjson` is regenerated, not hand-edited:

```bash
LM_UPDATE_FIXTURES=1 pnpm test libs/core/src/testing/trace-replay
```

## Trimming a fixture

Only `llm_request` / `llm_response` events are read; everything else is skipped, and both
on-disk shapes parse (NDJSON from `--trace`, and the JSON array a persisted
`.lmthing/**/sessions/*/trace.json` snapshot holds). A large trace can therefore be
trimmed to just its `llm_*` lines with `grep '"type":"llm_re'`, and a single failing turn
can be lifted out into a one-exchange fixture.

Two things to check before committing a harvested trace:

- **secrets** — a trace records the FULL system block and every prompt message, including
  whatever the user typed and whatever a tool returned. Read it before committing.
- **size** — the system block repeats on every request. Trim to the turns the test needs.

## Replay modes

- `sequential` (default) — call *N* of the replay gets recorded response *N*. Faithful and
  strict; the right mode for a single-threaded recording. Any extra model call the replay
  makes (a retry or nudge the recording did not take) throws.
- `fingerprint` — each request is matched to a recorded one by its last user message.
  Use when the replay may reorder calls relative to the recording (retries, concurrent
  forks). Repeats of the same prompt are served in recorded order.

Both fail loudly on exhaustion — a replay never silently returns an empty response,
because an empty response reads as "the model decided it was done" and would turn a
divergence into a green test.
