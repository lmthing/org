/**
 * END-TO-END demo of the self-contained integration engine, keyless (mock model
 * stream) and against a REAL local mock "provider" HTTP server — no external
 * credentials, no real provider account.
 *
 * It installs the actual shipped `store/spaces/integration-demo` space into a
 * temp project and drives the WHOLE contained loop through the real
 * `SessionManager` + `createInboundHandler` + `createConnectionResolver`:
 *
 *   signed inbound webhook
 *     → descriptor scan finds the space's `lmthing.webhook`
 *     → HMAC-SHA256 verify (x-demo-signature)
 *     → passthrough render delivers the raw payload to the Demo Channel agent
 *     → the agent runs and calls demoSendMessage(...) → callConnection('demo', …)
 *     → descriptor scan finds the space's `lmthing.connection`
 *     → apiBase resolves to DEMO_BASE_URL, Bearer DEMO_API_TOKEN attached, host-pinned
 *     → OUTBOUND POST lands on the mock provider.
 *
 * Everything provider-specific lives in the space; the pod ran it generically.
 */
import { describe, it, expect, afterAll, beforeAll, beforeEach } from 'vitest';
import { mkdtemp, rm, cp, mkdir, writeFile } from 'node:fs/promises';
import { createServer, type Server, type IncomingMessage, type ServerResponse } from 'node:http';
import { createHmac } from 'node:crypto';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { Session, createMockStreamFn } from '@lmthing/core';
import type { StreamOpts } from '@lmthing/core';
import { SessionManager, type BuildSessionArgs } from './session-manager.js';
import { createConnectionResolver } from './connections.js';
import { createInboundHandler } from './routes/webhooks.js';
import { clearIntegrationDescriptorCache } from './integration-manifests.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const DEMO_SPACE_SRC = join(HERE, '../../../../../../store/spaces/integration-demo');

const DEMO_BASE_TOKEN = 'tok-abc-123';
const DEMO_WEBHOOK_SECRET = 'whsec-xyz-789';

const tmpDirs: string[] = [];
let mockProvider: Server;
let received: Array<{ method: string; url: string; auth?: string; body: unknown }>;
let providerBase: string;

beforeAll(async () => {
  received = [];
  mockProvider = createServer((req: IncomingMessage, res: ServerResponse) => {
    const chunks: Buffer[] = [];
    req.on('data', (c) => chunks.push(c as Buffer));
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      let body: unknown = raw;
      try {
        body = JSON.parse(raw);
      } catch {
        /* keep raw */
      }
      received.push({
        method: req.method ?? '',
        url: req.url ?? '',
        auth: req.headers['authorization'] as string | undefined,
        body,
      });
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: true, echoed: body }));
    });
  });
  await new Promise<void>((r) => mockProvider.listen(0, '127.0.0.1', () => r()));
  const addr = mockProvider.address();
  const port = typeof addr === 'object' && addr ? addr.port : 0;
  providerBase = `http://127.0.0.1:${port}`;
});

afterAll(async () => {
  await new Promise<void>((r) => mockProvider.close(() => r()));
  await Promise.all(tmpDirs.map((d) => rm(d, { recursive: true, force: true })));
});

const ORIGINAL_ENV = { ...process.env };
beforeEach(() => {
  process.env = { ...ORIGINAL_ENV };
  clearIntegrationDescriptorCache();
  // The mock provider binds to 127.0.0.1 (loopback), which the SSRF guard blocks
  // in prod — opt out for this local end-to-end test (per-pod, test-only).
  process.env['LMTHING_ALLOW_INTERNAL_CONNECTIONS'] = '1';
});

/** Temp lmthingRoot with the REAL integration-demo space installed into `demo-proj`. */
async function makeRootWithDemoSpace(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'lmthing-demo-e2e-'));
  tmpDirs.push(root);
  const dest = join(root, 'demo-proj', 'spaces', 'integration-demo');
  await mkdir(dirname(dest), { recursive: true });
  await cp(DEMO_SPACE_SRC, dest, { recursive: true });
  // A real project has a project.json — listProjects (used by the dispatcher to
  // enumerate projects) skips dirs without one.
  await writeFile(join(root, 'demo-proj', 'project.json'), JSON.stringify({ id: 'demo-proj', name: 'Demo', createdAt: 0 }), 'utf8');
  return root;
}

/** Fake IncomingMessage: async-iterable body + headers/method/url. */
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

function fakeRes(): { res: ServerResponse; get: () => { status: number } } {
  let status = 0;
  const res = {
    writeHead(s: number) {
      status = s;
    },
    end() {},
  } as unknown as ServerResponse;
  return { res, get: () => ({ status }) };
}

