import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createHmac, generateKeyPairSync, sign as edSign } from 'node:crypto';
import {
  buildAdapterFromDescriptor,
  getAdapter,
  resolveWebhookSecret,
  resolveChallenge,
} from './webhook-verifiers.js';
import type { WebhookDescriptor } from './webhook-descriptor.js';

/**
 * The generic, descriptor-driven inbound verifier. Proves every `verify` spec a
 * self-contained integration space can declare — with NO per-provider pod code:
 * a space carries the spec, the pod interprets it. Signatures are computed here
 * with the same primitives so accept/reject paths are exercised for real.
 */

const ORIG_ENV = { ...process.env };
afterEach(() => {
  process.env = { ...ORIG_ENV };
});

function adapterFor(verify: WebhookDescriptor['verify'], extra: Partial<WebhookDescriptor> = {}) {
  return buildAdapterFromDescriptor({ provider: 'x', verify, ...extra });
}

describe('verify: header-equals (Telegram)', () => {
  const a = adapterFor({ type: 'header-equals', header: 'x-telegram-bot-api-secret-token' });
  it('accepts a matching header', () => {
    expect(a.verify('{}', { 'x-telegram-bot-api-secret-token': 'sekret' }, 'sekret')).toBe(true);
  });
  it('rejects a mismatch / missing header / missing secret', () => {
    expect(a.verify('{}', { 'x-telegram-bot-api-secret-token': 'nope' }, 'sekret')).toBe(false);
    expect(a.verify('{}', {}, 'sekret')).toBe(false);
    expect(a.verify('{}', { 'x-telegram-bot-api-secret-token': 'sekret' }, undefined)).toBe(false);
  });
  it('requiresSecret is true for a non-none spec', () => {
    expect(a.requiresSecret).toBe(true);
  });
});

describe('verify: body-token (Mattermost/Synology)', () => {
  it('form body', () => {
    const a = adapterFor({ type: 'body-token', field: 'token', bodyType: 'form' });
    expect(a.verify('token=abc&text=hi', {}, 'abc')).toBe(true);
    expect(a.verify('token=zzz&text=hi', {}, 'abc')).toBe(false);
  });
  it('json body', () => {
    const a = adapterFor({ type: 'body-token', field: 'token', bodyType: 'json' });
    expect(a.verify('{"token":"abc"}', {}, 'abc')).toBe(true);
  });
  it('auto body (json or form)', () => {
    const a = adapterFor({ type: 'body-token', field: 'token', bodyType: 'auto' });
    expect(a.verify('{"token":"abc"}', {}, 'abc')).toBe(true);
    expect(a.verify('token=abc', {}, 'abc')).toBe(true);
  });
});

describe('verify: hmac (LINE base64 / WhatsApp hex+prefix / Nextcloud signed-parts)', () => {
  it('LINE — base64 HMAC-SHA256 over body', () => {
    const a = adapterFor({ type: 'hmac', algo: 'sha256', encoding: 'base64', header: 'x-line-signature' });
    const body = '{"events":[]}';
    const sig = createHmac('sha256', 'chan-secret').update(body, 'utf8').digest('base64');
    expect(a.verify(body, { 'x-line-signature': sig }, 'chan-secret')).toBe(true);
    expect(a.verify(body, { 'x-line-signature': sig + 'x' }, 'chan-secret')).toBe(false);
  });
  it('WhatsApp — hex HMAC-SHA256 with sha256= prefix', () => {
    const a = adapterFor({
      type: 'hmac',
      algo: 'sha256',
      encoding: 'hex',
      header: 'x-hub-signature-256',
      prefix: 'sha256=',
    });
    const body = '{"entry":[]}';
    const sig = 'sha256=' + createHmac('sha256', 'app-secret').update(body, 'utf8').digest('hex');
    expect(a.verify(body, { 'x-hub-signature-256': sig }, 'app-secret')).toBe(true);
    expect(a.verify(body, { 'x-hub-signature-256': sig.replace('sha256=', '') }, 'app-secret')).toBe(false);
  });
  it('Nextcloud — hex HMAC over (random header + body)', () => {
    const a = adapterFor({
      type: 'hmac',
      algo: 'sha256',
      encoding: 'hex',
      header: 'x-nextcloud-talk-signature',
      signed: [{ header: 'x-nextcloud-talk-random' }, 'body'],
    });
    const body = '{"type":"Create"}';
    const random = 'r4nd0m';
    const sig = createHmac('sha256', 'bot-secret').update(random + body, 'utf8').digest('hex');
    const headers = { 'x-nextcloud-talk-signature': sig, 'x-nextcloud-talk-random': random };
    expect(a.verify(body, headers, 'bot-secret')).toBe(true);
    expect(a.verify(body, { ...headers, 'x-nextcloud-talk-random': 'other' }, 'bot-secret')).toBe(false);
  });
  it('hmac with skew window rejects a stale timestamp', () => {
    const a = adapterFor({
      type: 'hmac',
      algo: 'sha256',
      encoding: 'hex',
      header: 'x-sig',
      signed: [{ literal: 'v0:' }, { header: 'x-ts' }, { literal: ':' }, 'body'],
      skewHeader: 'x-ts',
      maxSkewSeconds: 300,
    });
    const now = Math.floor(Date.now() / 1000);
    const stale = String(now - 10_000);
    const body = 'hi';
    const sig = createHmac('sha256', 's').update(`v0:${stale}:${body}`, 'utf8').digest('hex');
    expect(a.verify(body, { 'x-sig': sig, 'x-ts': stale }, 's')).toBe(false); // stale ⇒ reject
    const fresh = String(now);
    const sig2 = createHmac('sha256', 's').update(`v0:${fresh}:${body}`, 'utf8').digest('hex');
    expect(a.verify(body, { 'x-sig': sig2, 'x-ts': fresh }, 's')).toBe(true);
  });
});

