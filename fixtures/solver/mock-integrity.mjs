// Scripted mock for §6.3 integrity: compound verifyCondition rejects a partial
// pass. "score >= 10 AND quality != 'fake'" — the first attempt satisfies the
// score clause but fails the quality clause; the retry fixes both.
// Expected: verified=true, rung=1 (retry rung), attempts=2, quality=real.
//
//   node packages/cli/dist/cli/bin.js --space fixtures/solver --claude \
//     --mock fixtures/solver/mock-integrity.mjs \
//     --trace /tmp/integrity.jsonl "produce quality score"

const SOLVE =
  `const r = await solve({\n` +
  `  instruction: "produce a quality score",\n` +
  `  output: { score: 'number', quality: 'string' },\n` +
  `  verifyCondition: "score >= 10 AND quality != 'fake'",\n` +
  `}) as { value: { score: number; quality: string }; rung: number; attempts: number; verified: boolean };`;

const SHOW =
  `display("verified=" + r.verified + " rung=" + r.rung + " attempts=" + r.attempts + " quality=" + r.value.quality);`;

let orchestratorCalls = 0;

export default function handler(opts) {
  const hay = opts.system + '\n' + opts.messages.map((m) => m.content).join('\n');
  if (hay.includes('currentTask')) {
    const isRetry = hay.includes('Feedback from the previous attempt');
    // First attempt: score ok but quality is 'fake' → condition fails.
    // Retry: both clauses pass.
    return isRetry
      ? `currentTask.resolve({ score: 15, quality: 'real' });`
      : `currentTask.resolve({ score: 15, quality: 'fake' });`;
  }
  orchestratorCalls++;
  if (orchestratorCalls === 1) return SOLVE;
  if (orchestratorCalls === 2) return SHOW;
  return '';
}
