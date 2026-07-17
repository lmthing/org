/**
 * runner-verbs.test.mjs — the direct-pod-probe step verbs (`call_app_api`, `run_emitter`,
 * `inbound` (+ `sign`), `list_integrations`, `set_env`/`blank_env`/`restore_env`, `mutate_schema`,
 * `space_session`), exercised against `runStep` directly with fake pod/session doubles — no real
 * server, no real QuickJS turn. Named separately from `runner.test.mjs` (the `bootstrap: thing`
 * project-discovery suite) so the two stay independently attributable.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runStep } from './runner.mjs';
import { ThingSession } from '../harness/lib/thing.mjs';

const tmps = [];
const mkTmp = () => {
  const d = mkdtempSync(join(tmpdir(), 'lmscn-runstep-'));
  tmps.push(d);
  return d;
};
afterEach(() => {
  for (const d of tmps.splice(0)) rmSync(d, { recursive: true, force: true });
  vi.restoreAllMocks();
});

function fakePod() {
  return {
    appApi: vi.fn().mockResolvedValue({ status: 202, body: { ok: true } }),
    runHook: vi.fn().mockResolvedValue({ ok: true }),
    runEmitter: vi.fn().mockResolvedValue({ ok: true }),
    inbound: vi.fn().mockResolvedValue({ status: 200, body: { events: 1 } }),
    listIntegrations: vi.fn().mockResolvedValue({ missingRequired: ['A', 'B'] }),
    getEnv: vi.fn().mockResolvedValue({ content: 'TAVILY_API_KEY=real-secret\nOTHER=1\n' }),
    putEnv: vi.fn().mockResolvedValue({ ok: true }),
  };
}
const freshRec = () => ({ notes: [], turns: [] });
const base = (step, pod, extra = {}) => ({
  step,
  thing: null,
  pod,
  run: {},
  projectId: 'proj',
  fixturesDir: '/nonexistent',
  rec: freshRec(),
  envStack: [],
  onAsk: () => undefined,
  verbose: false,
  ...extra,
});

describe('runStep — call_app_api', () => {
  it('calls pod.appApi with the given method/path/body and records status+body', async () => {
    const pod = fakePod();
    const args = base({ call_app_api: { method: 'POST', path: 'costs', body: { a: 1 } } }, pod);
    await runStep(args);
    expect(pod.appApi).toHaveBeenCalledWith('proj', 'costs', { a: 1 }, 'POST');
    expect(args.rec.callAppApi).toEqual({ method: 'POST', path: 'costs', status: 202, body: { ok: true } });
  });

  it('defaults method to POST when omitted', async () => {
    const pod = fakePod();
    const args = base({ call_app_api: { path: 'costs' } }, pod);
    await runStep(args);
    expect(pod.appApi).toHaveBeenCalledWith('proj', 'costs', undefined, 'POST');
  });
});

describe('runStep — run_emitter', () => {
  it('a bare string runs a plain hook by its own slug (pod.runHook, no @emitter: wrapper)', async () => {
    const pod = fakePod();
    const args = base({ run_emitter: 'weekly-reconcile' }, pod);
    await runStep(args);
    expect(pod.runHook).toHaveBeenCalledWith('proj', 'weekly-reconcile');
    expect(pod.runEmitter).not.toHaveBeenCalled();
    expect(args.rec.runEmitter).toEqual({ slug: 'weekly-reconcile', result: { ok: true } });
  });

  it('{scope,name} fires the @emitter: pseudo-slug via pod.runEmitter', async () => {
    const pod = fakePod();
    const args = base({ run_emitter: { scope: 'household', name: 'weekly_plan' } }, pod);
    await runStep(args);
    expect(pod.runEmitter).toHaveBeenCalledWith('proj', 'household', 'weekly_plan', undefined);
    expect(args.rec.runEmitter).toEqual({ scope: 'household', name: 'weekly_plan', result: { ok: true } });
  });

  it('{slug} also runs a plain hook, forwarding an optional payload', async () => {
    const pod = fakePod();
    const args = base({ run_emitter: { slug: 'weekly-reconcile', payload: { forced: true } } }, pod);
    await runStep(args);
    expect(pod.runHook).toHaveBeenCalledWith('proj', 'weekly-reconcile', { forced: true });
  });
});

describe('runStep — inbound', () => {
  it('delivers a single object as one delivery, recording status/body and header NAMES only', async () => {
    const pod = fakePod();
    const args = base({ inbound: { path: 'demo', body: { message: {} }, headers: { 'x-demo-signature': 'bad-sig' } } }, pod);
    await runStep(args);
    expect(pod.inbound).toHaveBeenCalledWith('demo', { message: {} }, { 'x-demo-signature': 'bad-sig' });
    expect(args.rec.inbound).toEqual([{ path: 'demo', headerNames: ['x-demo-signature'], status: 200, body: { events: 1 } }]);
  });

  it('delivers an ARRAY concurrently — one entry per delivery in evidence', async () => {
    const pod = fakePod();
    const step = { inbound: [{ path: 'demo', body: { a: 1 } }, { path: 'demo', body: { a: 2 } }] };
    const args = base(step, pod);
    await runStep(args);
    expect(pod.inbound).toHaveBeenCalledTimes(2);
    expect(args.rec.inbound).toHaveLength(2);
  });

  it('signs the body with the CURRENT secret read from the pod env — never a value baked into the yaml', async () => {
    const pod = fakePod();
    pod.getEnv = vi.fn().mockResolvedValue({ content: 'INTEGRATION_DEMO_WEBHOOK_SECRET=whsec-xyz-789\n' });
    const body = { message: { text: 'hi' } };
    const step = { inbound: { path: 'demo', body, sign: { header: 'x-demo-signature', prefix: 'sha256=', secretEnv: 'INTEGRATION_DEMO_WEBHOOK_SECRET' } } };
    const args = base(step, pod);
    await runStep(args);
    const [, , headersSent] = pod.inbound.mock.calls[0];
    expect(headersSent['x-demo-signature']).toMatch(/^sha256=[0-9a-f]{64}$/);
  });

  it('a wrong secret in the env produces a DIFFERENT signature than the right one — proof it is a real HMAC', async () => {
    const body = { message: { text: 'hi' } };
    const sign = { header: 'x-demo-signature', prefix: 'sha256=', secretEnv: 'INTEGRATION_DEMO_WEBHOOK_SECRET' };

    const podRight = fakePod();
    podRight.getEnv = vi.fn().mockResolvedValue({ content: 'INTEGRATION_DEMO_WEBHOOK_SECRET=right-secret\n' });
    await runStep(base({ inbound: { path: 'demo', body, sign } }, podRight));

    const podWrong = fakePod();
    podWrong.getEnv = vi.fn().mockResolvedValue({ content: 'INTEGRATION_DEMO_WEBHOOK_SECRET=wrong-secret\n' });
    await runStep(base({ inbound: { path: 'demo', body, sign } }, podWrong));

    expect(podRight.inbound.mock.calls[0][2]['x-demo-signature']).not.toBe(podWrong.inbound.mock.calls[0][2]['x-demo-signature']);
  });
});

describe('runStep — list_integrations', () => {
  it('GETs the project integrations and times the call', async () => {
    const pod = fakePod();
    const args = base({ list_integrations: true }, pod);
    await runStep(args);
    expect(pod.listIntegrations).toHaveBeenCalledWith('proj');
    expect(args.rec.integrations).toEqual({ missingRequired: ['A', 'B'] });
    expect(typeof args.rec.integrationsMs).toBe('number');
  });
});

describe('runStep — set_env / blank_env / restore_env', () => {
  it('set_env merges given keys, pushes the pre-mutation content, and records key NAMES only', async () => {
    const pod = fakePod();
    const envStack = [];
    const args = base({ set_env: { NEW_KEY: 'sekrit' } }, pod, { envStack });
    await runStep(args);
    expect(pod.putEnv).toHaveBeenCalledWith('TAVILY_API_KEY=real-secret\nOTHER=1\nNEW_KEY=sekrit\n');
    expect(args.rec.setEnv).toEqual({ keys: ['NEW_KEY'] });
    expect(JSON.stringify(args.rec)).not.toContain('sekrit');
    expect(envStack).toEqual(['TAVILY_API_KEY=real-secret\nOTHER=1\n']);
  });

  it('blank_env sets the named keys to an explicit empty string', async () => {
    const pod = fakePod();
    const envStack = [];
    const args = base({ blank_env: ['TAVILY_API_KEY'] }, pod, { envStack });
    await runStep(args);
    expect(pod.putEnv).toHaveBeenCalledWith('TAVILY_API_KEY=\nOTHER=1\n');
    expect(args.rec.blankEnv).toEqual({ keys: ['TAVILY_API_KEY'] });
  });

  it('blank_env then restore_env in ONE step round-trips back to the original content', async () => {
    const pod = fakePod();
    const envStack = [];
    const args = base({ blank_env: ['TAVILY_API_KEY'], restore_env: true }, pod, { envStack });
    await runStep(args);
    expect(pod.putEnv).toHaveBeenNthCalledWith(1, 'TAVILY_API_KEY=\nOTHER=1\n');
    expect(pod.putEnv).toHaveBeenNthCalledWith(2, 'TAVILY_API_KEY=real-secret\nOTHER=1\n');
    expect(args.rec.restoreEnv).toEqual({ restored: true });
    expect(envStack).toEqual([]);
  });

  it('restore_env with an empty stack notes it rather than throwing', async () => {
    const pod = fakePod();
    const args = base({ restore_env: true }, pod, { envStack: [] });
    await runStep(args);
    expect(pod.putEnv).not.toHaveBeenCalled();
    expect(args.rec.notes.some((n) => n.includes('restore_env'))).toBe(true);
  });
});

describe('runStep — mutate_schema', () => {
  it('retypes an existing column non-additively, direct on disk', async () => {
    const sc = mkTmp();
    const dataDir = join(sc, 'data');
    mkdirSync(join(dataDir, '.lmthing', 'proj', 'database'), { recursive: true });
    const schemaPath = join(dataDir, '.lmthing', 'proj', 'database', 'quotes.json');
    writeFileSync(schemaPath, JSON.stringify({ columns: { id: { type: 'string', primaryKey: true }, total: { type: 'number' } } }));

    const pod = fakePod();
    const step = { mutate_schema: { table: 'quotes', change: { column: 'total', type: 'string' } } };
    const args = base(step, pod, { run: { dataDir } });
    await runStep(args);

    expect(args.rec.mutateSchema.table).toBe('quotes');
    const schema = JSON.parse(readFileSync(schemaPath, 'utf8'));
    expect(schema.columns.total.type).toBe('string');
  });
});

// ── space_session: a real ThingSession + a fake session-pod (no HTTP), proving the diversion is
// scoped to just this step and `thing` itself is returned unchanged. ──────────────────────────────
class FakeSessionPod {
  constructor() {
    this.calls = [];
    this.sessionCount = 0;
    this.messaged = new Set(); // sessions a message was actually POSTed to
    this.emittedFor = new Set(); // sessions whose one canned reply event was already returned
  }
  async req(method, path, body) {
    this.calls.push({ method, path, body });
    if (method === 'POST' && path === '/api/sessions') {
      this.sessionCount += 1;
      return { sessionId: `s${this.sessionCount}` };
    }
    const msgMatch = /^\/api\/sessions\/(s\d+)\/message$/.exec(path);
    if (method === 'POST' && msgMatch) {
      this.messaged.add(msgMatch[1]);
      return { ok: true };
    }
    const eventsMatch = /^\/api\/sessions\/(s\d+)\/events/.exec(path);
    if (method === 'GET' && eventsMatch) {
      const sid = eventsMatch[1];
      // Only emit the canned "reply" once a message was actually SENT to this session — otherwise
      // `syncToTail()` (called right after `start()`, before any message) consumes it as if it were
      // replayed history, and the real turn afterward never sees any work.
      if (this.messaged.has(sid) && !this.emittedFor.has(sid)) {
        this.emittedFor.add(sid);
        return { events: [{ seq: 1, event: { type: 'display', descriptor: { props: { text: `reply from ${sid}` } } } }], lastSeq: 1 };
      }
      return { events: [], lastSeq: this.emittedFor.has(sid) ? 1 : 0 };
    }
    if (method === 'GET' && /\/asks\?/.test(path)) return { asks: [] };
    if (method === 'GET' && path === '/api/sessions') {
      return { sessions: [...Array(this.sessionCount)].map((_, i) => ({ sessionId: `s${i + 1}`, status: 'idle' })) };
    }
    throw new Error(`FakeSessionPod: unhandled ${method} ${path}`);
  }
}

describe('runStep — space_session', () => {
  it('diverts say to a NEW session bound via spaceRef, and returns `thing` UNCHANGED', async () => {
    const pod = new FakeSessionPod();
    const thing = new ThingSession(pod, {});
    await thing.start(); // s1

    const args = base({ space_session: 'stock/advisor', say: 'what is whiteware?' }, pod, { thing });
    const returned = await runStep(args);

    expect(returned).toBe(thing); // not replaced — the diversion is scoped to this step only
    expect(args.rec.spaceSession).toBe('stock/advisor');
    expect(args.rec.turns[0].sent).toBe('[stock/advisor] what is whiteware?');

    const createCalls = pod.calls.filter((c) => c.method === 'POST' && c.path === '/api/sessions');
    expect(createCalls).toHaveLength(2); // thing's own session, then the probe
    expect(createCalls[1].body.spaceRef).toBe('stock/advisor');
  }, 15000);
});