describe('verify: ed25519 (Discord)', () => {
  it('accepts a valid Ed25519 signature over timestamp + body', () => {
    const { publicKey, privateKey } = generateKeyPairSync('ed25519');
    const jwk = publicKey.export({ format: 'jwk' }) as { x: string };
    const pubHex = Buffer.from(jwk.x, 'base64url').toString('hex');
    const a = adapterFor({
      type: 'ed25519',
      sigHeader: 'x-signature-ed25519',
      tsHeader: 'x-signature-timestamp',
    });
    const ts = '1699999999';
    const body = '{"type":1}';
    const sig = edSign(null, Buffer.from(ts + body, 'utf8'), privateKey).toString('hex');
    expect(a.verify(body, { 'x-signature-ed25519': sig, 'x-signature-timestamp': ts }, pubHex)).toBe(true);
    expect(a.verify('{"type":2}', { 'x-signature-ed25519': sig, 'x-signature-timestamp': ts }, pubHex)).toBe(false);
  });
});

describe('verify: twilio (base64 HMAC-SHA1 over URL + sorted params)', () => {
  it('accepts when the forwarded URL + sorted params match', () => {
    const a = adapterFor({ type: 'twilio' });
    const url = 'https://lmthing.cloud/webhooks/sms';
    const params: Record<string, string> = { To: '+1999', From: '+1888', Body: 'hey' };
    const base = Object.keys(params).sort().reduce((acc, k) => acc + k + params[k], url);
    const sig = createHmac('sha1', 'auth-token').update(base, 'utf8').digest('base64');
    const body = new URLSearchParams(params).toString();
    const headers = { 'x-twilio-signature': sig, 'x-lmthing-inbound-url': url };
    expect(a.verify(body, headers, 'auth-token')).toBe(true);
    expect(a.verify(body, { ...headers, 'x-lmthing-inbound-url': url + '?x=1' }, 'auth-token')).toBe(false);
  });
  it('rejects when the forwarded URL header is missing', () => {
    const a = adapterFor({ type: 'twilio' });
    expect(a.verify('To=1', { 'x-twilio-signature': 'x' }, 'auth-token')).toBe(false);
  });
});

describe('verify: none', () => {
  it('always passes and does not require a secret', () => {
    const a = adapterFor({ type: 'none' });
    expect(a.requiresSecret).toBe(false);
    expect(a.verify('anything', {}, undefined)).toBe(true);
  });
});

