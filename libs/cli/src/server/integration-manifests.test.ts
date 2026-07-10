import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { scanIntegrationDescriptors, clearIntegrationDescriptorCache } from './integration-manifests.js';
import { createConnectionResolver } from './connections.js';

/**
 * The scanner is the seam that makes messaging integrations SELF-CONTAINED: a
 * space carries `lmthing.connection` / `lmthing.webhook` blocks and the pod
 * discovers them from disk — no hard-coded per-provider registry. These tests
 * build a throwaway project tree and assert discovery, caching, and that the
 * connection resolver applies each declared auth style with ZERO pod edits.
 */

let root: string;

function writeSpace(id: string, lmthing: unknown): void {
  const dir = join(root, 'spaces', id);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: id, lmthing }, null, 2));
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'lm-integ-'));
  clearIntegrationDescriptorCache();
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
  clearIntegrationDescriptorCache();
});

describe('scanIntegrationDescriptors', () => {
  it('discovers connection + webhook descriptors keyed by provider', () => {
    writeSpace('integration-telegram', {
      kind: 'integration',
      connection: { provider: 'telegram', apiBase: 'https://api.telegram.org/bot{token}', tokenEnv: 'TG', auth: { kind: 'none' } },
      webhook: { provider: 'telegram', secretEnv: 'TG_SEC', verify: { type: 'header-equals', header: 'x-telegram-bot-api-secret-token' } },
    });
    const d = scanIntegrationDescriptors(root);
    expect(Object.keys(d.connections)).toEqual(['telegram']);
    expect(d.connections['telegram']!.tokenEnv).toBe('TG');
    expect(d.webhooks['telegram']!.secretEnv).toBe('TG_SEC');
  });

  it('skips a space with no lmthing block, a malformed package.json, or an incomplete descriptor', () => {
    writeSpace('integration-ok', {
      connection: { provider: 'ok', apiBase: 'https://ok.example', tokenEnv: 'OK' },
    });
    writeSpace('plain-space', { kind: 'space' }); // no connection/webhook
    writeSpace('bad-conn', { connection: { provider: 'bad' } }); // missing tokenEnv/apiBase
    // malformed package.json
    const bad = join(root, 'spaces', 'broken');
    mkdirSync(bad, { recursive: true });
    writeFileSync(join(bad, 'package.json'), '{ not json');
    const d = scanIntegrationDescriptors(root);
    expect(Object.keys(d.connections).sort()).toEqual(['ok']);
    expect(d.webhooks).toEqual({});
  });

  it('refreshes when a package.json changes (cache invalidation)', () => {
    writeSpace('integration-a', { connection: { provider: 'a', apiBase: 'https://a.example', tokenEnv: 'A' } });
    expect(Object.keys(scanIntegrationDescriptors(root).connections)).toEqual(['a']);
    // Install a second integration → the dir signature changes.
    writeSpace('integration-b', { connection: { provider: 'b', apiBase: 'https://b.example', tokenEnv: 'B' } });
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
      connection: { provider: 'discord', apiBase: 'https://discord.com/api/v10', tokenEnv: 'DISCORD_BOT_TOKEN', auth: { kind: 'bot' } },
    });
    process.env.DISCORD_BOT_TOKEN = 'bot-tok';
    const resolve = createConnectionResolver(root);
    await resolve('discord', { method: 'POST', path: '/channels/1/messages', body: { content: 'hi' } });
    expect(calls[0]!.url).toBe('https://discord.com/api/v10/channels/1/messages');
    expect(authHeader()).toBe('Bot bot-tok');
  });

  it('basic (Twilio) → Authorization: Basic base64(SID:token), {env:SID} in the base path', async () => {
    writeSpace('integration-sms', {
      connection: {
        provider: 'sms',
        apiBase: 'https://api.twilio.com/2010-04-01/Accounts/{env:TWILIO_ACCOUNT_SID}',
        tokenEnv: 'TWILIO_AUTH_TOKEN',
        auth: { kind: 'basic', userEnv: 'TWILIO_ACCOUNT_SID' },
      },
    });
    process.env.TWILIO_ACCOUNT_SID = 'AC123';
    process.env.TWILIO_AUTH_TOKEN = 'authtok';
    const resolve = createConnectionResolver(root);
    await resolve('sms', { method: 'POST', path: '/Messages.json', body: 'Body=hi' });
    expect(calls[0]!.url).toBe('https://api.twilio.com/2010-04-01/Accounts/AC123/Messages.json');
    expect(authHeader()).toBe('Basic ' + Buffer.from('AC123:authtok').toString('base64'));
  });

  it('query-token (Synology) → token appended as a query param, no auth header', async () => {
    writeSpace('integration-synology', {
      connection: {
        provider: 'synology',
        apiBase: { env: 'SYNOLOGY_CHAT_BASE_URL' },
        tokenEnv: 'SYNOLOGY_CHAT_TOKEN',
        auth: { kind: 'query-token', param: 'token' },
      },
    });
    process.env.SYNOLOGY_CHAT_BASE_URL = 'https://nas.example:5001';
    process.env.SYNOLOGY_CHAT_TOKEN = 'inc-tok';
    const resolve = createConnectionResolver(root);
    await resolve('synology', { method: 'POST', path: '/webapi/entry.cgi', query: { api: 'SYNO.Chat' } });
    expect(calls[0]!.url).toBe('https://nas.example:5001/webapi/entry.cgi?api=SYNO.Chat&token=inc-tok');
    expect(authHeader()).toBeUndefined();
  });

  it('path-token (Telegram) → token in the base path, auth:none', async () => {
    writeSpace('integration-telegram', {
      connection: { provider: 'telegram', apiBase: 'https://api.telegram.org/bot{token}', tokenEnv: 'TELEGRAM_BOT_TOKEN', auth: { kind: 'none' } },
    });
    process.env.TELEGRAM_BOT_TOKEN = '999:ABC';
    const resolve = createConnectionResolver(root);
    await resolve('telegram', { method: 'POST', path: '/sendMessage', body: { chat_id: 1, text: 'hi' } });
    expect(calls[0]!.url).toBe('https://api.telegram.org/bot999:ABC/sendMessage');
    expect(authHeader()).toBeUndefined();
  });

  it('env-resolved base with suffix (Mattermost)', async () => {
    writeSpace('integration-mattermost', {
      connection: { provider: 'mattermost', apiBase: { env: 'MATTERMOST_BASE_URL', suffix: '/api/v4' }, tokenEnv: 'MATTERMOST_TOKEN', auth: { kind: 'bearer' } },
    });
    process.env.MATTERMOST_BASE_URL = 'https://mm.example';
    process.env.MATTERMOST_TOKEN = 'mmtok';
    const resolve = createConnectionResolver(root);
    await resolve('mattermost', { method: 'POST', path: '/posts', body: { message: 'hi' } });
    expect(calls[0]!.url).toBe('https://mm.example/api/v4/posts');
    expect(authHeader()).toBe('Bearer mmtok');
  });

  it('nextcloud-bot → HMAC bot signature headers', async () => {
    writeSpace('integration-nextcloud', {
      connection: {
        provider: 'nextcloud',
        apiBase: { env: 'NEXTCLOUD_BASE_URL', suffix: '/ocs/v2.php/apps/spreed/api/v1' },
        tokenEnv: 'NEXTCLOUD_TALK_BOT_SECRET',
        auth: { kind: 'nextcloud-bot' },
      },
    });
    process.env.NEXTCLOUD_BASE_URL = 'https://nc.example';
    process.env.NEXTCLOUD_TALK_BOT_SECRET = 'nc-secret';
    const resolve = createConnectionResolver(root);
    await resolve('nextcloud', { method: 'POST', path: '/bot/room1/message', body: { message: 'hi' } });
    const h = calls[0]!.init!.headers as Record<string, string>;
    expect(h['X-Nextcloud-Talk-Bot-Random']).toMatch(/^[0-9a-f]{64}$/);
    expect(h['X-Nextcloud-Talk-Bot-Signature']).toMatch(/^[0-9a-f]{64}$/);
  });

  it('unknown provider lists the installed spaces in the error', async () => {
    writeSpace('integration-telegram', {
      connection: { provider: 'telegram', apiBase: 'https://api.telegram.org/bot{token}', tokenEnv: 'TELEGRAM_BOT_TOKEN', auth: { kind: 'none' } },
    });
    const resolve = createConnectionResolver(root);
    await expect(resolve('zoom', { method: 'GET', path: '/x' })).rejects.toThrow(/unknown provider.*telegram/s);
  });

  it('a project-less resolver exposes only the built-ins (no space providers)', async () => {
    const resolve = createConnectionResolver();
    await expect(resolve('telegram', { method: 'GET', path: '/x' })).rejects.toThrow(/unknown provider/);
  });
});
