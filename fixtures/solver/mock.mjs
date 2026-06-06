// Scripted mock provider for fixtures/solver — drives the `solve` retry ladder
// (scenario 3B in .claude/plans/live-testing.md) with NO API key.
//
// Run keyless:
//   node packages/cli/dist/cli/bin.js --space fixtures/solver --claude \
//     --mock fixtures/solver/mock.mjs --trace /tmp/solver.jsonl "implement add"
//
// Flow: the orchestrator emits a solve() call; the first attempt writes a
// type-INVALID candidate (tsc fails → feedback); the retry, which now carries the
// verifier feedback, writes the correct one. Expected result: verified=true,
// rung=1, attempts=2. The default export is a MockHandler (see
// packages/core/src/testing/mock-provider.ts).

// A candidate that type-checks under `tsc --noEmit --strict`.
const CORRECT = `export function add(a: number, b: number): number {
  return a + b;
}
`;
// A candidate with a real type error (returns string from a :number function),
// so `tsc --strict` rejects it and feeds the error back to the next attempt.
const BROKEN = `export function add(a: number, b: number): number {
  return a + "oops";
}
`;

// The TypeScript an attempt fork emits: write the candidate to the space's work/
// dir (absolute path via LMTHING_SPACE_DIR so it lands where verifyCommand looks,
// regardless of the CLI's cwd), then resolve the required output.
function emitCandidate(source, summary) {
  return (
    `writeFile(process.env.LMTHING_SPACE_DIR + "/work/candidate.ts", ${JSON.stringify(source)});\n` +
    `currentTask.resolve({ summary: ${JSON.stringify(summary)} });`
  );
}

// The TypeScript the orchestrator emits: one solve() call, then a display().
const SOLVE = `const r = await solve({
  instruction: "Implement add(a: number, b: number): number returning a + b. WRITE it to work/candidate.ts using writeFile(path, contents). It must type-check under --strict.",
  output: { summary: 'string' },
  role: 'general',
  verifyCommand: 'npx tsc --noEmit --strict work/candidate.ts',
  maxAttempts: 6,
}) as { value: { summary: string }; rung: number; attempts: number; verified: boolean };`;
const SHOW = `display("verified=" + r.verified + " rung=" + r.rung + " attempts=" + r.attempts);`;

let orchestratorCalls = 0;

export default function handler(opts) {
  const hay = opts.system + '\n' + opts.messages.map((m) => m.content).join('\n');

  // A fork attempt's prompt instructs it to call currentTask.resolve(...) — a marker
  // that never appears in the orchestrator's (session) prompt.
  if (hay.includes('currentTask')) {
    // The retry attempt carries the verifier feedback marker — emit the fix.
    const isRetry = hay.includes('Feedback from the previous attempt');
    return emitCandidate(isRetry ? CORRECT : BROKEN, isRetry ? 'fixed add(a,b)' : 'first attempt at add');
  }

  // Otherwise this is the orchestrator (the solver agent itself).
  orchestratorCalls += 1;
  if (orchestratorCalls === 1) return SOLVE; // turn 1: kick off solve()
  if (orchestratorCalls === 2) return SHOW;  // turn 2: report the result (post-yield)
  return ''; // anything further → end the loop
}
