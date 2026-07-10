/**
 * Scan a project's installed integration spaces for their declarative
 * `connection` / `webhook` descriptors.
 *
 * This is the single seam that makes messaging integrations SELF-CONTAINED: an
 * integration space (`<projectRoot>/spaces/<id>/package.json`) carries its own
 * `lmthing.connection` (how `callConnection` reaches the provider) and
 * `lmthing.webhook` (how the pod verifies an inbound event) blocks. The pod's
 * generic engines (`connections.ts`, `webhook-verifiers.ts`) read the map this
 * module builds instead of a hard-coded per-provider registry — so adding a new
 * platform is a new space folder, ZERO pod edits.
 *
 * Pure, defensive disk I/O: a missing dir, unreadable file, or malformed block
 * is skipped (never throws). Cached per `projectRoot`, invalidated when any
 * space's `package.json` mtime changes (so a fresh install is picked up without
 * a restart).
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type { ProviderConfig } from './providers/types.js';
import type { WebhookDescriptor } from './webhook-descriptor.js';

/** A space's `lmthing.connection` block: a {@link ProviderConfig} + its provider id. */
export interface ConnectionDescriptor extends ProviderConfig {
  provider: string;
}

export interface IntegrationDescriptors {
  /** provider id → outbound connection config. */
  connections: Record<string, ConnectionDescriptor>;
  /** provider id → inbound webhook config. */
  webhooks: Record<string, WebhookDescriptor>;
}

const EMPTY: IntegrationDescriptors = { connections: {}, webhooks: {} };

interface CacheEntry {
  signature: string;
  value: IntegrationDescriptors;
}
const cache = new Map<string, CacheEntry>();

/** Cheap change-signature: each space dir name + its package.json mtime. Bumps
 *  on install/uninstall AND on an edit to any package.json. */
function signature(spacesDir: string): string {
  let entries: import('node:fs').Dirent[];
  try {
    entries = readdirSync(spacesDir, { withFileTypes: true });
  } catch {
    return '';
  }
  const parts: string[] = [];
  for (const d of entries) {
    if (!d.isDirectory()) continue;
    try {
      const st = statSync(join(spacesDir, d.name, 'package.json'));
      parts.push(`${d.name}:${st.mtimeMs}`);
    } catch {
      /* no package.json in this space — not an integration, skip */
    }
  }
  return parts.sort().join('|');
}

/** Validate + normalise a raw `lmthing.connection` block. Returns undefined if
 *  it's missing required fields (provider/tokenEnv/apiBase). */
function parseConnection(raw: unknown): ConnectionDescriptor | undefined {
  if (raw === null || typeof raw !== 'object') return undefined;
  const c = raw as Record<string, unknown>;
  const provider = c['provider'];
  const tokenEnv = c['tokenEnv'];
  const apiBase = c['apiBase'];
  if (typeof provider !== 'string' || !provider) return undefined;
  if (typeof tokenEnv !== 'string' || !tokenEnv) return undefined;
  const apiBaseOk =
    typeof apiBase === 'string'
      ? apiBase.length > 0
      : apiBase !== null && typeof apiBase === 'object' && typeof (apiBase as Record<string, unknown>)['env'] === 'string';
  if (!apiBaseOk) return undefined;
  return {
    provider,
    tokenEnv,
    apiBase: apiBase as ConnectionDescriptor['apiBase'],
    auth: c['auth'] as ConnectionDescriptor['auth'],
  };
}

/** Validate a raw `lmthing.webhook` block. Returns undefined if it lacks a
 *  provider or a verify spec (the two fields the dispatcher must have). */
function parseWebhook(raw: unknown): WebhookDescriptor | undefined {
  if (raw === null || typeof raw !== 'object') return undefined;
  const w = raw as Record<string, unknown>;
  const provider = w['provider'];
  const verify = w['verify'];
  if (typeof provider !== 'string' || !provider) return undefined;
  if (verify === null || typeof verify !== 'object' || typeof (verify as Record<string, unknown>)['type'] !== 'string') {
    return undefined;
  }
  return {
    provider,
    secretEnv: typeof w['secretEnv'] === 'string' ? (w['secretEnv'] as string) : undefined,
    verify: verify as WebhookDescriptor['verify'],
    thread: w['thread'] as WebhookDescriptor['thread'],
    preflight: w['preflight'] as WebhookDescriptor['preflight'],
    challenge: w['challenge'] as WebhookDescriptor['challenge'],
  };
}

function scan(spacesDir: string): IntegrationDescriptors {
  const connections: Record<string, ConnectionDescriptor> = {};
  const webhooks: Record<string, WebhookDescriptor> = {};
  let entries: import('node:fs').Dirent[];
  try {
    entries = readdirSync(spacesDir, { withFileTypes: true });
  } catch {
    return EMPTY;
  }
  for (const d of entries) {
    if (!d.isDirectory()) continue;
    let block: Record<string, unknown> | undefined;
    try {
      const pkg = JSON.parse(readFileSync(join(spacesDir, d.name, 'package.json'), 'utf8')) as Record<string, unknown>;
      const lm = pkg['lmthing'];
      if (lm !== null && typeof lm === 'object') block = lm as Record<string, unknown>;
    } catch {
      continue; // no/invalid package.json
    }
    if (!block) continue;
    const conn = parseConnection(block['connection']);
    if (conn) connections[conn.provider] = conn;
    const wh = parseWebhook(block['webhook']);
    if (wh) webhooks[wh.provider] = wh;
  }
  return { connections, webhooks };
}

/**
 * Return the connection + webhook descriptors declared by every integration
 * space installed under `<projectRoot>/spaces/`. Cached per project, refreshed
 * when a package.json changes. Never throws.
 */
export function scanIntegrationDescriptors(projectRoot: string): IntegrationDescriptors {
  const spacesDir = join(projectRoot, 'spaces');
  const sig = signature(spacesDir);
  if (sig === '') return EMPTY;
  const hit = cache.get(projectRoot);
  if (hit && hit.signature === sig) return hit.value;
  const value = scan(spacesDir);
  cache.set(projectRoot, { signature: sig, value });
  return value;
}

/** Test seam — drop the memoised scans. */
export function clearIntegrationDescriptorCache(): void {
  cache.clear();
}
