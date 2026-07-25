/**
 * WEBHOOK EMITTER DEF dispatch (S5) — end-to-end through the real inbound handler.
 *
 * A webhook emitter def (`events/*.ts`, the producer side) declares its OWN
 * `path` + verify + typed `emits`; the pure `emit(inbound)` runs worker-isolated
 * after verify/preflight/dedupe, and the resulting typed events fan out to
 * subscribing EVENT hooks (the consumer side) via `dispatchEmittedEvents`.
 *
 * Covers, against scratch project trees driven by `createInboundHandler`:
 *   - a descriptor-verify emitter end-to-end (verified inbound → worker emit →
 *     event HANDLER hook receives the typed payload as `ctx.input`)
 *   - a builtin-shorthand (slack) def: the `url_verification` preflight is
 *     answered pre-emit, and a real signed event drives the pipeline
 *   - a space with TWO webhook defs on distinct paths — both bind in the manifest
 *   - an emitter path colliding with a legacy space-agent trigger — FATAL at build
 *   - a payload that doesn't fit the declared schema — dropped-with-warn, no hook run
 *   - dedupe: a replayed identical signed inbound dispatches at most once
 *   - a TRIGGER-style event hook — a headless agent run (fake manager), threaded
 *     when the emitted event carries a `threadKey`
 */
import { describe, it, expect, afterAll, beforeEach } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { createHmac } from 'node:crypto';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { createInboundHandler, type InboundManager } from './routes/webhooks.js';
import { buildWebhookManifest } from './webhook-manifest.js';
import { clearEmitterDefCache } from './emitter-manifests.js';
import { clearInboundDedupe } from './webhook-dedupe.js';

const tmpDirs: string[] = [];
afterAll(async () => {
  await Promise.all(tmpDirs.map((d) => rm(d, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })));
});

const ORIGINAL_ENV = { ...process.env };
beforeEach(() => {
  process.env = { ...ORIGINAL_ENV };
  clearEmitterDefCache();
  clearInboundDedupe();
});

// ── fixtures ──────────────────────────────────────────────────────────────────

async function newRoot(prefix: string): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), prefix));
  tmpDirs.push(root);
  return root;
}

/** Write `<root>/<project>/events/<name>.ts` (scope 'project') or
 *  `<root>/<project>/spaces/<scope>/events/<name>.ts` (a space scope). */
async function writeEvent(root: string, project: string, scope: string, name: string, source: string): Promise<void> {
  const dir =
    scope === 'project'
      ? join(root, project, 'events')
      : join(root, project, 'spaces', scope, 'events');
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, `${name}.ts`), source, 'utf8');
}

/** Write a PROJECT event hook `<root>/<project>/hooks/<name>.ts`. */
async function writeHook(root: string, project: string, name: string, source: string): Promise<void> {
  const dir = join(root, project, 'hooks');
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, `${name}.ts`), source, 'utf8');
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

interface RunCall extends Record<string, unknown> {
  kind: 'runHeadless' | 'threaded';
}

/** A fake manager recording every headless/threaded run + supplying the getProjectDb
 *  the emitter handler-hook path needs (returns null — the test hooks don't use db). */
function makeManager(sink: RunCall[]): InboundManager {
  return {
    listProjects: async () => [{ id: 'crm' }, { id: 'system' }],
    runHeadless: async (args) => {
      sink.push({ kind: 'runHeadless', ...args });
      return { ok: true, result: 'ran', sessionId: 's1' };
    },
    runHeadlessThreaded: async (args) => {
      sink.push({ kind: 'threaded', ...args });
      return { ok: true, result: 'threaded', sessionId: args.sessionId };
    },
    getProjectDb: async () => null,
  };
}

/** Poll until `fn()` is truthy (dispatch is fire-and-forget — the 200 lands before
 *  the async fan-out to event hooks completes). */
async function waitFor(fn: () => boolean, timeoutMs = 4000): Promise<void> {
  const start = Date.now();
  while (!fn()) {
    if (Date.now() - start > timeoutMs) throw new Error('waitFor: timed out');
    await new Promise((r) => setTimeout(r, 20));
  }
}