describe('preflight (Discord PING → PONG)', () => {
  const a = adapterFor(
    { type: 'ed25519', sigHeader: 'x-signature-ed25519', tsHeader: 'x-signature-timestamp' },
    { preflight: { type: 'json-echo', when: { field: 'type', equals: 1 }, respond: { type: 1 } } },
  );
  it('answers a PING', () => {
    expect(a.preflight!('{"type":1}', {})).toEqual({ status: 200, body: { type: 1 } });
  });
  it('ignores a non-PING', () => {
    expect(a.preflight!('{"type":2}', {})).toBeNull();
  });
  it('respondEcho echoes a field back', () => {
    const b = adapterFor(
      { type: 'none' },
      { preflight: { type: 'json-echo', when: { field: 'type', equals: 'url_verification' }, respondEcho: { field: 'challenge' } } },
    );
    expect(b.preflight!('{"type":"url_verification","challenge":"abc123"}', {})).toEqual({
      status: 200,
      body: { challenge: 'abc123' },
    });
  });
});

describe('extractThread', () => {
  it('body dotted path with prefix (Telegram chat id)', () => {
    const a = adapterFor(
      { type: 'none' },
      { thread: { from: 'body', path: 'message.chat.id', prefix: 'telegram' } },
    );
    expect(a.extractThread('{"message":{"chat":{"id":12345}}}', {})).toBe('telegram:12345');
    expect(a.extractThread('{"message":{}}', {})).toBeNull();
  });
  it('form field (Synology user)', () => {
    const a = adapterFor({ type: 'none' }, { thread: { from: 'form', field: 'user_id', prefix: 'synology' } });
    expect(a.extractThread('user_id=42&text=hi', {})).toBe('synology:42');
  });
  it('one-shot when no thread spec', () => {
    expect(adapterFor({ type: 'none' }).extractThread('{}', {})).toBeNull();
  });
});

describe('renderMessage passthrough', () => {
  it('embeds the raw body + an inbound-context line for the handler agent', () => {
    const a = adapterFor({ type: 'none' });
    const msg = a.renderMessage('telegram', '{"message":{"text":"hi"}}', {});
    expect(msg).toContain('{"message":{"text":"hi"}}');
    expect(msg).toContain('[inbound-context] {"provider":"x","path":"telegram"}');
  });
});

describe('resolveWebhookSecret', () => {
  it('prefers a per-path override, then the descriptor secretEnv', () => {
    const desc: WebhookDescriptor = { provider: 'telegram', secretEnv: 'TG_SECRET', verify: { type: 'none' } };
    process.env.TG_SECRET = 'from-descriptor';
    expect(resolveWebhookSecret('telegram', 'telegram', desc)).toBe('from-descriptor');
    process.env.LMTHING_WEBHOOK_SECRET_TELEGRAM = 'per-path';
    expect(resolveWebhookSecret('telegram', 'telegram', desc)).toBe('per-path');
  });
  it('returns undefined with no descriptor and no built-in env', () => {
    expect(resolveWebhookSecret('nope', 'nope')).toBeUndefined();
  });
});

describe('resolveChallenge (WhatsApp GET hub.challenge)', () => {
  const desc: WebhookDescriptor = {
    provider: 'whatsapp',
    verify: { type: 'hmac', algo: 'sha256', encoding: 'hex', header: 'x-hub-signature-256', prefix: 'sha256=' },
    challenge: { type: 'hub-challenge', verifyTokenEnv: 'WA_VERIFY' },
  };
  beforeEach(() => {
    process.env.WA_VERIFY = 'my-verify-token';
  });
  it('echoes the challenge when the verify token matches', () => {
    const q = new URLSearchParams({ 'hub.mode': 'subscribe', 'hub.verify_token': 'my-verify-token', 'hub.challenge': 'CHALLENGE_123' });
    expect(resolveChallenge(desc, q)).toEqual({ status: 200, body: 'CHALLENGE_123' });
  });
  it('rejects a wrong verify token', () => {
    const q = new URLSearchParams({ 'hub.verify_token': 'wrong', 'hub.challenge': 'X' });
    expect(resolveChallenge(desc, q)).toBeNull();
  });
  it('null when the descriptor has no challenge spec', () => {
    expect(resolveChallenge({ provider: 'x', verify: { type: 'none' } }, new URLSearchParams())).toBeNull();
  });
});

describe('getAdapter descriptor precedence', () => {
  it('a descriptor wins over the built-in map', () => {
    const desc: WebhookDescriptor = { provider: 'slack', verify: { type: 'none' } };
    const a = getAdapter('slack', desc);
    // The descriptor-built adapter uses passthrough render, not the built-in slack one.
    expect(a.renderMessage('slack', '{}', {})).toContain('[inbound-context]');
  });
});
