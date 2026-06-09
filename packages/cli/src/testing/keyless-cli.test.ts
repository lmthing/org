/**
 * Keyless CLI integration suite — the vitest port of the former
 * scripts/live-test.sh. Drives the BUILT CLI against fixture spaces with the
 * scripted mock provider (--mock), so it needs NO API credentials and runs in
 * ordinary CI once the project is built. Each scenario asserts on the exit code,
 * the streamed stdout/stderr, and the --trace NDJSON.
 *
 * Requires `pnpm build` (it spawns packages/cli/dist/cli/bin.js); self-skips when
 * the dist binary is absent so a fresh `pnpm test` stays green.
 */
import { describe, it, expect } from 'vitest';
import { rmSync } from 'node:fs';
import { join } from 'node:path';
import {
  runCli,
  hasBin,
  REPO_ROOT,
  solveResult,
  forkRequests,
  sessionRequests,
  reqText,
} from './live-harness.js';

// The solver agent is now a system space; its mock providers still live under
// fixtures/solver/. solve() writes its candidate under the space dir (work/).
const SOLVER_SPACE = 'packages/core/system-spaces/solver';
const SOLVER_WORK = join(REPO_ROOT, SOLVER_SPACE, 'work');
const cleanWork = () => rmSync(SOLVER_WORK, { recursive: true, force: true });

const TIMEOUT = 60_000;

describe.skipIf(!hasBin())('keyless CLI suite (mock provider)', () => {
  it('3A: solve passes on the first attempt (rung 0, attempts 1)', async () => {
    cleanWork();
    const r = await runCli({
      scenario: '3a-solve-first-try',
      space: SOLVER_SPACE,
      mock: 'fixtures/solver/mock-pass.mjs',
      message: 'implement add',
    });
    const solve = solveResult(r.trace)!;
    expect(solve.verified).toBe(true);
    expect(solve.rung).toBe(0);
    expect(solve.attempts).toBe(1);
    expect(forkRequests(r.trace).length).toBe(1);
  }, TIMEOUT);

  it('3B: solve needs one retry (rung 1, attempts 2; feedback carried)', async () => {
    cleanWork();
    const r = await runCli({
      scenario: '3b-solve-retry',
      space: SOLVER_SPACE,
      mock: 'fixtures/solver/mock.mjs',
      message: 'implement add',
    });
    const solve = solveResult(r.trace)!;
    expect(solve.verified).toBe(true);
    expect(solve.rung).toBe(1);
    expect(solve.attempts).toBe(2);
    const withFeedback = forkRequests(r.trace).filter((e) =>
      reqText(e).includes('Feedback from the previous attempt'),
    );
    expect(withFeedback.length).toBe(1);
  }, TIMEOUT);

  it('1A: episode cap fires (exit 1, names the episodes limit, exactly 3 session requests)', async () => {
    const r = await runCli({
      scenario: '1a-episode-cap',
      space: 'fixtures/engineer',
      mock: 'fixtures/engineer/mock.mjs',
      message: 'loop forever',
      budget: { maxEpisodes: 3 },
    });
    expect(r.code).not.toBe(0);
    expect(r.stderr).toContain('episodes limit of 3');
    expect(sessionRequests(r.trace).length).toBe(3);
  }, TIMEOUT);

  it('1B: tool-call cap fires (exit 1, names the toolCalls limit)', async () => {
    const r = await runCli({
      scenario: '1b-toolcall-cap',
      space: 'fixtures/engineer',
      mock: 'fixtures/engineer/mock.mjs',
      message: 'loop forever',
      budget: { maxToolCalls: 2 },
    });
    expect(r.code).not.toBe(0);
    expect(r.stderr).toContain('toolCalls limit of 2');
  }, TIMEOUT);

  it('1C/3F: fork-depth cap bounds the solve ladder (exit 1, names forkDepth, no fork VM)', async () => {
    cleanWork();
    const r = await runCli({
      scenario: '1c-forkdepth-cap',
      space: SOLVER_SPACE,
      mock: 'fixtures/solver/mock.mjs',
      message: 'implement add',
      budget: { maxForkDepth: 0 },
    });
    expect(r.code).not.toBe(0);
    expect(r.stderr).toContain('forkDepth limit of 0');
    expect(forkRequests(r.trace).length).toBe(0);
  }, TIMEOUT);

  it('3C: solve escalates through retry to race (rung 2, attempts 5)', async () => {
    cleanWork();
    const r = await runCli({
      scenario: '3c-solve-race',
      space: SOLVER_SPACE,
      mock: 'fixtures/solver/mock-race.mjs',
      message: 'implement add',
    });
    const solve = solveResult(r.trace)!;
    expect(solve.verified).toBe(true);
    expect(solve.rung).toBe(2);
    expect(solve.attempts).toBe(5);
    expect(forkRequests(r.trace).length).toBe(5);
  }, TIMEOUT);

  it('2A: progress() reads live counters', async () => {
    const r = await runCli({
      scenario: '2a-progress',
      space: 'fixtures/engineer',
      mock: 'fixtures/engineer/mock.mjs',
      message: 'call progress and show the counts',
    });
    expect(r.stdout).toMatch(/^episodes=\d+ toolCalls=\d+ elapsedMs=\d+/m);
  }, TIMEOUT);

  it('2D: progress() inside a fork returns fork-isolated counters', async () => {
    cleanWork();
    const r = await runCli({
      scenario: '2d-fork-progress',
      space: SOLVER_SPACE,
      mock: 'fixtures/solver/mock-fork-progress.mjs',
      message: 'measure progress',
    });
    expect(r.stdout).toMatch(/episodes=\d+ toolCalls=\d+ elapsedMs=\d+/);
    expect(forkRequests(r.trace).length).toBe(1);
  }, TIMEOUT);

  it('§6.3: compound verifyCondition rejects partial pass; retry accepted', async () => {
    cleanWork();
    const r = await runCli({
      scenario: 'integrity-compound-condition',
      space: SOLVER_SPACE,
      mock: 'fixtures/solver/mock-integrity.mjs',
      message: 'produce quality score',
    });
    expect(r.code).toBe(0);
    const solve = solveResult(r.trace)!;
    expect(solve.verified).toBe(true);
    expect(solve.rung).toBe(1);
    expect(solve.attempts).toBe(2);
    expect(r.stdout).toContain('quality=real');
  }, TIMEOUT);
});