/** Slack builtin verify headers for `body` (correct signature + fresh timestamp). */
function slackHeaders(body: string, secret: string): Record<string, string> {
  const ts = String(Math.floor(Date.now() / 1000));
  const sig = 'v0=' + createHmac('sha256', secret).update(`v0:${ts}:${body}`, 'utf8').digest('hex');
  return { 'x-slack-request-timestamp': ts, 'x-slack-signature': sig, 'content-type': 'application/json' };
}

// ── 1. descriptor-verify emitter → handler hook via ctx.input ───────────────────

/** A project webhook emitter def: `header-equals` verify, a typed `order.created`
 *  event echoing the JSON body. Project scope ⇒ no env namespacing required. */
const ORDERS_EMITTER = `export default {
  type: 'webhook',
  path: 'orders-inbound',
  verify: { type: 'header-equals', header: 'x-token' },
  secretEnv: 'ORDERS_SECRET',
  emits: { 'order.created': { payload: { id: 'string', total: 'number' } } },
  emit(inbound) {
    const b = inbound.json || {};
    return [{ event: 'order.created', payload: { id: String(b.id), total: b.total } }];
  },
};`;

/** A project event HANDLER hook subscribing to the emitter's event; forwards
 *  `ctx.input` into a delegate so the run is observable on the fake manager. */
const ORDER_HANDLER_HOOK = `export default {
  type: 'event',
  on: { event: 'project/order.created' },
  handler: async ({ input, delegate }) => {
    await delegate('fulfil/agent', 'ship', { input });
    return { ok: true };
  },
};`;

describe('emitter dispatch — descriptor verify → handler hook', () => {
  it('verifies, emits in a worker, and delivers the typed payload to a handler hook via ctx.input', async () => {
    const root = await newRoot('lm-emit-desc-');
    await writeEvent(root, 'crm', 'project', 'orders', ORDERS_EMITTER);
    await writeHook(root, 'crm', 'on-order', ORDER_HANDLER_HOOK);
    process.env['ORDERS_SECRET'] = 'sekret';

    const sink: RunCall[] = [];
    const handler = createInboundHandler(makeManager(sink), root);
    const { res, get } = fakeRes();
    const payload = JSON.stringify({ id: 42, total: 99 });

    await handler(fakeReq(payload, { 'x-token': 'sekret', 'content-type': 'application/json' }), res, {
      path: 'orders-inbound',
    });

    expect(get().status).toBe(200);
    expect(JSON.parse(get().text)).toEqual({ ok: true, events: 1 });

    // Dispatch is fire-and-forget → wait for the handler's delegate to reach the manager.
    await waitFor(() => sink.length > 0);
    expect(sink).toHaveLength(1);
    const call = sink[0]!;
    expect(call).toMatchObject({ kind: 'runHeadless', projectId: 'crm', spaceRef: 'fulfil/agent', agentSlug: 'agent' });
    // ctx.input IS the typed payload (same shape as the db-write path's row) — the
    // handler knows its event from `on:{event}`, so the name isn't in `input`.
    const msg = String(call['message']);
    expect(msg).toContain('"id":"42"');
    expect(msg).toContain('"total":99');
  });

  it('rejects a wrong secret (401) and never emits', async () => {
    const root = await newRoot('lm-emit-401-');
    await writeEvent(root, 'crm', 'project', 'orders', ORDERS_EMITTER);
    await writeHook(root, 'crm', 'on-order', ORDER_HANDLER_HOOK);
    process.env['ORDERS_SECRET'] = 'sekret';

    const sink: RunCall[] = [];
    const handler = createInboundHandler(makeManager(sink), root);
    const { res, get } = fakeRes();

    await handler(fakeReq(JSON.stringify({ id: 1, total: 2 }), { 'x-token': 'WRONG' }), res, {
      path: 'orders-inbound',
    });

    expect(get().status).toBe(401);
    await new Promise((r) => setTimeout(r, 100));
    expect(sink).toHaveLength(0);
  });
});

// ── 2. builtin shorthand (slack) — preflight + signed event ─────────────────────

