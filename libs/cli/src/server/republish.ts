/**
 * Plan S9 — republish-on-write.
 *
 * Making a runtime WRITE (a store-space install, or an authoring write in S11)
 * take effect requires re-deriving three pod-wide artifacts that are otherwise
 * built only at boot:
 *
 *   1. the inbound webhook-emitter MANIFEST published to the gateway (so a newly
 *      installed space's webhook defs / `triggers:` agents route to this pod),
 *   2. the pod CRONTAB (so a new cron hook/emitter gets scheduled), and
 *   3. the emitter-def SCAN CACHE (so the next scan re-reads the changed
 *      `events/*.ts`).
 *
 * {@link republishAll} runs all three, each isolated + best-effort (one failing
 * step never skips the others). Both boot ({@link ../serve.js}) and the
 * post-install / post-authoring seams call the SAME callable — {@link buildRepublishDeps}
 * assembles the real actions from the pod's config so there is one code path.
 *
 * Kept deliberately thin + injectable so it is unit-testable with fakes and so
 * S10/S11 (authoring writes) can invoke it via `SessionManager.republish()`.
 */
import { buildWebhookManifest, publishWebhookManifest } from './webhook-manifest.js';
import { regenerateCrontab } from './routes/hooks.js';
import { clearEmitterDefCache } from './emitter-manifests.js';

/** The three republish actions. Injected so the orchestrator is testable with
 *  fakes; {@link buildRepublishDeps} wires the real ones. */
export interface RepublishDeps {
  /** Rebuild the webhook-emitter manifest and publish it to the gateway. */
  publishWebhookManifest: () => Promise<void>;
  /** Regenerate the pod crontab from every project's cron hooks (guarded — a
   *  NO-OP in local dev / when `LM_ENABLE_CRONTAB` is unset). */
  regenerateCrontab: () => Promise<void>;
  /** Invalidate the emitter-def scan cache so the next scan re-reads disk. */
  clearEmitterCache?: () => void;
}

/** Run one republish step, isolating its failure (a warn, never a throw) so the
 *  remaining steps still run. */
async function runStep(label: string, fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
  } catch (err) {
    console.warn(`[republish] ${label} failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}

/**
 * Re-derive all runtime-published artifacts (webhook manifest + crontab + emitter
 * scan cache). Each step is best-effort + isolated. Callable at runtime after an
 * install or authoring write, AND at boot (the same single publish path).
 */
export async function republishAll(deps: RepublishDeps): Promise<void> {
  await runStep('webhook-manifest', deps.publishWebhookManifest);
  await runStep('crontab', deps.regenerateCrontab);
  try {
    deps.clearEmitterCache?.();
  } catch (err) {
    console.warn(`[republish] emitter-cache clear failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}

/** Config for {@link buildRepublishDeps} — the pieces the pod already has at boot. */
export interface RepublishConfig {
  /** `.lmthing` root. */
  root: string;
  /** Enumerate the project ids to include (excludes the synthetic `system`). */
  listProjectIds: () => Promise<string[]>;
  /** Server port (used for the crontab curl lines). */
  serverPort: number;
  /** Gateway publish target; absent (no gateway env) ⇒ the webhook manifest is
   *  built but not published (inert in local dev, matching boot). */
  gateway?: { url: string; jwt: string };
}

/**
 * Assemble the real {@link RepublishDeps} from the pod's config. Both the boot
 * path and the install/authoring seams use this so there is one publish code path.
 */
export function buildRepublishDeps(cfg: RepublishConfig): RepublishDeps {
  return {
    publishWebhookManifest: async () => {
      const projects = await cfg.listProjectIds();
      const bindings = await buildWebhookManifest(cfg.root, projects);
      if (cfg.gateway) await publishWebhookManifest(cfg.gateway.url, cfg.gateway.jwt, bindings);
    },
    regenerateCrontab: async () => {
      const projects = await cfg.listProjectIds();
      await regenerateCrontab(cfg.root, projects, cfg.serverPort);
    },
    clearEmitterCache: () => clearEmitterDefCache(),
  };
}
