/**
 * Inbound-webhook Phase 1+2 (pod side) — offline, deterministic. Covers:
 *   - `validateHook` accepts a valid `webhook` def and rejects missing
 *     `path`/`trigger` and a bad `path` (non-URL-safe chars);
 *   - `buildWebhookManifest` throws fail-loud on a duplicate `path` across two
 *     projects, and otherwise returns the correct flat bindings;
 *   - `resolveBinding` finds the right project/agentRef by `path`;
 *   - `createInboundHandler` routes threaded (same `x-lmthing-thread` header
 *     → same `sessionId` via `runHeadlessThreaded`) vs. stateless (no thread
 *     header → `runHeadless`) events (Phase 2).
 *   - Phase 3: a SPACE agent's `triggers:` frontmatter (no `hooks/*.ts` file)
 *     is scanned into the same manifest and resolved the same way, and a path
 *     collision between a hook and a space trigger is fail-loud too.
 */
import { describe, it, expect, afterAll } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { validateHook } from '../app/hooks/loader.js';
import { buildWebhookManifest, resolveBinding } from './webhook-manifest.js';
import { createInboundHandler, type InboundManager } from './routes/webhooks.js';

const tmpDirs: string[] = [];
afterAll(async () => {
  await Promise.all(tmpDirs.map((d) => rm(d, { recursive: true, force: true })));
});

async function makeRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'lmthing-webhook-'));
  tmpDirs.push(root);
  return root;
}

async function writeHook(root: string, projectId: string, slug: string, source: string): Promise<void> {
  const dir = join(root, projectId, 'hooks');
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, `${slug}.ts`), source, 'utf8');
}

/** Write a minimal space agent whose `instruct.md` frontmatter declares a
 *  `triggers:` webhook binding (Phase 3 — no `hooks/*.ts` file needed). */
async function writeSpaceAgentTrigger(
  root: string,
  projectId: string,
  spaceId: string,
  agentSlug: string,
  path: string,
  provider?: string,
): Promise<void> {
  const dir = join(root, projectId, 'spaces', spaceId, 'agents', agentSlug);
  await mkdir(dir, { recursive: true });
  const webhookLine = provider ? `{ path: ${path}, provider: ${provider} }` : `{ path: ${path} }`;
  await writeFile(
    join(dir, 'instruct.md'),
    `---\ntitle: ${agentSlug}\ntriggers:\n  - webhook: ${webhookLine}\n---\nbody`,
    'utf8',
  );
}

describe('validateHook — webhook', () => {
  const ok = (raw: unknown) => validateHook('s', '/f.ts', raw);
  const bad = (raw: unknown) => () => validateHook('s', '/f.ts', raw);

  it('accepts a valid webhook def', () => {
    expect(ok({ type: 'webhook', path: 'stripe-events', trigger: 'billing/handler#onEvent' })).toMatchObject({
      type: 'webhook',
      path: 'stripe-events',
      trigger: 'billing/handler#onEvent',
    });
    expect(
      ok({ type: 'webhook', path: 'gh_events-1', provider: 'github', trigger: 'x/y#z', budget: { maxEpisodes: 5 } }),
    ).toMatchObject({ type: 'webhook', provider: 'github', budget: { maxEpisodes: 5 } });
  });

  it('rejects a missing path', () => {
    expect(bad({ type: 'webhook', trigger: 'x/y#z' })).toThrow(/non-empty `path`/);
    expect(bad({ type: 'webhook', path: '', trigger: 'x/y#z' })).toThrow(/non-empty `path`/);
  });

  it('rejects a missing trigger', () => {
    expect(bad({ type: 'webhook', path: 'ok-path' })).toThrow(/non-empty `trigger`/);
  });

  it('rejects a path with non-URL-safe characters', () => {
    expect(bad({ type: 'webhook', path: 'bad/path', trigger: 'x/y#z' })).toThrow(/invalid `path`/);
    expect(bad({ type: 'webhook', path: 'bad path', trigger: 'x/y#z' })).toThrow(/invalid `path`/);
  });
});

