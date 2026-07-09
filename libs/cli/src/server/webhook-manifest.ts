/**
 * Inbound-webhook manifest (pod → gateway).
 *
 * A project-app can declare a `webhook` hook (`app/hooks/loader.ts`) binding a
 * URL-safe `path` to an agent `trigger`. This module scans every project's
 * hooks for `webhook` defs, builds a flat manifest of `{ projectId, path,
 * provider, agentRef }` bindings, and publishes it to the gateway so external
 * callers can be routed to the right (possibly sleeping) pod at
 * `<gateway>/webhooks/<path>` → pod `POST /api/inbound/<path>` (mirrors
 * `cron-manifest.ts`'s publish path). `path` must be globally unique across
 * ALL projects on the pod — enforced fail-loud here, since the gateway routes
 * on `path` alone.
 *
 * Pure disk I/O — no model calls, no new deps. Gated by the caller on the pod
 * having gateway env (compute JWT + gateway URL); a no-op in local dev.
 */
import { join } from 'node:path';
import { loadHooks, type WebhookHookDef } from '../app/hooks/index.js';

/** One inbound-webhook binding in the published manifest. */
export interface WebhookBinding {
  projectId: string;
  /** URL-safe path segment — globally unique per pod (the routing key). */
  path: string;
  /** Verifier/adapter id (defaults to 'generic'). */
  provider: string;
  /** `space/agent#action` to run for each event (the hook's `trigger`). */
  agentRef: string;
}

/**
 * Build the webhook manifest across `projects` from disk (`hooks/*.ts`). A
 * project whose hooks fail to load is skipped. Fail-loud on a duplicate
 * `path` across ANY two projects (a webhook path must be globally unique on
 * this pod — the gateway cannot otherwise disambiguate the target project).
 */
export async function buildWebhookManifest(root: string, projects: string[]): Promise<WebhookBinding[]> {
  const bindings: WebhookBinding[] = [];
  const ownerByPath = new Map<string, string>();
  for (const projectId of projects) {
    const projectRoot = join(root, projectId);
    let loaded;
    try {
      loaded = await loadHooks(projectRoot);
    } catch {
      continue;
    }
    const webhookHooks = loaded.filter((h) => h.def.type === 'webhook');
    for (const h of webhookHooks) {
      const def = h.def as WebhookHookDef;
      const owner = ownerByPath.get(def.path);
      if (owner !== undefined && owner !== projectId) {
        throw new Error(
          `[webhook-manifest] duplicate webhook path "${def.path}": owned by project "${owner}" and project "${projectId}" — paths must be globally unique per pod`,
        );
      }
      ownerByPath.set(def.path, projectId);
      bindings.push({
        projectId,
        path: def.path,
        provider: def.provider ?? 'generic',
        agentRef: def.trigger,
      });
    }
  }
  return bindings;
}

/**
 * POST the manifest to the gateway (compute-JWT authed). Best-effort: logs and
 * swallows any error so a gateway blip never destabilises the pod. The caller
 * gates on `jwt`/`gatewayUrl` being present (absent in local dev ⇒ never called).
 */
export async function publishWebhookManifest(
  gatewayUrl: string,
  jwt: string,
  bindings: WebhookBinding[],
): Promise<void> {
  try {
    const r = await fetch(`${gatewayUrl}/api/compute/webhook-manifest`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${jwt}`,
      },
      body: JSON.stringify({ bindings }),
    });
    if (!r.ok) {
      console.warn(`[webhook-manifest] publish failed: HTTP ${r.status}`);
    }
  } catch (err) {
    console.warn(
      '[webhook-manifest] publish error:',
      err instanceof Error ? err.message : err,
    );
  }
}

/**
 * Find the webhook hook bound to `path` (across all `projects`) and resolve it
 * into what the inbound dispatcher needs to run it. Returns `null` when no
 * project declares a webhook hook with that `path`.
 */
export async function resolveBinding(
  root: string,
  projects: string[],
  path: string,
): Promise<{ projectId: string; agentRef: string; provider: string; budget?: unknown } | null> {
  for (const projectId of projects) {
    const projectRoot = join(root, projectId);
    let loaded;
    try {
      loaded = await loadHooks(projectRoot);
    } catch {
      continue;
    }
    const hit = loaded.find((h) => h.def.type === 'webhook' && (h.def as WebhookHookDef).path === path);
    if (hit) {
      const def = hit.def as WebhookHookDef;
      return {
        projectId,
        agentRef: def.trigger,
        provider: def.provider ?? 'generic',
        budget: def.budget,
      };
    }
  }
  return null;
}
