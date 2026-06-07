// Scripted mock provider for fixtures/solver — the "escalate-to-race" scenario
// (3C in .claude/plans/live-testing.md). Both the single attempt and the retry
// fail the verifier, so solve() climbs to the race3 rung where 3 parallel forks
// are spawned; the first (and all) of them pass.
//
// Expected: verified=true, rung=2, attempts=5, 5 fork conversations in trace.
//
//   node packages/cli/dist/cli/bin.js --space fixtures/solver --claude \
//     --mock fixtures/solver/mock-race.mjs --trace /tmp/solver.jsonl "implement add"
//
// Uses verifyCondition (not verifyCommand) so no external tools are needed.

const SOLVE = `const r = await solve({
  instruction: "Produce a score of at least 10",
  output: { score: 'number' },
  verifyCondition: "score >= 10",
  maxAttempts: 6,
}) as { value: { score: number }; rung: number; attempts: number; verified: boolean };`;

const SHOW = `display("verified=" + r.verified + " rung=" + r.rung + " attempts=" + r.attempts);`;

let orchestratorCalls = 0;
let forkCallCount = 0;

export default function handler(opts) {
  const hay = opts.system + '\n' + opts.messages.map((m) => m.content).join('\n');
  if (hay.includes('currentTask')) {
    // Fork calls 0 (rung0) and 1 (retry) return a failing score.
    // Fork calls 2, 3, 4 (race3) return a passing score.
    const score = forkCallCount++ >= 2 ? 20 : 5;
    return `currentTask.resolve({ score: ${score} });`;
  }
  orchestratorCalls++;
  if (orchestratorCalls === 1) return SOLVE;
  if (orchestratorCalls === 2) return SHOW;
  return '';
}
