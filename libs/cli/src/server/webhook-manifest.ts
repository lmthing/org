/**
 * Inbound-webhook manifest (pod → gateway).
 *
 * A binding can come from either of two sources:
 *   - a project-app `webhook` hook (`app/hooks/loader.ts`), binding a
 *     URL-safe `path` to an agent `trigger`; or
 *   - a SPACE agent's `triggers:` frontmatter (`@lmthing/core` `loadAgent`),
 *     binding a `path` directly on the agent — no `hooks/*.ts` file needed.
 *
 * This module scans every project's hooks AND space agents for these
 * bindings, builds a flat manifest of `{ projectId, path, provider, agentRef
 * }` entries, and publishes it to the gateway so external callers can be
 * routed to the right (possibly sleeping) pod at `<gateway>/webhooks/<path>`
 * → pod `POST /api/inbound/<path>` (mirrors `cron-manifest.ts`'s publish
 * path). `path` must be globally unique across ALL projects AND both binding
 * kinds on the pod — enforced fail-loud here, since the gateway routes on
 * `path` alone.
 *
 * Pure disk I/O — no model calls, no new deps. Gated by the caller on the pod
 * having gateway env (compute JWT + gateway URL); a no-op in local dev.
 */
import { basename, join } from 'node:path';
import { loadSpace } from '@lmthing/core';
import { loadHooks, loadSpaceHooks, type LoadedHook, type WebhookHookDef } from '../app/hooks/index.js';
import { listProjectSpaceDirs } from './projects.js';

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
 * Scan every space under `<root>/<projectId>/spaces/` for agents declaring a
 * `triggers:` frontmatter (`@lmthing/core` `loadAgent` → `AgentDef.triggers`)
 * and return one {@link WebhookBinding} per declared trigger. A space that
 * fails to load (bad frontmatter, missing files) is skipped — same
 * fail-soft-per-item posture as `buildWebhookManifest`'s hook loop, since a
 * single broken space must not blank the whole manifest.
 */
async function scanSpaceTriggers(root: string, projectId: string): Promise<WebhookBinding[]> {
  const bindings: WebhookBinding[] = [];
  const spaceDirs = await listProjectSpaceDirs(root, projectId);
  for (const dir of spaceDirs) {
    let space;
    try {
      space = await loadSpace(dir, { requireAgents: false, onWarn: () => {} });
    } catch {
      continue;
    }
    const spaceId = basename(dir);
    for (const [agentSlug, agent] of Object.entries(space.agents)) {
      for (const trigger of agent.triggers ?? []) {
        bindings.push({
          projectId,
          path: trigger.path,
          provider: trigger.provider ?? 'generic',
          agentRef: `${spaceId}/${agentSlug}`,
        });
      }
    }
  }
  return bindings;
}

/**
 * Scan every installed space's `hooks/*.ts` (`<projectRoot>/spaces/<id>/hooks/`)
 * for `webhook`-type hooks and return one {@link WebhookBinding} per hook. Space
 * hooks are store-downloaded code, so {@link loadSpaceHooks} extracts each def in
 * a worker (never in-proc). A space whose hooks fail to load is skipped — same
 * fail-soft-per-space posture as {@link scanSpaceTriggers}.
 */
async function scanSpaceHookWebhooks(root: string, projectId: string): Promise<WebhookBinding[]> {
  const bindings: WebhookBinding[] = [];
  const spaceDirs = await listProjectSpaceDirs(root, projectId);
  const projectRoot = join(root, projectId);
  for (const dir of spaceDirs) {
    const spaceId = basename(dir);
    let hooks: LoadedHook[];
    try {
      hooks = await loadSpaceHooks(projectRoot, spaceId);
    } catch {
      continue;
    }
    for (const h of hooks) {
      if (h.def.type !== 'webhook') continue;
      const def = h.def as WebhookHookDef;
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
 * Build the webhook manifest across `projects` from disk — project-app
 * `hooks/*.ts` webhook defs, SPACE `hooks/*.ts` webhook defs, AND space-agent
 * `triggers:` frontmatter. A
 * project whose hooks fail to load, or a space that fails to load, is
 * skipped. Fail-loud on a duplicate `path` across ANY two bindings — hook or
 * space-trigger, same or different project — since a webhook path must be
 * globally unique on this pod (the gateway routes on `path` alone and cannot
 * otherwise disambiguate the target).
 */
export async function buildWebhookManifest(root: string, projects: string[]): Promise<WebhookBinding[]> {
  const bindings: WebhookBinding[] = [];
  for (const projectId of projects) {
    const projectRoot = join(root, projectId);
    let loaded: LoadedHook[];
    try {
      loaded = await loadHooks(projectRoot);
    } catch {
      loaded = [];
    }
    const webhookHooks = loaded.filter((h) => h.def.type === 'webhook');
    for (const h of webhookHooks) {
      const def = h.def as WebhookHookDef;
      bindings.push({
        projectId,
        path: def.path,
        provider: def.provider ?? 'generic',
        agentRef: def.trigger,
      });
    }
    bindings.push(...(await scanSpaceHookWebhooks(root, projectId)));
    bindings.push(...(await scanSpaceTriggers(root, projectId)));
  }

  const ownerByPath = new Map<string, { projectId: string; agentRef: string }>();
  for (const binding of bindings) {
    const owner = ownerByPath.get(binding.path);
    if (owner !== undefined && owner.projectId !== binding.projectId) {
      throw new Error(
        `[webhook-manifest] duplicate webhook path "${binding.path}": owned by project "${owner.projectId}" (${owner.agentRef}) and project "${binding.projectId}" (${binding.agentRef}) — paths must be globally unique per pod`,
      );
    }
    ownerByPath.set(binding.path, { projectId: binding.projectId, agentRef: binding.agentRef });
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
 * Find the binding for `path` (across all `projects`) and resolve it into
 * what the inbound dispatcher needs to run it. Checks project-app webhook
 * hooks first (cheap, no space loading), then falls back to space-agent
 * `triggers:` frontmatter. Returns `null` when neither declares that `path`.
 * (`buildWebhookManifest` already fails loud at boot on a path colliding
 * across the two kinds, so in practice they never both match.)
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

  for (const projectId of projects) {
    const spaceHookBindings = await scanSpaceHookWebhooks(root, projectId);
    const hookHit = spaceHookBindings.find((b) => b.path === path);
    if (hookHit) {
      return { projectId, agentRef: hookHit.agentRef, provider: hookHit.provider, budget: undefined };
    }
    const spaceBindings = await scanSpaceTriggers(root, projectId);
    const hit = spaceBindings.find((b) => b.path === path);
    if (hit) {
      return {
        projectId,
        agentRef: hit.agentRef,
        provider: hit.provider,
        budget: undefined,
      };
    }
  }

  return null;
}
