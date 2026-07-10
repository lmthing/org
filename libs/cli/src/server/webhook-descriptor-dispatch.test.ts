/**
 * CONTAINMENT ACCEPTANCE TEST.
 *
 * Proves the core promise of the self-contained integration design: a brand-new
 * messaging provider that exists NOWHERE in pod code — declared entirely by a
 * space's `package.json` `lmthing.webhook` descriptor + a handler agent's
 * `triggers:` frontmatter — is verified and dispatched by the real inbound
 * handler (`createInboundHandler`) with ZERO pod edits. If this passes, adding
 * integration #9…#N is purely a new `store/spaces/` folder.
 *
 * The fabricated provider `fake9` uses a `header-equals` verify + a
 * `hub-challenge` GET echo — neither the id nor its config appears in any pod
 * source file.
 */
import { describe, it, expect, afterAll, beforeEach } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { createInboundHandler, type InboundManager } from './routes/webhooks.js';
import { clearIntegrationDescriptorCache } from './integration-manifests.js';

const tmpDirs: string[] = [];
afterAll(async () => {
  await Promise.all(tmpDirs.map((d) => rm(d, { recursive: true, force: true })));
});

const ORIGINAL_ENV = { ...process.env };
beforeEach(() => {
  process.env = { ...ORIGINAL_ENV };
  clearIntegrationDescriptorCache();
});

/** Build a project with an `integration-fake` space that DECLARES the `fake9`
 *  provider — a webhook descriptor + a handler agent trigger. No pod code. */
async function makeProjectWithFakeProvider(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'lmthing-fake9-'));
  tmpDirs.push(root);
  const spaceDir = join(root, 'crm', 'spaces', 'integration-fake');
  await mkdir(join(spaceDir, 'agents', 'handler'), { recursive: true });
  await writeFile(
    join(spaceDir, 'package.json'),
    JSON.stringify({
      name: 'integration-fake',
      lmthing: {
        kind: 'integration',
        title: 'Fake9',
        webhook: {
          provider: 'fake9',
          secretEnv: 'FAKE9_SECRET',
          verify: { type: 'header-equals', header: 'x-fake-token' },
          challenge: { type: 'hub-challenge', verifyTokenEnv: 'FAKE9_VERIFY' },
        },
      },
    }),
    'utf8',
  );
  await writeFile(
    join(spaceDir, 'agents', 'handler', 'instruct.md'),
    `---\ntitle: Fake9\ntriggers:\n  - webhook: { path: fake9, provider: fake9 }\n---\nbody`,
    'utf8',
  );
  return root;
}

function fakeReq(body: string, headers: Record<string, string> = {}, method = 'POST', url = '/'): IncomingMessage {
  async function* gen() {
    if (body) yield Buffer.from(body, 'utf8');
  }
  const req = gen() as unknown as IncomingMessage;
  const r = req as unknown as { headers: Record<string, string>; method: string; url: string };
  r.headers = headers;
  r.method = method;
  r.url = url;
  return req;
}

/** Fake res capturing status + raw body text + content-type (handles BOTH the
 *  JSON `sendJson` path and the plain-text challenge `writeHead/end` path). */
function fakeRes(): { res: ServerResponse; get: () => { status: number; text: string; contentType?: string } } {
  let status = 0;
  let text = '';
  let contentType: string | undefined;
  const res = {
    writeHead(s: number, headers?: Record<string, string>) {
      status = s;
      if (headers && headers['Content-Type']) contentType = headers['Content-Type'];
    },
    end(data?: string) {
      if (data) text = data;
    },
  } as unknown as ServerResponse;
  return { res, get: () => ({ status, text, contentType }) };
}

const manager = (sink: Array<Record<string, unknown>>): InboundManager => ({
  listProjects: async () => [{ id: 'crm' }, { id: 'system' }],
  runHeadless: async (args) => {
    sink.push(args);
    return { ok: true, result: 'handled', sessionId: 's1' };
  },
  runHeadlessThreaded: async (args) => {
    sink.push(args);
    return { ok: true, result: 'threaded', sessionId: args.sessionId };
  },
});

describe('containment: a descriptor-only provider works end-to-end (zero pod edits)', () => {
  it('verifies a correctly-signed inbound and dispatches the raw payload to the handler', async () => {
    const root = await makeProjectWithFakeProvider();
    process.env['FAKE9_SECRET'] = 'sh4red';

    const calls: Array<Record<string, unknown>> = [];
    const handler = createInboundHandler(manager(calls), root);
    const { res, get } = fakeRes();
    const payload = JSON.stringify({ from: 'user-7', text: 'hello there' });

    await handler(fakeReq(payload, { 'x-fake-token': 'sh4red', 'content-type': 'application/json' }), res, {
      path: 'fake9',
    });

    expect(get().status).toBe(200);
    expect(calls).toHaveLength(1);
    const arg = calls[0]!;
    expect(arg).toMatchObject({ projectId: 'crm', spaceRef: 'integration-fake/handler', agentSlug: 'handler' });
    // Passthrough render: the raw payload + inbound-context reach the handler agent.
    expect(String(arg['message'])).toContain(payload);
    expect(String(arg['message'])).toContain('[inbound-context]');
    expect(String(arg['message'])).toContain('fake9');
  });

  it('rejects a wrong signature (401) and never runs an agent', async () => {
    const root = await makeProjectWithFakeProvider();
    process.env['FAKE9_SECRET'] = 'sh4red';

    const calls: Array<Record<string, unknown>> = [];
    const handler = createInboundHandler(manager(calls), root);
    const { res, get } = fakeRes();
    await handler(fakeReq('{}', { 'x-fake-token': 'WRONG' }), res, { path: 'fake9' });

    expect(get().status).toBe(401);
    expect(calls).toHaveLength(0);
  });

  it('answers a GET hub-challenge with the echoed challenge (no agent run)', async () => {
    const root = await makeProjectWithFakeProvider();
    process.env['FAKE9_VERIFY'] = 'verify-me';

    const calls: Array<Record<string, unknown>> = [];
    const handler = createInboundHandler(manager(calls), root);
    const { res, get } = fakeRes();
    const url = '/api/inbound/fake9?hub.mode=subscribe&hub.verify_token=verify-me&hub.challenge=ECHO_123';

    await handler(fakeReq('', {}, 'GET', url), res, { path: 'fake9' });

    const out = get();
    expect(out.status).toBe(200);
    expect(out.text).toBe('ECHO_123');
    expect(out.contentType).toBe('text/plain');
    expect(calls).toHaveLength(0);
  });

  it('rejects a GET challenge with a wrong verify token (403)', async () => {
    const root = await makeProjectWithFakeProvider();
    process.env['FAKE9_VERIFY'] = 'verify-me';

    const calls: Array<Record<string, unknown>> = [];
    const handler = createInboundHandler(manager(calls), root);
    const { res, get } = fakeRes();
    const url = '/api/inbound/fake9?hub.verify_token=nope&hub.challenge=ECHO_123';

    await handler(fakeReq('', {}, 'GET', url), res, { path: 'fake9' });

    expect(get().status).toBe(403);
    expect(calls).toHaveLength(0);
  });
});
