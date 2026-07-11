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
import { scanEmitterDefs, type EmitterScanResult } from './emitter-manifests.js';

/** One inbound-webhook binding in the published manifest. */
export interface WebhookBinding {
  projectId: string;
  /** URL-safe path segment — globally unique per pod (the routing key). */
  path: string;
  /** Verifier/adapter id (defaults to 'generic'; `'emitter'` for a webhook
   *  emitter def, whose verify is carried by the def itself). */
  provider: string;
  /** `space/agent#action` to run for each event (the hook's `trigger`), or — for
   *  an emitter binding — the marker `<scope>/<defName>` (no agent trigger). */
  agentRef: string;
  /** The binding SOURCE: a legacy `triggers:`/webhook-hook binding, or a WEBHOOK
   *  EMITTER DEF (`events/*.ts`, the S4 producer side). Absent ⇒ `'legacy'`. */
  kind?: 'legacy' | 'emitter';
}

/**
 * What {@link resolveBinding} hands the inbound dispatcher. A LEGACY binding runs
 * one agent `trigger`; an EMITTER binding drives the S5 emitter pipeline (verify →
 * pure `emit(inbound)` → typed events → subscribing event hooks). The two flows in
 * `routes/webhooks.ts` branch on `kind`.
 */
export type ResolvedBinding =
  | { kind: 'legacy'; projectId: string; agentRef: string; provider: string; budget?: unknown }
  | { kind: 'emitter'; projectId: string; scope: string; defFile: string; defName: string };

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
 * Scan a project's WEBHOOK EMITTER DEFS (`events/*.ts` of type `webhook`, across
 * the project + every space scope — {@link scanEmitterDefs}, S4) and return one
 * {@link WebhookBinding} per def. These are the PRODUCER side of the event
 * pipeline: each claims its own `path`, so it participates in the same global
 * path-uniqueness check as legacy bindings. The scan is worker-isolated and
 * fail-soft-per-project (a scan error skips the project, mirroring the hook loop).
 */
async function scanEmitterWebhookBindings(root: string, projectId: string): Promise<WebhookBinding[]> {
  const bindings: WebhookBinding[] = [];
  let result: EmitterScanResult;
  try {
    result = await scanEmitterDefs(root, projectId);
  } catch {
    return bindings;
  }
  for (const [scope, s] of Object.entries(result.scopes)) {
    for (const d of s.defs) {
      if (d.def.type !== 'webhook') continue;
      bindings.push({
        projectId,
        path: d.def.path,
        provider: 'emitter',
        agentRef: `${scope}/${d.name}`, // marker only — an emitter has no agent trigger
        kind: 'emitter',
      });
    }
  }
  return bindings;
}

/**
 * Build the webhook manifest across `projects` from disk — project-app
 * `hooks/*.ts` webhook defs, SPACE `hooks/*.ts` webhook defs, space-agent
 * `triggers:` frontmatter, AND WEBHOOK EMITTER DEFS (`events/*.ts`). A project
 * whose hooks fail to load, or a space that fails to load, is skipped. Fail-loud
 * on a duplicate `path` — since a webhook path must be globally unique on this
 * pod (the gateway routes on `path` alone and cannot otherwise disambiguate the
 * target).
 *
 * Collision policy: an EMITTER def's path colliding with ANY other binding (a
 * legacy trigger/hook OR another emitter), in the SAME or a different project, is
 * FATAL. NO-BACK-COMPAT: we deliberately do NOT build a same-path sharing
 * relaxation — S15's space migration removes the legacy binding a migrated
 * space's emitter supersedes, so a live emitter-vs-legacy collision is a bug, not
 * a config to reconcile. Two LEGACY bindings keep the prior rule (cross-project
 * fatal; same-project sharing tolerated until S15).
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
    bindings.push(...(await scanEmitterWebhookBindings(root, projectId)));
  }

  const ownerByPath = new Map<string, { projectId: string; agentRef: string; kind: 'legacy' | 'emitter' }>();
  for (const binding of bindings) {
    const kind = binding.kind ?? 'legacy';
    const owner = ownerByPath.get(binding.path);
    if (owner !== undefined) {
      // Any emitter involved in a same-path collision (either side) is fatal, in
      // any project — emitter paths are strictly unique (no same-path sharing).
      if (kind === 'emitter' || owner.kind === 'emitter') {
        throw new Error(
          `[webhook-manifest] webhook path "${binding.path}" is claimed by an emitter def and another binding — ` +
            `"${owner.projectId}" (${owner.agentRef}) vs "${binding.projectId}" (${binding.agentRef}); ` +
            `emitter paths must be globally unique per pod (no same-path sharing)`,
        );
      }
      // Two legacy bindings: cross-project remains fatal (unchanged behavior).
      if (owner.projectId !== binding.projectId) {
        throw new Error(
          `[webhook-manifest] duplicate webhook path "${binding.path}": owned by project "${owner.projectId}" (${owner.agentRef}) and project "${binding.projectId}" (${binding.agentRef}) — paths must be globally unique per pod`,
        );
      }
    }
    ownerByPath.set(binding.path, { projectId: binding.projectId, agentRef: binding.agentRef, kind });
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
 * hooks first (cheap), then space-agent `triggers:` / space webhook hooks, then
 * WEBHOOK EMITTER DEFS. Returns `null` when nothing declares that `path`.
 * (`buildWebhookManifest` already fails loud at boot on a path colliding across
 * kinds, so at most one source ever matches a given `path`.)
 */
export async function resolveBinding(
  root: string,
  projects: string[],
  path: string,
): Promise<ResolvedBinding | null> {
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
        kind: 'legacy',
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
      return { kind: 'legacy', projectId, agentRef: hookHit.agentRef, provider: hookHit.provider, budget: undefined };
    }
    const spaceBindings = await scanSpaceTriggers(root, projectId);
    const hit = spaceBindings.find((b) => b.path === path);
    if (hit) {
      return { kind: 'legacy', projectId, agentRef: hit.agentRef, provider: hit.provider, budget: undefined };
    }
  }

  // WEBHOOK EMITTER DEFS (S4/S5) — resolve to a descriptor carrying the def file
  // (later re-loaded to run `emit` worker-isolated) + its owning scope + name.
  for (const projectId of projects) {
    let result: EmitterScanResult;
    try {
      result = await scanEmitterDefs(root, projectId);
    } catch {
      continue;
    }
    for (const [scope, s] of Object.entries(result.scopes)) {
      const hit = s.defs.find((d) => d.def.type === 'webhook' && (d.def as { path: string }).path === path);
      if (hit) {
        return { kind: 'emitter', projectId, scope, defFile: hit.file, defName: hit.name };
      }
    }
  }

  return null;
}
