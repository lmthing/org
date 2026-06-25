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
import {
  runCli,
  hasBin,
  sessionRequests,
} from './live-harness.js';

const TIMEOUT = 60_000;

describe.skipIf(!hasBin())('keyless CLI suite (mock provider)', () => {
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

  it('2A: progress() reads live counters', async () => {
    const r = await runCli({
      scenario: '2a-progress',
      space: 'fixtures/engineer',
      mock: 'fixtures/engineer/mock.mjs',
      message: 'call progress and show the counts',
    });
    expect(r.stdout).toMatch(/^episodes=\d+ toolCalls=\d+ elapsedMs=\d+/m);
  }, TIMEOUT);
});
