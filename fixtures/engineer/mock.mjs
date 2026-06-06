// Scripted mock provider for fixtures/engineer — drives the budget guardrails
// (Phase 1) and the progress() global (Phase 2) of .claude/plans/live-testing.md
// with NO API key.
//
//   # Phase 1A — episode cap fires (exit non-zero, "episodes limit of 3")
//   node packages/cli/dist/cli/bin.js --space fixtures/engineer --claude \
//     --mock fixtures/engineer/mock.mjs --max-episodes 3 --trace /tmp/t.jsonl "loop forever"
//
//   # Phase 1B — tool-call cap fires ("toolCalls limit of 2")
//   ... --max-tool-calls 2 "loop forever"
//
//   # Phase 2 — read the live counters
//   ... --trace /tmp/t.jsonl "call progress and show the counts"
//
// The default export is a MockHandler (see packages/core/src/testing/mock-provider.ts).

// One yield per turn (sleep). Each turn ticks an episode; each resolved yield ticks a
// tool call. The handler never returns '' on its own, so the run only ends when a
// budget cap trips — exactly what Phase 1 needs to observe a clean stop.
const TICK = `await sleep("1ms");`;

// Read the live run counters and render them. Non-yielding, so the loop ends after
// this single turn (Phase 2A).
const PROGRESS = `const p = progress();\n` +
  `display("episodes=" + p.episodes + " toolCalls=" + p.toolCalls + " elapsedMs=" + p.elapsedMs);`;

export default function handler(opts) {
  const hay = opts.messages.map((m) => m.content).join('\n');
  // Phase 2: the task asks about progress — read counters once and stop.
  if (/progress/i.test(hay)) return PROGRESS;
  // Phase 1: keep producing a yield every turn; the budget cap is what stops us.
  return TICK;
}