const SLACK_EMITTER = `export default {
  type: 'webhook',
  path: 'slack-inbound',
  verify: { type: 'builtin', provider: 'slack' },
  emits: { 'message.posted': { payload: { text: 'string' } } },
  emit(inbound) {
    const ev = (inbound.json && inbound.json.event) || {};
    return [{ event: 'message.posted', payload: { text: String(ev.text || '') } }];
  },
};`;

const SLACK_HANDLER_HOOK = `export default {
  type: 'event',
  on: { event: 'project/message.posted' },
  handler: async ({ input, delegate }) => { await delegate('notify/agent', undefined, { input }); },
};`;

describe('emitter dispatch — builtin slack shorthand', () => {
  it('answers the url_verification preflight (no emit, no hook run)', async () => {
    const root = await newRoot('lm-emit-slackpf-');
    await writeEvent(root, 'crm', 'project', 'slack', SLACK_EMITTER);
    await writeHook(root, 'crm', 'on-msg', SLACK_HANDLER_HOOK);
    process.env['SLACK_SIGNING_SECRET'] = 'shhh';

    const sink: RunCall[] = [];
    const handler = createInboundHandler(makeManager(sink), root);
    const { res, get } = fakeRes();
    const body = JSON.stringify({ type: 'url_verification', challenge: 'C-echo-123' });

    await handler(fakeReq(body, slackHeaders(body, 'shhh')), res, { path: 'slack-inbound' });

    expect(get().status).toBe(200);
    expect(JSON.parse(get().text)).toEqual({ challenge: 'C-echo-123' });
    await new Promise((r) => setTimeout(r, 100));
    expect(sink).toHaveLength(0); // preflight short-circuits before emit/dispatch
  });

  it('verifies a signed event, emits, and dispatches to a handler hook', async () => {
    const root = await newRoot('lm-emit-slackev-');
    await writeEvent(root, 'crm', 'project', 'slack', SLACK_EMITTER);
    await writeHook(root, 'crm', 'on-msg', SLACK_HANDLER_HOOK);
    process.env['SLACK_SIGNING_SECRET'] = 'shhh';

    const sink: RunCall[] = [];
    const handler = createInboundHandler(makeManager(sink), root);
    const { res, get } = fakeRes();
    const body = JSON.stringify({ event: { type: 'message', text: 'hello world' } });

    await handler(fakeReq(body, slackHeaders(body, 'shhh')), res, { path: 'slack-inbound' });

    expect(get().status).toBe(200);
    expect(JSON.parse(get().text)).toEqual({ ok: true, events: 1 });
    await waitFor(() => sink.length > 0);
    expect(String(sink[0]!['message'])).toContain('hello world');
  });

  it('rejects a forged slack signature (401)', async () => {
    const root = await newRoot('lm-emit-slackbad-');
    await writeEvent(root, 'crm', 'project', 'slack', SLACK_EMITTER);
    process.env['SLACK_SIGNING_SECRET'] = 'shhh';

    const sink: RunCall[] = [];
    const handler = createInboundHandler(makeManager(sink), root);
    const { res, get } = fakeRes();
    const body = JSON.stringify({ event: { text: 'x' } });
    const headers = slackHeaders(body, 'WRONG-SECRET'); // signed with the wrong key

    await handler(fakeReq(body, headers), res, { path: 'slack-inbound' });
    expect(get().status).toBe(401);
    expect(sink).toHaveLength(0);
  });
});

// ── 3. a space with TWO webhook defs on distinct paths both bind ────────────────

const SPACE_DEF_A = `export default {
  type: 'webhook', path: 'x-events',
  verify: { type: 'builtin', provider: 'slack' },
  emits: { 'message.posted': { payload: { text: 'string' } } },
  emit(i) { return []; },
};`;
const SPACE_DEF_B = `export default {
  type: 'webhook', path: 'x-commands',
  verify: { type: 'hmac', algo: 'sha256', encoding: 'hex', header: 'x-sig' },
  secretEnv: 'INTEGRATION_X_CMD_SECRET',
  emits: { 'command.invoked': { payload: { cmd: 'string' } } },
  emit(i) { return []; },
};`;

