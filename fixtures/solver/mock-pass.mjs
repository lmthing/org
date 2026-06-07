// Scripted mock provider for fixtures/solver — the "easy, first-try pass" case
// (scenario 3A in .claude/plans/live-testing.md). The single attempt verifies, so
// the ladder is never climbed. Expected: verified=true, rung=0, attempts=1, and
// exactly one fork:* conversation in the trace.
//
//   node packages/cli/dist/cli/bin.js --space fixtures/solver --claude \
//     --mock fixtures/solver/mock-pass.mjs --trace /tmp/solver.jsonl "implement add"

const CORRECT = `export function add(a: number, b: number): number {
  return a + b;
}
`;

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
  if (hay.includes('currentTask')) {
    // Every attempt is correct → verify passes on the first try (rung 0).
    return (
      `writeFile(process.env.LMTHING_SPACE_DIR + "/work/candidate.ts", ${JSON.stringify(CORRECT)});\n` +
      `currentTask.resolve({ summary: "implemented add(a,b)" });`
    );
  }
  orchestratorCalls += 1;
  if (orchestratorCalls === 1) return SOLVE;
  if (orchestratorCalls === 2) return SHOW;
  return '';
}
