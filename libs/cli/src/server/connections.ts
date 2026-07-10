import type { ConnectionResolver, ConnectionRequest, ConnectionResponse } from '@lmthing/core';
import { createHmac, randomBytes } from 'node:crypto';
import { isIP } from 'node:net';
import { lookup } from 'node:dns/promises';
import { lookup as dnsLookupCb } from 'node:dns';
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

/** Thrown when a resolved provider base URL points at an internal/loopback host
 *  — an SSRF guard so a space's `apiBase` can't turn the pod into a proxy for
 *  cloud-metadata / cluster-internal services (litellm, gateway, 169.254.169.254…). */
class BlockedHostError extends Error {}

/** Is `ip` in a private / loopback / link-local range (IPv4 or IPv6)? Malformed
 *  input is treated as blocked (fail-closed). */
function isPrivateIp(ip: string): boolean {
  const fam = isIP(ip);
  if (fam === 4) {
    const p = ip.split('.').map((n) => Number(n));
    if (p.length !== 4 || p.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return true;
    const [a, b] = p as [number, number, number, number];
    if (a === 0 || a === 10 || a === 127) return true; // this-host / private / loopback
    if (a === 169 && b === 254) return true; // link-local incl. 169.254.169.254 metadata
    if (a === 172 && b >= 16 && b <= 31) return true; // private
    if (a === 192 && b === 168) return true; // private
    if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT 100.64/10
    return false;
  }
  if (fam === 6) {
    const h = ip.toLowerCase();
    if (h === '::1' || h === '::') return true; // loopback / unspecified
    if (h.startsWith('fe80')) return true; // link-local
    if (h.startsWith('fc') || h.startsWith('fd')) return true; // unique-local fc00::/7
    if (h.startsWith('::ffff:')) return isPrivateIp(h.slice(7)); // IPv4-mapped
    return false;
  }
  return false; // not an IP literal — handled by the hostname checks in isBlockedHost
}

/** Reject internal hosts: loopback/private/link-local IPs, single-label names
 *  (cluster services like `litellm`/`gateway`), and internal TLDs. */
function isBlockedHost(host: string): boolean {
  const h = host.toLowerCase().replace(/^\[|\]$/g, ''); // strip IPv6 brackets
  if (h === 'localhost' || h.endsWith('.localhost')) return true;
  if (h.endsWith('.local') || h.endsWith('.internal') || h.endsWith('.svc') || h.endsWith('.cluster.local')) return true;
  const isIpLiteral = isIP(h) !== 0;
  if (!isIpLiteral && !h.includes('.')) return true; // bare hostname ⇒ cluster-internal
  return isPrivateIp(h);
}

/** Guard a resolved base URL before any request: http(s) only, no internal host. */
function assertSafeBaseUrl(base: string): void {
  let u: URL;
  try {
    u = new URL(base);
  } catch {
    throw new BlockedHostError('provider base URL is not a valid absolute URL');
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') {
    throw new BlockedHostError(`provider base URL scheme "${u.protocol}" is not allowed`);
  }
  // Per-pod opt-out for local dev / a self-hosted provider on a private network
  // the pod can legitimately reach. Only ever weakens the pod whose OWN env sets
  // it (never cross-user), so it's a safe escape hatch.
  if (process.env['LMTHING_ALLOW_INTERNAL_CONNECTIONS'] === '1') return;
  if (isBlockedHost(u.hostname)) {
    throw new BlockedHostError(`provider base host "${u.hostname}" is internal/blocked`);
  }
}

/** DNS-rebinding guard: resolve the hostname and reject if ANY resolved address
 *  is internal — the static host check in {@link assertSafeBaseUrl} can't see a
 *  PUBLIC name that resolves to a private IP. (Residual: a TOCTOU race with a
 *  fast-rebinding TTL between this lookup and fetch's own; full closure needs
 *  connection-time IP pinning.) IP literals are already covered statically. */
async function assertResolvedHostSafe(hostname: string): Promise<void> {
  if (process.env['LMTHING_ALLOW_INTERNAL_CONNECTIONS'] === '1') return;
  const h = hostname.replace(/^\[|\]$/g, '');
  if (isIP(h) !== 0) return; // IP literal — already checked in assertSafeBaseUrl
  let addrs: Array<{ address: string }>;
  try {
    addrs = await lookup(h, { all: true });
  } catch {
    return; // DNS failure — let fetch surface the network error
  }
  for (const a of addrs) {
    if (isPrivateIp(a.address)) {
      throw new BlockedHostError(`provider host "${hostname}" resolves to internal address ${a.address}`);
    }
  }
}

/**
 * A DNS `lookup` that rejects any resolved internal IP — used as the undici
 * dispatcher's connect lookup so the address we VALIDATE is the exact address the
 * socket CONNECTS to (closing the resolve-vs-connect TOCTOU that a plain pre-check
 * can't). Mirrors `net.LookupFunction`; supports both `all` shapes.
 */
function pinnedLookup(
  hostname: string,
  options: unknown,
  cb: (err: Error | null, address?: unknown, family?: number) => void,
): void {
  dnsLookupCb(hostname, (options ?? {}) as never, (err, address, family) => {
    if (err) return cb(err, address as unknown, family);
    const list = Array.isArray(address) ? address : [{ address: address as string, family }];
    for (const item of list) {
      if (isPrivateIp((item as { address: string }).address)) {
        return cb(new BlockedHostError(`host "${hostname}" resolves to internal address ${(item as { address: string }).address}`));
      }
    }
    cb(null, address as unknown, family);
  });
}

/** Lazily build an undici dispatcher that pins connections to a validated public
 *  IP. If undici isn't resolvable (or the opt-out is set) returns undefined and
 *  the caller falls back to plain `fetch` — the pinning is a hardening ENHANCEMENT
 *  that can never break a normal call. Memoized (attempted once). */
let dispatcherResolved = false;
let pinnedDispatcher: unknown;
async function getPinnedDispatcher(): Promise<unknown> {
  if (dispatcherResolved) return pinnedDispatcher;
  dispatcherResolved = true;
  if (process.env['LMTHING_ALLOW_INTERNAL_CONNECTIONS'] === '1') return undefined;
  try {
    const undici = (await import('undici')) as { Agent: new (opts: unknown) => unknown };
    pinnedDispatcher = new undici.Agent({ connect: { lookup: pinnedLookup } });
  } catch {
    pinnedDispatcher = undefined; // undici not available → plain fetch + the resolve pre-check
  }
  return pinnedDispatcher;
}

/** Redact a secret's literal value from an error string before surfacing it to
 *  the agent/logs — token-in-path providers (e.g. Telegram `…/bot<token>/…`) can
 *  otherwise leak the token via a fetch error message that echoes the URL. */
function redactSecret(message: string, secret: string | undefined): string {
  if (!secret || secret.length < 4) return message;
  return message.split(secret).join('***');
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
  base = base.replace(/\/+$/, '');
  assertSafeBaseUrl(base);
  return base;
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

  await assertResolvedHostSafe(new URL(base).hostname);
  const dispatcher = await getPinnedDispatcher();
  const init: RequestInit & { dispatcher?: unknown } = {
    method,
    headers,
    body,
    signal: AbortSignal.timeout(CALL_TIMEOUT_MS),
  };
  if (dispatcher) init.dispatcher = dispatcher; // pin to the validated IP when undici is available
  return fetch(url, init);
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
      if (err instanceof BlockedHostError) {
        throw new Error(`callConnection("${provider}"): blocked — ${err.message}`);
      }
      const msg = redactSecret(String((err as Error)?.message ?? err), token);
      throw new Error(`callConnection("${provider}"): request failed: ${msg}`);
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