describe('emitter manifest — multi-def space', () => {
  it('binds both webhook defs of one space on their distinct paths', async () => {
    const root = await newRoot('lm-emit-multi-');
    await writeEvent(root, 'crm', 'integration-x', 'events', SPACE_DEF_A);
    await writeEvent(root, 'crm', 'integration-x', 'commands', SPACE_DEF_B);

    const bindings = await buildWebhookManifest(root, ['crm']);
    const emitterBindings = bindings.filter((b) => b.kind === 'emitter');
    expect(emitterBindings.map((b) => b.path).sort()).toEqual(['x-commands', 'x-events']);
    for (const b of emitterBindings) {
      expect(b.provider).toBe('emitter');
      expect(b.agentRef).toContain('integration-x/');
    }
  });
});

// ── 4. emitter path colliding with a legacy trigger is FATAL at build ───────────

describe('emitter manifest — collision with a legacy trigger', () => {
  it('throws fail-loud when an emitter def and a legacy space-agent trigger share a path', async () => {
    const root = await newRoot('lm-emit-collide-');
    // Emitter def (project scope) claiming path 'dup'.
    await writeEvent(
      root,
      'crm',
      'project',
      'dup',
      `export default { type: 'webhook', path: 'dup', verify: { type: 'builtin', provider: 'slack' }, emits: { 'a.b': { payload: {} } }, emit(i) { return []; } };`,
    );
    // Legacy space-agent trigger ALSO claiming 'dup' (a `triggers:` frontmatter binding).
    const agentDir = join(root, 'crm', 'spaces', 'integration-legacy', 'agents', 'handler');
    await mkdir(agentDir, { recursive: true });
    await writeFile(
      join(agentDir, 'instruct.md'),
      `---\ntitle: Legacy\ntriggers:\n  - webhook: { path: dup, provider: generic }\n---\nbody`,
      'utf8',
    );

    await expect(buildWebhookManifest(root, ['crm'])).rejects.toThrow(/emitter/i);
  });
});

// ── 5. payload mismatch dropped-with-warn, no hook run ──────────────────────────

describe('emitter dispatch — payload schema mismatch', () => {
  it('drops an event whose payload violates the declared schema and never runs the hook', async () => {
    const root = await newRoot('lm-emit-badpay-');
    // Declares total:number but emits a string — validateEmitted drops it.
    await writeEvent(
      root,
      'crm',
      'project',
      'orders',
      `export default {
        type: 'webhook', path: 'orders-inbound',
        verify: { type: 'header-equals', header: 'x-token' },
        secretEnv: 'ORDERS_SECRET',
        emits: { 'order.created': { payload: { id: 'string', total: 'number' } } },
        emit(inbound) { return [{ event: 'order.created', payload: { id: 'z', total: 'NOT-A-NUMBER' } }]; },
      };`,
    );
    await writeHook(root, 'crm', 'on-order', ORDER_HANDLER_HOOK);
    process.env['ORDERS_SECRET'] = 'sekret';

    const warnings: string[] = [];
    const origWarn = console.warn;
    console.warn = (...a: unknown[]) => { warnings.push(a.map(String).join(' ')); };
    try {
      const sink: RunCall[] = [];
      const handler = createInboundHandler(makeManager(sink), root);
      const { res, get } = fakeRes();
      await handler(fakeReq(JSON.stringify({ id: 1 }), { 'x-token': 'sekret' }), res, { path: 'orders-inbound' });

      expect(get().status).toBe(200);
      expect(JSON.parse(get().text)).toEqual({ ok: true, events: 0 }); // dropped
      await new Promise((r) => setTimeout(r, 150));
      expect(sink).toHaveLength(0); // no valid event ⇒ no hook run
    } finally {
      console.warn = origWarn;
    }
    expect(warnings.some((w) => /does not match its declared schema/.test(w))).toBe(true);
  });
});

// ── 6. dedupe: a replayed signed inbound dispatches at most once ────────────────