describe('integration-demo — full contained loop against a mock provider (keyless)', () => {
  it('verifies a signed inbound, runs the handler agent, and posts the reply outbound via callConnection', async () => {
    const root = await makeRootWithDemoSpace();
    process.env['INTEGRATION_DEMO_BASE_URL'] = providerBase;
    process.env['INTEGRATION_DEMO_API_TOKEN'] = DEMO_BASE_TOKEN;
    process.env['INTEGRATION_DEMO_WEBHOOK_SECRET'] = DEMO_WEBHOOK_SECRET;

    // The mock model: on the handler's first turn, reply into the same chat via the
    // space's own wrapper (which calls callConnection('demo', …)); then stop. Also
    // capture the prompt to prove the raw inbound payload reached the agent.
    let capturedPrompt = '';
    const mockStreamFn = createMockStreamFn((opts: StreamOpts) => {
      const hasAssistant = opts.messages.some((m) => m.role === 'assistant');
      if (hasAssistant) return '';
      capturedPrompt = opts.messages
        .filter((m) => m.role === 'user')
        .map((m) => (typeof m.content === 'string' ? m.content : JSON.stringify(m.content)))
        .join('\n');
      return `const r = await demoSendMessage('c1', 'pong from agent'); display('sent ' + (r && r.ok));`;
    });

    const manager = new SessionManager({
      streamFn: mockStreamFn,
      lmthingRoot: root,
      snapshotsDir: join(root, 'snapshots'),
      // Keyless build that still wires the REAL connection resolver (as
      // defaultBuildSession does) so callConnection resolves the space's descriptor.
      buildSession: (args: BuildSessionArgs) =>
        new Session(
          {
            spaceDir: args.spaceDir,
            agentSlug: args.agentSlug,
            modelAlias: 'mock',
            renderHost: args.renderHost,
            systemSpaceDirs: [],
            projectSpacesDir: args.projectSpacesDir,
            projectId: args.projectId,
            projectRoot: args.projectRoot,
            appGlobals: { callConnection: createConnectionResolver(args.projectRoot) },
            appDts: args.appDts,
          },
          { streamFn: mockStreamFn },
        ),
    });

    const handler = createInboundHandler(manager, root);
    const { res, get } = fakeRes();

    const body = JSON.stringify({ message: { chat: { id: 'c1' }, text: 'hello there' } });
    const sig = 'sha256=' + createHmac('sha256', DEMO_WEBHOOK_SECRET).update(body, 'utf8').digest('hex');

    await handler(
      fakeReq(body, { 'content-type': 'application/json', 'x-demo-signature': sig }),
      res,
      { path: 'demo' },
    );

    // Inbound verified + dispatched.
    expect(get().status).toBe(200);
    // The raw payload reached the handler agent (passthrough render).
    expect(capturedPrompt).toContain('hello there');
    expect(capturedPrompt).toContain('[inbound-context]');

    // The OUTBOUND callConnection landed on the mock provider, host-pinned to
    // DEMO_BASE_URL, Bearer DEMO_API_TOKEN attached, with the agent's reply body.
    expect(received).toHaveLength(1);
    const out = received[0]!;
    expect(out.method).toBe('POST');
    expect(out.url).toBe('/messages');
    expect(out.auth).toBe(`Bearer ${DEMO_BASE_TOKEN}`);
    expect(out.body).toEqual({ chat_id: 'c1', text: 'pong from agent' });
  });

  it('rejects a wrongly-signed inbound (401) and never calls the provider', async () => {
    const root = await makeRootWithDemoSpace();
    process.env['INTEGRATION_DEMO_BASE_URL'] = providerBase;
    process.env['INTEGRATION_DEMO_API_TOKEN'] = DEMO_BASE_TOKEN;
    process.env['INTEGRATION_DEMO_WEBHOOK_SECRET'] = DEMO_WEBHOOK_SECRET;
    received.length = 0;

    const manager = new SessionManager({
      streamFn: createMockStreamFn(() => ''),
      lmthingRoot: root,
      snapshotsDir: join(root, 'snapshots'),
      buildSession: (args: BuildSessionArgs) =>
        new Session(
          { spaceDir: args.spaceDir, agentSlug: args.agentSlug, modelAlias: 'mock', renderHost: args.renderHost, systemSpaceDirs: [] },
          { streamFn: createMockStreamFn(() => '') },
        ),
    });

    const handler = createInboundHandler(manager, root);
    const { res, get } = fakeRes();
    const body = JSON.stringify({ message: { chat: { id: 'c1' }, text: 'hi' } });
    const badSig = 'sha256=' + createHmac('sha256', 'the-wrong-secret').update(body, 'utf8').digest('hex');

    await handler(fakeReq(body, { 'x-demo-signature': badSig }), res, { path: 'demo' });

    expect(get().status).toBe(401);
    expect(received).toHaveLength(0);
  });
});