describe('buildWebhookManifest', () => {
  it('returns correct bindings across projects', async () => {
    const root = await makeRoot();
    await writeHook(
      root,
      'proj-a',
      'incoming',
      `export default { type: 'webhook', path: 'from-a', trigger: 'billing/handler#onEvent' }`,
    );
    await writeHook(
      root,
      'proj-b',
      'incoming',
      `export default { type: 'webhook', path: 'from-b', provider: 'github', trigger: 'issues/bot#onIssue' }`,
    );

    const bindings = await buildWebhookManifest(root, ['proj-a', 'proj-b']);
    expect(bindings).toHaveLength(2);
    expect(bindings).toContainEqual({
      projectId: 'proj-a',
      path: 'from-a',
      provider: 'generic',
      agentRef: 'billing/handler#onEvent',
    });
    expect(bindings).toContainEqual({
      projectId: 'proj-b',
      path: 'from-b',
      provider: 'github',
      agentRef: 'issues/bot#onIssue',
    });
  });

  it('throws fail-loud on a duplicate path across two projects', async () => {
    const root = await makeRoot();
    await writeHook(
      root,
      'proj-a',
      'incoming',
      `export default { type: 'webhook', path: 'dup', trigger: 'a/h#e' }`,
    );
    await writeHook(
      root,
      'proj-b',
      'incoming',
      `export default { type: 'webhook', path: 'dup', trigger: 'b/h#e' }`,
    );

    await expect(buildWebhookManifest(root, ['proj-a', 'proj-b'])).rejects.toThrow(/proj-a.*proj-b|proj-b.*proj-a/s);
  });

  // ── Phase 3: space-agent `triggers:` frontmatter ──────────────────────────

  it('includes a space agent trigger binding (no hooks/*.ts file)', async () => {
    const root = await makeRoot();
    await writeSpaceAgentTrigger(root, 'proj-a', 'space', 'agent', 'from-space', 'slack');

    const bindings = await buildWebhookManifest(root, ['proj-a']);
    expect(bindings).toContainEqual({
      projectId: 'proj-a',
      path: 'from-space',
      provider: 'slack',
      agentRef: 'space/agent',
    });
  });

  it('defaults a space trigger provider to "generic" when omitted', async () => {
    const root = await makeRoot();
    await writeSpaceAgentTrigger(root, 'proj-a', 'space', 'agent', 'from-space-2');

    const bindings = await buildWebhookManifest(root, ['proj-a']);
    expect(bindings).toContainEqual({
      projectId: 'proj-a',
      path: 'from-space-2',
      provider: 'generic',
      agentRef: 'space/agent',
    });
  });

  it('throws fail-loud on a duplicate path across a hook and a space trigger', async () => {
    const root = await makeRoot();
    await writeHook(
      root,
      'proj-a',
      'incoming',
      `export default { type: 'webhook', path: 'dup-mixed', trigger: 'a/h#e' }`,
    );
    await writeSpaceAgentTrigger(root, 'proj-b', 'space', 'agent', 'dup-mixed');

    await expect(buildWebhookManifest(root, ['proj-a', 'proj-b'])).rejects.toThrow(
      /proj-a.*proj-b|proj-b.*proj-a/s,
    );
  });
});

