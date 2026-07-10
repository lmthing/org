import type { ConnectionResolver, ConnectionRequest, ConnectionResponse } from '@lmthing/core';
import { createHmac, randomBytes } from 'node:crypto';
import type { AuthStyle, ProviderConfig } from './providers/types.js';
import { scanIntegrationDescriptors } from './integration-manifests.js';

/**
 * Pod-side resolver for the agent/space `callConnection(provider, req)` global.
 *
 * BRING-YOUR-OWN-TOKEN model: the user configures their OWN provider token in
 * the pod env (Settings → Integrations) — lmthing does NOT broker OAuth or store
 * refresh tokens. This resolver looks the token up in `process.env` by the
 * provider's `tokenEnv`, host-pins the request to the provider `apiBase`, applies
 * the provider's auth style, and makes the REST call DIRECTLY. No gateway round-trip.
 *
 * SELF-CONTAINED PROVIDERS: only the three built-ins (slack/github/google) are
 * hard-coded here. Every messaging integration declares its own provider config
 * (`apiBase`, `tokenEnv`, `auth`) in its SPACE's `package.json` `lmthing.connection`
 * block — the resolver discovers it by scanning the session's installed spaces
 * ({@link scanIntegrationDescriptors}). Adding a platform is a new space folder,
 * no edit here.
 *
 * Errors are thrown (never silently binding undefined) so the yield router
 * surfaces them to the agent: an unknown provider, or a provider whose token env
 * var is unset ("not configured — set <TOKEN_ENV> in Settings → Integrations").
 *
 * Uses non-blocking `fetch` with an AbortSignal timeout so a slow provider can't
 * stall the session server's event loop / trip the idle watchdog.
 */

const CALL_TIMEOUT_MS = 25_000;

/**
 * Built-in providers (Bearer, constant base). `apiBase` mirrors the old gateway
 * connections-registry so existing `integration-*` spaces (relative paths like
 * `/chat.postMessage`) keep working unchanged. All OTHER providers come from
 * installed integration spaces' `lmthing.connection` descriptors.
 */
const BUILTIN_PROVIDERS: Record<string, ProviderConfig> = {
  slack: { apiBase: 'https://slack.com/api', tokenEnv: 'SLACK_BOT_TOKEN', auth: { kind: 'bearer' } },
  github: { apiBase: 'https://api.github.com', tokenEnv: 'GITHUB_TOKEN', auth: { kind: 'bearer' } },
  google: { apiBase: 'https://www.googleapis.com', tokenEnv: 'GOOGLE_ACCESS_TOKEN', auth: { kind: 'bearer' } },
};

/** The always-available built-in providers. Installed integration spaces add
 *  more per-project (discovered dynamically), so this is not the full set for a
 *  given session — see {@link createConnectionResolver}'s per-project support list. */
export const SUPPORTED_CONNECTION_PROVIDERS = Object.keys(BUILTIN_PROVIDERS);

/** Thrown for a misconfigured provider (unset token / base / basic-username env). */
class NotConfiguredError extends Error {}

/**
 * Resolve a provider id to its config: a built-in, else an installed space's
 * `lmthing.connection` descriptor scanned from `<projectRoot>/spaces/`. Returns
 * undefined for an unknown provider (the caller throws with the supported list).
 */
function resolveProviderConfig(provider: string, projectRoot: string | undefined): ProviderConfig | undefined {
  const builtin = BUILTIN_PROVIDERS[provider];
  if (builtin) return builtin;
  if (projectRoot) {
    const fromSpace = scanIntegrationDescriptors(projectRoot).connections[provider];
    if (fromSpace) return fromSpace;
  }
  return undefined;
}

/** The providers callable in this project context (built-ins + installed spaces). */
function supportedProviders(projectRoot: string | undefined): string[] {
  const ids = new Set(Object.keys(BUILTIN_PROVIDERS));
  if (projectRoot) for (const id of Object.keys(scanIntegrationDescriptors(projectRoot).connections)) ids.add(id);
  return [...ids].sort();
}

/** Read a required env var or throw the standard "not configured" guidance. */
function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new NotConfiguredError(`not configured — set ${name} in Settings → Integrations`);
  return v;
}

/**
 * Resolve `cfg.apiBase` to a concrete base URL:
 * - `{ env, suffix }` → `process.env[env]` (required) + suffix (self-hosted servers).
 * - a string, with `{token}` → the token value and `{env:VAR}` → `process.env[VAR]` (required).
 * Trailing slashes are stripped.
 */
function resolveApiBase(cfg: ProviderConfig, token: string): string {
  let base: string;
  if (typeof cfg.apiBase === 'object') {
    base = requireEnv(cfg.apiBase.env) + (cfg.apiBase.suffix ?? '');
  } else {
    base = cfg.apiBase
      .replace('{token}', token)
      .replace(/\{env:([A-Z0-9_]+)\}/g, (_m, name: string) => requireEnv(name));
  }
  return base.replace(/\/+$/, '');
}

