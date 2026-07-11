/**
 * Plan S9 — republish-on-write orchestrator.
 *
 * `republishAll` re-derives the three runtime-published artifacts (webhook
 * manifest publish + crontab regen + emitter scan-cache clear). Proves:
 *   (a) all three actions run, each exactly once (the "boot publishes once" path);
 *   (b) a failing step is isolated — the later steps still run;
 *   (c) the emitter-cache clear is optional (absent ⇒ no throw).
 */
import { describe, it, expect, vi } from 'vitest';
import { republishAll } from './republish.js';

describe('republishAll (S9)', () => {
  it('(a) invokes manifest publish + crontab regen + cache clear once each', async () => {
    const publishWebhookManifest = vi.fn().mockResolvedValue(undefined);
    const regenerateCrontab = vi.fn().mockResolvedValue(undefined);
    const clearEmitterCache = vi.fn();

    await republishAll({ publishWebhookManifest, regenerateCrontab, clearEmitterCache });

    // Boot (and every install/authoring write) publishes exactly once.
    expect(publishWebhookManifest).toHaveBeenCalledTimes(1);
    expect(regenerateCrontab).toHaveBeenCalledTimes(1);
    expect(clearEmitterCache).toHaveBeenCalledTimes(1);
  });

  it('(b) isolates a failing step so the rest still run', async () => {
    const publishWebhookManifest = vi.fn().mockRejectedValue(new Error('gateway down'));
    const regenerateCrontab = vi.fn().mockResolvedValue(undefined);
    const clearEmitterCache = vi.fn();

    // Never throws — each step is best-effort.
    await expect(
      republishAll({ publishWebhookManifest, regenerateCrontab, clearEmitterCache }),
    ).resolves.toBeUndefined();

    expect(publishWebhookManifest).toHaveBeenCalledTimes(1);
    expect(regenerateCrontab).toHaveBeenCalledTimes(1);
    expect(clearEmitterCache).toHaveBeenCalledTimes(1);
  });

  it('(c) tolerates an absent emitter-cache clear', async () => {
    const publishWebhookManifest = vi.fn().mockResolvedValue(undefined);
    const regenerateCrontab = vi.fn().mockResolvedValue(undefined);

    await expect(
      republishAll({ publishWebhookManifest, regenerateCrontab }),
    ).resolves.toBeUndefined();

    expect(publishWebhookManifest).toHaveBeenCalledTimes(1);
    expect(regenerateCrontab).toHaveBeenCalledTimes(1);
  });
});
