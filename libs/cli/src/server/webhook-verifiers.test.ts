/**
 * Inbound-webhook Phase 4a (provider-verifier registry) — offline,
 * deterministic. Covers each adapter's `verify`/`extractThread`/
 * `renderMessage`/`preflight` in `WEBHOOK_ADAPTERS`, `getAdapter`'s fallback
 * to `generic`, and `resolveWebhookSecret`'s env precedence.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createHmac } from 'node:crypto';
import { getAdapter, resolveWebhookSecret, WEBHOOK_ADAPTERS } from './webhook-verifiers.js';

const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

describe('getAdapter', () => {
  it('returns the named adapter for known providers', () => {
    expect(getAdapter('generic')).toBe(WEBHOOK_ADAPTERS['generic']);
    expect(getAdapter('slack')).toBe(WEBHOOK_ADAPTERS['slack']);
    expect(getAdapter('github')).toBe(WEBHOOK_ADAPTERS['github']);
  });

  it('falls back to generic for an unknown provider', () => {
    expect(getAdapter('stripe')).toBe(WEBHOOK_ADAPTERS['generic']);
    expect(getAdapter('')).toBe(WEBHOOK_ADAPTERS['generic']);
  });
});

describe('generic adapter', () => {
  const adapter = getAdapter('generic');

  it('requiresSecret is false', () => {
    expect(adapter.requiresSecret).toBe(false);
  });

  it('verify passes with no secret configured', () => {
    expect(adapter.verify('{"a":1}', {}, undefined)).toBe(true);
  });

  it('verify passes with a correct HMAC signature', () => {
    const secret = 's3cr3t';
    const rawBody = '{"a":1}';
    const sig = 'sha256=' + createHmac('sha256', secret).update(rawBody, 'utf8').digest('hex');
    expect(adapter.verify(rawBody, { 'x-lmthing-signature': sig }, secret)).toBe(true);
  });

  it('verify fails with a tampered signature', () => {
    const secret = 's3cr3t';
    const rawBody = '{"a":1}';
    expect(adapter.verify(rawBody, { 'x-lmthing-signature': 'sha256=deadbeef' }, secret)).toBe(false);
  });

  it('verify fails when a secret is configured but no header is sent', () => {
    expect(adapter.verify('{"a":1}', {}, 's3cr3t')).toBe(false);
  });

  it('extractThread reads the x-lmthing-thread header first', () => {
    expect(adapter.extractThread('{}', { 'x-lmthing-thread': 'conv-1' })).toBe('conv-1');
  });

  it('extractThread falls back to a JSON threadKey/thread field', () => {
    expect(adapter.extractThread(JSON.stringify({ threadKey: 'k1' }), {})).toBe('k1');
    expect(adapter.extractThread(JSON.stringify({ thread: 'k2' }), {})).toBe('k2');
  });

  it('extractThread returns null with nothing to key on', () => {
    expect(adapter.extractThread('not json', {})).toBeNull();
    expect(adapter.extractThread('{}', {})).toBeNull();
  });

  it('renderMessage embeds the raw body and path', () => {
    const msg = adapter.renderMessage('lead', '{"a":1}', {});
    expect(msg).toContain('lead');
    expect(msg).toContain('{"a":1}');
  });

  it('has no preflight', () => {
    expect(adapter.preflight).toBeUndefined();
  });
});

describe('slack adapter', () => {
  const adapter = getAdapter('slack');
  const secret = 'slack-signing-secret';

  function sign(rawBody: string, timestamp: string): string {
    const basestring = `v0:${timestamp}:${rawBody}`;
    return 'v0=' + createHmac('sha256', secret).update(basestring, 'utf8').digest('hex');
  }

  it('requiresSecret is true', () => {
    expect(adapter.requiresSecret).toBe(true);
  });

  it('verify passes with a correctly computed signature', () => {
    const rawBody = JSON.stringify({ type: 'event_callback' });
    const timestamp = String(Math.floor(Date.now() / 1000));
    const sig = sign(rawBody, timestamp);
    expect(
      adapter.verify(rawBody, { 'x-slack-request-timestamp': timestamp, 'x-slack-signature': sig }, secret),
    ).toBe(true);
  });

  it('verify fails when the signature is tampered', () => {
    const rawBody = JSON.stringify({ type: 'event_callback' });
    const timestamp = String(Math.floor(Date.now() / 1000));
    const sig = sign(rawBody, timestamp);
    const tampered = sig.slice(0, -1) + (sig.endsWith('a') ? 'b' : 'a');
    expect(
      adapter.verify(rawBody, { 'x-slack-request-timestamp': timestamp, 'x-slack-signature': tampered }, secret),
    ).toBe(false);
  });

  it('verify fails without a secret', () => {
    const rawBody = '{}';
    const timestamp = String(Math.floor(Date.now() / 1000));
    expect(
      adapter.verify(rawBody, { 'x-slack-request-timestamp': timestamp, 'x-slack-signature': sign(rawBody, timestamp) }, undefined),
    ).toBe(false);
  });

  it('verify fails on a stale timestamp (replay guard)', () => {
    const rawBody = '{}';
    const staleTimestamp = String(Math.floor(Date.now() / 1000) - 10 * 60); // 10 min old
    const sig = sign(rawBody, staleTimestamp);
    expect(
      adapter.verify(rawBody, { 'x-slack-request-timestamp': staleTimestamp, 'x-slack-signature': sig }, secret),
    ).toBe(false);
  });

  it('verify fails when headers are missing', () => {
    expect(adapter.verify('{}', {}, secret)).toBe(false);
  });

  it('preflight answers url_verification with the challenge, unsigned check not required here', () => {
    const body = JSON.stringify({ type: 'url_verification', challenge: 'abc123' });
    expect(adapter.preflight?.(body, {})).toEqual({ status: 200, body: { challenge: 'abc123' } });
  });

  it('preflight returns null for a non-url_verification body', () => {
    const body = JSON.stringify({ type: 'event_callback' });
    expect(adapter.preflight?.(body, {})).toBeNull();
  });

  it('extractThread prefers thread_ts, then ts, then channel', () => {
    expect(adapter.extractThread(JSON.stringify({ event: { thread_ts: 't1', ts: 't2' } }), {})).toBe('t1');
    expect(adapter.extractThread(JSON.stringify({ event: { ts: 't2' } }), {})).toBe('t2');
    expect(adapter.extractThread(JSON.stringify({ event: { channel: 'c1' } }), {})).toBe('c1');
    expect(adapter.extractThread(JSON.stringify({ event: {} }), {})).toBeNull();
    expect(adapter.extractThread('{}', {})).toBeNull();
  });

  it('renderMessage surfaces the event text', () => {
    const body = JSON.stringify({ event: { text: 'hello there', user: 'U1', channel: 'C1' } });
    const msg = adapter.renderMessage('slack-events', body, {});
    expect(msg).toContain('hello there');
    expect(msg).toContain('U1');
    expect(msg).toContain('C1');
  });

  it('renderMessage falls back to the raw body when the shape is unexpected', () => {
    const msg = adapter.renderMessage('slack-events', '{"weird":true}', {});
    expect(msg).toContain('{"weird":true}');
  });
});

describe('github adapter', () => {
  const adapter = getAdapter('github');
  const secret = 'gh-webhook-secret';

  function sign(rawBody: string): string {
    return 'sha256=' + createHmac('sha256', secret).update(rawBody, 'utf8').digest('hex');
  }

  it('requiresSecret is true', () => {
    expect(adapter.requiresSecret).toBe(true);
  });

  it('verify passes with a correct signature', () => {
    const rawBody = JSON.stringify({ action: 'opened' });
    expect(adapter.verify(rawBody, { 'x-hub-signature-256': sign(rawBody) }, secret)).toBe(true);
  });

  it('verify fails with a tampered signature', () => {
    const rawBody = JSON.stringify({ action: 'opened' });
    expect(adapter.verify(rawBody, { 'x-hub-signature-256': 'sha256=deadbeef' }, secret)).toBe(false);
  });

  it('verify fails without a secret', () => {
    const rawBody = '{}';
    expect(adapter.verify(rawBody, { 'x-hub-signature-256': sign(rawBody) }, undefined)).toBe(false);
  });

  it('extractThread builds repo#number from issue or pull_request', () => {
    expect(
      adapter.extractThread(
        JSON.stringify({ repository: { full_name: 'org/repo' }, issue: { number: 7 } }),
        {},
      ),
    ).toBe('org/repo#7');
    expect(
      adapter.extractThread(
        JSON.stringify({ repository: { full_name: 'org/repo' }, pull_request: { number: 12 } }),
        {},
      ),
    ).toBe('org/repo#12');
  });

  it('extractThread returns null with no repository/issue/pr', () => {
    expect(adapter.extractThread('{}', {})).toBeNull();
    expect(adapter.extractThread(JSON.stringify({ repository: { full_name: 'org/repo' } }), {})).toBeNull();
  });

  it('renderMessage includes the event header, action, and issue/PR title+body', () => {
    const body = JSON.stringify({ action: 'opened', issue: { title: 'Bug found', body: 'details here' } });
    const msg = adapter.renderMessage('gh-events', body, { 'x-github-event': 'issues' });
    expect(msg).toContain('issues');
    expect(msg).toContain('opened');
    expect(msg).toContain('Bug found');
    expect(msg).toContain('details here');
  });

  it('renderMessage falls back to the raw body when there is no issue/PR', () => {
    const body = JSON.stringify({ action: 'created' });
    const msg = adapter.renderMessage('gh-events', body, { 'x-github-event': 'ping' });
    expect(msg).toContain(body);
  });
});

describe('resolveWebhookSecret', () => {
  it('prefers a per-path env override', () => {
    process.env['LMTHING_WEBHOOK_SECRET_MY_PATH'] = 'per-path-secret';
    process.env['SLACK_SIGNING_SECRET'] = 'provider-secret';
    expect(resolveWebhookSecret('my-path', 'slack')).toBe('per-path-secret');
  });

  it('falls back to the provider-standard env var', () => {
    delete process.env['LMTHING_WEBHOOK_SECRET_MY_PATH'];
    process.env['SLACK_SIGNING_SECRET'] = 'provider-secret';
    expect(resolveWebhookSecret('my-path', 'slack')).toBe('provider-secret');

    process.env['GITHUB_WEBHOOK_SECRET'] = 'gh-secret';
    expect(resolveWebhookSecret('other-path', 'github')).toBe('gh-secret');
  });

  it('returns undefined when nothing is configured', () => {
    delete process.env['LMTHING_WEBHOOK_SECRET_MY_PATH'];
    delete process.env['SLACK_SIGNING_SECRET'];
    expect(resolveWebhookSecret('my-path', 'slack')).toBeUndefined();
    expect(resolveWebhookSecret('my-path', 'generic')).toBeUndefined();
  });
});