describe('emitter dispatch — dedupe', () => {
  it('dispatches once for a byte-identical replayed inbound', async () => {
    const root = await newRoot('lm-emit-dedupe-');
    await writeEvent(root, 'crm', 'project', 'orders', ORDERS_EMITTER);
    await writeHook(root, 'crm', 'on-order', ORDER_HANDLER_HOOK);
    process.env['ORDERS_SECRET'] = 'sekret';

    const sink: RunCall[] = [];
    const handler = createInboundHandler(makeManager(sink), root);
    const payload = JSON.stringify({ id: 7, total: 3 });
    const headers = { 'x-token': 'sekret', 'content-type': 'application/json' };

    const r1 = fakeRes();
    await handler(fakeReq(payload, headers), r1.res, { path: 'orders-inbound' });
    const r2 = fakeRes();
    await handler(fakeReq(payload, headers), r2.res, { path: 'orders-inbound' }); // exact replay

    expect(JSON.parse(r1.get().text)).toEqual({ ok: true, events: 1 });
    expect(JSON.parse(r2.get().text)).toEqual({ ok: true, deduped: true });
    await waitFor(() => sink.length > 0);
    await new Promise((r) => setTimeout(r, 150));
    expect(sink).toHaveLength(1); // second (deduped) request never dispatched
  });
});

// ── 7. trigger-style event hook — headless run, threaded when threadKey present ──

const TRIGGER_HOOK = `export default {
  type: 'event',
  on: { event: 'project/ticket.opened' },
  trigger: 'support/agent#triage',
  budget: { maxEpisodes: 3 },
};`;

/** An emitter whose emit sets a threadKey iff the body says so (proves both paths). */
const TICKET_EMITTER = `export default {
  type: 'webhook', path: 'tickets-inbound',
  verify: { type: 'header-equals', header: 'x-token' },
  secretEnv: 'TICKET_SECRET',
  emits: { 'ticket.opened': { payload: { id: 'string' } } },
  emit(inbound) {
    const b = inbound.json || {};
    const out = { event: 'ticket.opened', payload: { id: String(b.id) } };
    if (b.thread) out.threadKey = String(b.thread);
    return [out];
  },
};`;

describe('emitter dispatch — trigger event hook', () => {
  async function setup(): Promise<{ root: string; sink: RunCall[]; handler: ReturnType<typeof createInboundHandler> }> {
    const root = await newRoot('lm-emit-trig-');
    await writeEvent(root, 'crm', 'project', 'tickets', TICKET_EMITTER);
    await writeHook(root, 'crm', 'on-ticket', TRIGGER_HOOK);
    process.env['TICKET_SECRET'] = 'sekret';
    const sink: RunCall[] = [];
    const handler = createInboundHandler(makeManager(sink), root);
    return { root, sink, handler };
  }

  it('runs a one-shot headless agent run when the event has no threadKey', async () => {
    const { sink, handler } = await setup();
    const { res, get } = fakeRes();
    await handler(fakeReq(JSON.stringify({ id: 'T1' }), { 'x-token': 'sekret' }), res, { path: 'tickets-inbound' });

    expect(get().status).toBe(200);
    await waitFor(() => sink.length > 0);
    const call = sink[0]!;
    expect(call).toMatchObject({ kind: 'runHeadless', projectId: 'crm', spaceRef: 'support/agent', agentSlug: 'agent' });
    expect(String(call['message'])).toContain('ticket.opened');
    expect(call['budget']).toMatchObject({ maxEpisodes: 3 });
  });

  it('continues a threaded session when the event carries a threadKey', async () => {
    const { sink, handler } = await setup();
    const { res, get } = fakeRes();
    await handler(fakeReq(JSON.stringify({ id: 'T2', thread: 'conv-9' }), { 'x-token': 'sekret' }), res, {
      path: 'tickets-inbound',
    });

    expect(get().status).toBe(200);
    await waitFor(() => sink.length > 0);
    const call = sink[0]!;
    expect(call.kind).toBe('threaded');
    expect(typeof call['sessionId']).toBe('string');
    expect((call['sessionId'] as string).length).toBeGreaterThan(0);
  });
});