describe('resolveBinding', () => {
  it('finds the right project/agentRef by path', async () => {
    const root = await makeRoot();
    await writeHook(
      root,
      'proj-a',
      'incoming',
      `export default { type: 'webhook', path: 'from-a', trigger: 'billing/handler#onEvent' }`,
    );
    await writeHook(
      root,
      'proj-b',
      'incoming',
      `export default { type: 'webhook', path: 'from-b', provider: 'github', trigger: 'issues/bot#onIssue' }`,
    );

    const hit = await resolveBinding(root, ['proj-a', 'proj-b'], 'from-b');
    expect(hit).toMatchObject({ projectId: 'proj-b', agentRef: 'issues/bot#onIssue', provider: 'github' });

    const miss = await resolveBinding(root, ['proj-a', 'proj-b'], 'nope');
    expect(miss).toBeNull();
  });

  it('resolves a space-agent trigger path when no hook matches (Phase 3)', async () => {
    const root = await makeRoot();
    await writeHook(
      root,
      'proj-a',
      'incoming',
      `export default { type: 'webhook', path: 'from-a', trigger: 'billing/handler#onEvent' }`,
    );
    await writeSpaceAgentTrigger(root, 'proj-b', 'space', 'agent', 'from-space');

    const hit = await resolveBinding(root, ['proj-a', 'proj-b'], 'from-space');
    expect(hit).toMatchObject({ projectId: 'proj-b', agentRef: 'space/agent', provider: 'generic' });
  });
});

// ── Handler wiring: POST /api/inbound/:path end-to-end (fake req/res + manager) ──

/** A fake IncomingMessage: async-iterable body (what `readBody` consumes) + headers. */
function fakeReq(body: string, headers: Record<string, string> = {}): IncomingMessage {
  async function* gen() {
    yield Buffer.from(body, 'utf8');
  }
  const req = gen() as unknown as IncomingMessage;
  (req as unknown as { headers: Record<string, string> }).headers = headers;
  return req;
}

/** A fake ServerResponse capturing status + JSON body. */
function fakeRes(): { res: ServerResponse; get: () => { status: number; body: unknown } } {
  let status = 0;
  let body: unknown;
  const res = {
    writeHead(s: number) {
      status = s;
    },
    end(data?: string) {
      body = data ? JSON.parse(data) : undefined;
    },
  } as unknown as ServerResponse;
  return { res, get: () => ({ status, body }) };
}

