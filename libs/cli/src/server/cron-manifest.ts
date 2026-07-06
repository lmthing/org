/**
 * Externalized-cron manifest (pod → gateway).
 *
 * With scale-to-zero, a pod's in-process cron tick dies while the pod sleeps, so
 * the always-on gateway must know *when* to wake the pod for each due job. This
 * module reads every project's cron hooks + persisted `lastRunAt` and publishes a
 * flat manifest of `{ projectId, slug, cronExpr, everyMs, nextRunAt }` to the
 * gateway. The gateway stores it and wakes the pod at each `nextRunAt`; the pod's
 * existing boot catch-up then runs the due hooks and republishes (advancing
 * `nextRunAt`).
 *
 * Pure disk I/O — no model calls, no new deps. Gated by the caller on the pod
 * having gateway env (compute JWT + gateway URL); a no-op in local dev.
 */
import { join } from 'node:path';
import {
  loadHooks,
  loadHooksState,
  cronIntervalMs,
  nextRunAt,
  crontabSchedule,
  type CronHookDef,
} from '../app/hooks/index.js';

/** One cron job in the published manifest. `nextRunAt` is epoch-ms. */
export interface CronManifestJob {
  projectId: string;
  slug: string;
  cronExpr: string;
  everyMs: number;
  nextRunAt: number;
}

/**
 * Build the cron manifest across `projects` from disk (`hooks/` + each project's
 * `.data/hooks-state.json`). A project whose hooks fail to load is skipped. Pure.
 */
export async function buildCronManifest(
  root: string,
  projects: string[],
  _now: number = Date.now(),
): Promise<CronManifestJob[]> {
  const jobs: CronManifestJob[] = [];
  for (const projectId of projects) {
    const projectRoot = join(root, projectId);
    let loaded;
    try {
      loaded = await loadHooks(projectRoot);
    } catch {
      continue;
    }
    const cronHooks = loaded.filter((h) => h.def.type === 'cron');
    if (cronHooks.length === 0) continue;
    const state = await loadHooksState(projectRoot);
    for (const h of cronHooks) {
      const def = h.def as CronHookDef;
      const lastRunAt = state.cron[h.slug]?.lastRunAt ?? 0;
      jobs.push({
        projectId,
        slug: h.slug,
        cronExpr: crontabSchedule(def),
        everyMs: cronIntervalMs(def),
        nextRunAt: nextRunAt(def, lastRunAt),
      });
    }
  }
  return jobs;
}

/**
 * POST the manifest to the gateway (compute-JWT authed). Best-effort: logs and
 * swallows any error so a gateway blip never destabilises the pod. The caller
 * gates on `jwt`/`gatewayUrl` being present (absent in local dev ⇒ never called).
 */
export async function publishCronManifest(
  gatewayUrl: string,
  jwt: string,
  jobs: CronManifestJob[],
): Promise<void> {
  try {
    const r = await fetch(`${gatewayUrl}/api/compute/cron-manifest`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${jwt}`,
      },
      body: JSON.stringify({ jobs }),
    });
    if (!r.ok) {
      console.warn(`[cron-manifest] publish failed: HTTP ${r.status}`);
    }
  } catch (err) {
    console.warn(
      '[cron-manifest] publish error:',
      err instanceof Error ? err.message : err,
    );
  }
}