/** Attach the provider's auth to `headers`/`query`, given the raw serialized body. */
function applyAuth(
  auth: AuthStyle,
  token: string,
  headers: Record<string, string>,
  query: Record<string, string>,
  body: string | undefined,
): void {
  switch (auth.kind) {
    case 'bearer':
      headers['Authorization'] = `Bearer ${token}`;
      break;
    case 'bot':
      headers['Authorization'] = `Bot ${token}`;
      break;
    case 'basic': {
      const user = requireEnv(auth.userEnv);
      headers['Authorization'] = `Basic ${Buffer.from(`${user}:${token}`).toString('base64')}`;
      break;
    }
    case 'query-token':
      query[auth.param] = token;
      break;
    case 'nextcloud-bot': {
      // Nextcloud Talk bot requests are HMAC-signed over `random + signedContent`,
      // where signedContent is the message/reaction the bot is posting (Nextcloud
      // signs the content, not the whole envelope). Fall back to the raw body.
      const random = randomBytes(32).toString('hex');
      let signed = body ?? '';
      try {
        const parsed = body ? (JSON.parse(body) as Record<string, unknown>) : {};
        if (typeof parsed['message'] === 'string') signed = parsed['message'];
        else if (typeof parsed['reaction'] === 'string') signed = parsed['reaction'];
      } catch {
        /* non-JSON body — sign it verbatim */
      }
      headers['X-Nextcloud-Talk-Bot-Random'] = random;
      headers['X-Nextcloud-Talk-Bot-Signature'] = createHmac('sha256', token)
        .update(random + signed)
        .digest('hex');
      break;
    }
    case 'none':
      break;
  }
}

async function callProvider(cfg: ProviderConfig, token: string, req: ConnectionRequest): Promise<Response> {
  const path = req.path ?? '';
  // Host-pinning: `path` is sandbox-supplied, so it MUST be relative to the
  // provider apiBase — reject absolute URLs / scheme / protocol-relative so an
  // agent can't redirect the credential to an attacker-controlled host.
  if (/^https?:\/\//i.test(path) || path.includes('://') || path.startsWith('//')) {
    throw new Error('callConnection: path must be relative to the provider apiBase');
  }
  const base = resolveApiBase(cfg, token);
  const rel = path.startsWith('/') ? path : `/${path}`;

  const headers: Record<string, string> = { Accept: 'application/json', 'User-Agent': 'lmthing-pod' };
  if (req.headers) {
    for (const [k, v] of Object.entries(req.headers)) {
      const lk = k.toLowerCase();
      if (lk === 'authorization' || lk === 'host') continue;
      headers[k] = v;
    }
  }

  const method = (req.method || 'GET').toUpperCase();
  let body: string | undefined;
  if (req.body !== undefined && method !== 'GET' && method !== 'HEAD') {
    body = typeof req.body === 'string' ? req.body : JSON.stringify(req.body);
    if (!Object.keys(headers).some((h) => h.toLowerCase() === 'content-type')) {
      headers['Content-Type'] = 'application/json';
    }
  }

  // Auth may add a query param (query-token) — merge with the caller's query.
  const query: Record<string, string> = { ...(req.query ?? {}) };
  applyAuth(cfg.auth ?? { kind: 'bearer' }, token, headers, query, body);

  let url = `${base}${rel}`;
  if (Object.keys(query).length > 0) {
    url += (url.includes('?') ? '&' : '?') + new URLSearchParams(query).toString();
  }

  return fetch(url, { method, headers, body, signal: AbortSignal.timeout(CALL_TIMEOUT_MS) });
}

/**
 * Build a `callConnection` resolver bound to `projectRoot` (the session's
 * project on disk). Built-in providers work everywhere; installed integration
 * spaces under `<projectRoot>/spaces/` contribute their own providers. Pass no
 * `projectRoot` (legacy/project-less sessions) to expose only the built-ins.
 */
export function createConnectionResolver(projectRoot?: string): ConnectionResolver {
  return async (provider: string, req: ConnectionRequest): Promise<ConnectionResponse> => {
    const cfg = resolveProviderConfig(provider, projectRoot);
    if (!cfg) {
      throw new Error(
        `callConnection("${provider}"): unknown provider (supported: ${supportedProviders(projectRoot).join(', ')})`,
      );
    }
    const token = process.env[cfg.tokenEnv];
    if (!token) {
      throw new Error(
        `callConnection("${provider}"): not configured — set ${cfg.tokenEnv} in Settings → Integrations`,
      );
    }

    let res: Response;
    try {
      res = await callProvider(cfg, token, req);
    } catch (err) {
      if (err instanceof NotConfiguredError) {
        throw new Error(`callConnection("${provider}"): ${err.message}`);
      }
      throw new Error(`callConnection("${provider}"): request failed: ${String((err as Error)?.message ?? err)}`);
    }

    const text = await res.text().catch(() => '');
    let data: unknown = null;
    if (text) {
      try {
        data = JSON.parse(text);
      } catch {
        data = text;
      }
    }
    return { ok: res.ok, status: res.status, data };
  };
}
