// Scripted mock for Phase 2D: a fork calls progress() inside it and resolves
// with its own isolated counters. The orchestrator displays them.
// Expected output line: "episodes=N toolCalls=M elapsedMs=T" (N>=1, M>=0).
//
//   node packages/cli/dist/cli/bin.js --space fixtures/solver --claude \
//     --mock fixtures/solver/mock-fork-progress.mjs \
//     --trace /tmp/fork-progress.jsonl "measure progress"

const FORK_CALL =
  `const f = await fork({ role: 'general', instruction: 'measure your own progress and return the counts', output: { episodes: 'number', toolCalls: 'number', elapsedMs: 'number' } }) as { episodes: number; toolCalls: number; elapsedMs: number };`;
const SHOW =
  `display("episodes=" + f.episodes + " toolCalls=" + f.toolCalls + " elapsedMs=" + f.elapsedMs);`;

let orchestratorCalls = 0;

export default function handler(opts) {
  const hay = opts.system + '\n' + opts.messages.map((m) => m.content).join('\n');
  if (hay.includes('currentTask')) {
    // Fork: read its own live progress counters and resolve with them.
    return (
      `const p = progress();\n` +
      `currentTask.resolve({ episodes: p.episodes, toolCalls: p.toolCalls, elapsedMs: p.elapsedMs });`
    );
  }
  orchestratorCalls++;
  if (orchestratorCalls === 1) return FORK_CALL;
  if (orchestratorCalls === 2) return SHOW;
  return '';
}