describe('createInboundHandler — POST /api/inbound/:path', () => {
  it('renders the payload into the agent message and routes to the bound agent', async () => {
    const root = await makeRoot();
    await writeHook(
      root,
      'crm',
      'on-lead',
      `export default { type: 'webhook', path: 'lead', trigger: 'intake/handler#onLead', budget: { maxEpisodes: 3 } }`,
    );

    const calls: Array<Record<string, unknown>> = [];
    const manager: InboundManager = {
      listProjects: async () => [{ id: 'crm' }, { id: 'system' }],
      runHeadless: async (args) => {
        calls.push(args);
        return { ok: true, result: 'handled', sessionId: 'sess-1' };
      },
      runHeadlessThreaded: async () => {
        throw new Error('unexpected: no thread key on this request');
      },
    };

    const handler = createInboundHandler(manager, root);
    const { res, get } = fakeRes();
    const payload = JSON.stringify({ email: 'a@b.co', name: 'Ada' });
    await handler(fakeReq(payload, { 'content-type': 'application/json' }), res, { path: 'lead' });

    const { status, body } = get();
    expect(status).toBe(200);
    expect(body).toMatchObject({ ok: true, result: 'handled', sessionId: 'sess-1' });

    expect(calls).toHaveLength(1);
    const arg = calls[0]!;
    // parseTrigger: spaceRef = everything before '#'; agentSlug = its last path
    // segment (runHeadless resolves the space dir from spaceRef's first segment).
    expect(arg).toMatchObject({
      projectId: 'crm',
      spaceRef: 'intake/handler',
      agentSlug: 'handler',
      budget: { maxEpisodes: 3 },
    });
    // The raw payload is embedded verbatim in the agent message.
    expect(String(arg['message'])).toContain(payload);
    expect(String(arg['message'])).toContain('lead');
  });

  it('returns 404 for an unknown path and never runs an agent', async () => {
    const root = await makeRoot();
    await writeHook(
      root,
      'crm',
      'on-lead',
      `export default { type: 'webhook', path: 'lead', trigger: 'intake/handler#onLead' }`,
    );

    let ran = false;
    const manager: InboundManager = {
      listProjects: async () => [{ id: 'crm' }],
      runHeadless: async () => {
        ran = true;
        return { ok: true };
      },
      runHeadlessThreaded: async () => {
        ran = true;
        return { ok: true };
      },
    };

    const handler = createInboundHandler(manager, root);
    const { res, get } = fakeRes();
    await handler(fakeReq('{}'), res, { path: 'nope' });

    expect(get().status).toBe(404);
    expect(ran).toBe(false);
  });

  it('returns 404 when no project root is configured', async () => {
    const manager: InboundManager = {
      listProjects: async () => [],
      runHeadless: async () => ({ ok: true }),
      runHeadlessThreaded: async () => ({ ok: true }),
    };
    const handler = createInboundHandler(manager, undefined);
    const { res, get } = fakeRes();
    await handler(fakeReq('{}'), res, { path: 'lead' });
    expect(get().status).toBe(404);
  });

  // ── Phase 2: threading ──────────────────────────────────────────────────

  it('routes repeated events carrying the same thread header to runHeadlessThreaded with the SAME sessionId', async () => {
    const root = await makeRoot();
    await writeHook(
      root,
      'crm',
      'on-lead',
      `export default { type: 'webhook', path: 'lead', trigger: 'intake/handler#onLead' }`,
    );

    const threadedCalls: Array<Record<string, unknown>> = [];
    const headlessCalls: Array<Record<string, unknown>> = [];
    const manager: InboundManager = {
      listProjects: async () => [{ id: 'crm' }],
      runHeadless: async (args) => {
        headlessCalls.push(args);
        return { ok: true, result: 'one-shot', sessionId: 'ephemeral' };
      },
      runHeadlessThreaded: async (args) => {
        threadedCalls.push(args);
        return { ok: true, result: 'threaded', sessionId: args.sessionId };
      },
    };

    const handler = createInboundHandler(manager, root);
    const headers = { 'content-type': 'application/json', 'x-lmthing-thread': 'conv-42' };

    const { res: res1, get: get1 } = fakeRes();
    await handler(fakeReq(JSON.stringify({ n: 1 }), headers), res1, { path: 'lead' });
    const { res: res2, get: get2 } = fakeRes();
    await handler(fakeReq(JSON.stringify({ n: 2 }), headers), res2, { path: 'lead' });

    expect(get1().status).toBe(200);
    expect(get2().status).toBe(200);
    expect(headlessCalls).toHaveLength(0);
    expect(threadedCalls).toHaveLength(2);

    const first = threadedCalls[0]!;
    const second = threadedCalls[1]!;
    expect(first['sessionId']).toBeTruthy();
    expect(second['sessionId']).toBe(first['sessionId']);
    expect(first).toMatchObject({ projectId: 'crm', spaceRef: 'intake/handler', agentSlug: 'handler' });
  });

  it('routes an event with no thread key to the stateless runHeadless path', async () => {
    const root = await makeRoot();
    await writeHook(
      root,
      'crm',
      'on-lead',
      `export default { type: 'webhook', path: 'lead', trigger: 'intake/handler#onLead' }`,
    );

    const threadedCalls: Array<Record<string, unknown>> = [];
    const headlessCalls: Array<Record<string, unknown>> = [];
    const manager: InboundManager = {
      listProjects: async () => [{ id: 'crm' }],
      runHeadless: async (args) => {
        headlessCalls.push(args);
        return { ok: true, result: 'one-shot', sessionId: 'ephemeral' };
      },
      runHeadlessThreaded: async (args) => {
        threadedCalls.push(args);
        return { ok: true, result: 'threaded', sessionId: args.sessionId };
      },
    };

    const handler = createInboundHandler(manager, root);
    const { res, get } = fakeRes();
    await handler(fakeReq(JSON.stringify({ n: 1 }), { 'content-type': 'application/json' }), res, { path: 'lead' });

    expect(get().status).toBe(200);
    expect(threadedCalls).toHaveLength(0);
    expect(headlessCalls).toHaveLength(1);
  });
});
