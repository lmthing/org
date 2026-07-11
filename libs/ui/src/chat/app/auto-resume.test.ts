import { describe, it, expect, vi } from 'vitest';
import { overlayEnvKeys, waitForPodReady, resumeMessage } from './auto-resume.js';

describe('overlayEnvKeys (Integrations tab merge-PUT)', () => {
  it('overlays only the owned keys onto the full env map, preserving the rest', () => {
    const current = { OTHER_KEY: 'keep-me', DEMO_TOKEN: 'old' };
    const merged = overlayEnvKeys(current, ['DEMO_TOKEN'], { DEMO_TOKEN: 'new', UNRELATED: 'x' });
    // The unrelated pod var is preserved; only DEMO_TOKEN is overwritten; a field
    // value not in `keys` (UNRELATED) is NOT written.
    expect(merged).toEqual({ OTHER_KEY: 'keep-me', DEMO_TOKEN: 'new' });
  });

  it('writes an empty string for an owned key with no field value (explicit unset)', () => {
    const merged = overlayEnvKeys({ A: '1' }, ['DEMO_TOKEN'], {});
    expect(merged).toEqual({ A: '1', DEMO_TOKEN: '' });
  });

  it('does not mutate the input map', () => {
    const current = { A: '1' };
    overlayEnvKeys(current, ['B'], { B: '2' });
    expect(current).toEqual({ A: '1' });
  });
});

describe('waitForPodReady (post-after-wake gating)', () => {
  const fakeClock = () => {
    let t = 0;
    return {
      now: () => t,
      sleep: vi.fn(async (ms: number) => {
        t += ms;
      }),
    };
  };

  it('resolves (allowing the resume post) only once the probe reports ready', async () => {
    const clock = fakeClock();
    // Not-ready for the first two polls, then ready.
    const probe = vi.fn<[], Promise<boolean>>()
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(false)
      .mockResolvedValue(true);
    await expect(
      waitForPodReady({ probe, sleep: clock.sleep, now: clock.now }, { intervalMs: 100, initialDelayMs: 50 }),
    ).resolves.toBeUndefined();
    expect(probe).toHaveBeenCalledTimes(3);
  });

  it('waits the initial grace delay before the first probe', async () => {
    const clock = fakeClock();
    const probe = vi.fn(async () => true);
    await waitForPodReady({ probe, sleep: clock.sleep, now: clock.now }, { initialDelayMs: 1500 });
    expect(clock.sleep).toHaveBeenCalledWith(1500);
  });

  it('throws on timeout (never silently drops — caller shows Retry) if never ready', async () => {
    const clock = fakeClock();
    const probe = vi.fn(async () => false);
    await expect(
      waitForPodReady({ probe, sleep: clock.sleep, now: clock.now }, { timeoutMs: 500, intervalMs: 100, initialDelayMs: 0 }),
    ).rejects.toThrow(/restart/i);
  });
});

describe('resumeMessage', () => {
  it('is a stable, idempotent nudge naming the integration', () => {
    expect(resumeMessage('integration-demo')).toBe(
      'Integration "integration-demo" is now configured — please continue.',
    );
  });
});
