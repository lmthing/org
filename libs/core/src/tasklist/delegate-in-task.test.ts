import { describe, it, expect, afterAll } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { runTasklist } from './orchestrator.js';
import { ForkEngine, resolveTaskDelegate } from '../fork/fork.js';
import { loadSpace } from '../spaces/load.js';
import { createMockStreamFn } from '../testing/mock-provider.js';
import type { RenderHost } from '../session/types.js';
import type { StreamOpts } from '../eval/stream-types.js';

const tmpDirs: string[] = [];
afterAll(async () => { await Promise.all(tmpDirs.map((d) => rm(d, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }))); });
const silentHost: RenderHost = { display: () => {}, ask: async () => undefined, log: () => {} };

async function makeTasklistSpace(files: Record<string, string>): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'lmthing-deleg-'));
  tmpDirs.push(dir);
  await mkdir(join(dir, 'agents', 'main'), { recursive: true });
  await writeFile(join(dir, 'agents', 'main', 'instruct.md'), 'runner\n', 'utf8');
  const tl = join(dir, 'tasklists', 'flow');
  await mkdir(tl, { recursive: true });
  for (const [n, c] of Object.entries(files)) await writeFile(join(tl, n), c, 'utf8');
  return dir;
}

describe('resolveTaskDelegate (allowlist)', () => {
  it('allows a matching target and scopes the action', () => {
    const r = resolveTaskDelegate(['system-research/researcher#deep_research'], 'system-research', 'researcher');
    expect(r).toEqual({ allowedActions: ['deep_research'] });
  });
  it('allows ANY action when the entry has no #action', () => {
    expect(resolveTaskDelegate(['sp/ag'], 'sp', 'ag')).toEqual({ allowedActions: undefined });
  });
  it('denies a target not in the allowlist', () => {
    expect(resolveTaskDelegate(['sp/ag#x'], 'other', 'ag')).toBeNull();
    expect(resolveTaskDelegate(['sp/ag#x'], 'sp', 'nope')).toBeNull();
  });
});

describe('delegate inside a task (canDelegateTo)', () => {
  it('routes an allowed delegate through the engine delegateRunner and returns its result', async () => {
    const dir = await makeTasklistSpace({
      '01-call.md': `---\nid: call\ngoal: true\nrole: general\ncanDelegateTo:\n  - helper/agent#act\noutput:\n  v: number\n---\n\nCALL_T: delegate then resolve.`,
    });
    const space = await loadSpace(dir);
    const calls: Array<{ pkg: string; agent: string; action?: string; allowed?: string[] }> = [];
    // Turn 1: emit the delegate binding (it yields). Turn 2 (after `r` is bound from the resolved
    // delegate): emit the resolve. (A single mock that re-emits both each turn would re-delegate.)
    let turn = 0;
    const streamFn = createMockStreamFn(() => {
      turn++;
      if (turn === 1) return `const r = await delegate('helper', 'agent', 'act', { query: 'hi' });`;
      return `currentTask.resolve({ v: r.n });`;
    });
    const engine = new ForkEngine({
      maxConcurrentForks: 2, parentHistory: [], parentSpaceDir: dir, parentAgentSlug: 'main',
      renderHost: silentHost, streamFn,
      delegateRunner: async (pkg, agent, action, _opts, allowed) => {
        calls.push({ pkg, agent, action, allowed });
        return { n: 42 };
      },
    });
    const goal = (await runTasklist({ name: 'flow', space, forkEngine: engine })).data as { v: number };
    expect(goal).toEqual({ v: 42 });
    expect(calls).toEqual([{ pkg: 'helper', agent: 'agent', action: 'act', allowed: ['act'] }]);
  });

  it('blocks a delegate to a non-allowlisted target (runner never called; fork salvages)', async () => {
    const dir = await makeTasklistSpace({
      '01-call.md': `---\nid: call\ngoal: true\nrole: general\ncanDelegateTo:\n  - helper/agent#act\noutput:\n  v: number\n---\n\nBAD_T: delegate to a forbidden target.`,
    });
    const space = await loadSpace(dir);
    let runnerCalls = 0;
    const streamFn = createMockStreamFn((o: StreamOpts) => {
      const u = o.messages.map((m) => m.content).join('\n');
      // 'evil/agent' is NOT in canDelegateTo → the delegate yield throws, fork never resolves → salvage.
      if (u.includes('BAD_T')) return `const r = await delegate('evil', 'agent', 'act', { query: 'x' }) as { n: number };\ncurrentTask.resolve({ v: r.n });`;
      return '';
    });
    const engine = new ForkEngine({
      maxConcurrentForks: 2, parentHistory: [], parentSpaceDir: dir, parentAgentSlug: 'main',
      renderHost: silentHost, streamFn,
      delegateRunner: async () => { runnerCalls++; return { n: 1 }; },
    });
    const env = await runTasklist({ name: 'flow', space, forkEngine: engine });
    expect(runnerCalls).toBe(0);            // forbidden target never reached the runner
    expect(env.data).toEqual({ v: 0 });     // fork salvaged a NEUTRAL schema-valid placeholder
    expect(env.ok).toBe(false);             // …and the envelope signals the degradation
    expect(env.degraded).toBe(true);
  });

  it('canDelegateTo: ["*"] gives the task an UNSCOPED delegate (any target routes to the runner)', async () => {
    const dir = await makeTasklistSpace({
      '01-call.md': `---\nid: call\ngoal: true\nrole: general\ncanDelegateTo:\n  - "*"\noutput:\n  v: number\n---\n\nSTAR_T: delegate anywhere then resolve.`,
    });
    const space = await loadSpace(dir);
    const calls: Array<{ pkg: string; agent: string; allowed?: string[] }> = [];
    let turn = 0;
    const streamFn = createMockStreamFn(() => {
      turn++;
      if (turn === 1) return `const r = await delegate('any-space-at-all', 'whoever', 'act', { query: 'hi' });`;
      return `currentTask.resolve({ v: r.n });`;
    });
    const engine = new ForkEngine({
      maxConcurrentForks: 2, parentHistory: [], parentSpaceDir: dir, parentAgentSlug: 'main',
      renderHost: silentHost, streamFn,
      delegateRunner: async (pkg, agent, _action, _opts, allowed) => {
        calls.push({ pkg, agent, allowed });
        return { n: 7 };
      },
    });
    const env = await runTasklist({ name: 'flow', space, forkEngine: engine });
    expect(env.ok).toBe(true);
    expect(env.data).toEqual({ v: 7 });
    // Unrestricted: no target gate, no action narrowing.
    expect(calls).toEqual([{ pkg: 'any-space-at-all', agent: 'whoever', allowed: undefined }]);
  });

  it('canDelegateTo: ["registered:*"] admits a dynamicSpaces-registered target and blocks others', async () => {
    const dir = await makeTasklistSpace({
      '01-call.md': `---\nid: call\ngoal: true\nrole: general\ncanDelegateTo:\n  - "registered:*"\noutput:\n  v: number\n---\n\nREG_T: delegate to the registered space.`,
    });
    const space = await loadSpace(dir);
    const regDir = '/dyn/built-space';
    const dynamicSpaces = new Map([[regDir, space]]); // any Space value; the gate matches keys/dirs
    const calls: string[] = [];
    let turn = 0;
    const streamFn = createMockStreamFn((o: StreamOpts) => {
      turn++;
      // Turn 1: an UNREGISTERED target — the gate throws (retryable error).
      if (turn === 1) return `const r = await delegate('never-registered', 'agent', 'act', { query: 'x' });`;
      // Turn 2 (retry with the ERROR block): the registered one.
      if (turn === 2) {
        const last = o.messages[o.messages.length - 1]?.content ?? '';
        if (!last.includes('is not permitted')) return `currentTask.resolve({ v: -1 });`;
        return `const r = await delegate('${regDir}', 'agent', 'act', { query: 'x' });`;
      }
      return `currentTask.resolve({ v: r.n });`;
    });
    const engine = new ForkEngine({
      maxConcurrentForks: 2, parentHistory: [], parentSpaceDir: dir, parentAgentSlug: 'main',
      renderHost: silentHost, streamFn, dynamicSpaces,
      delegateRunner: async (pkg) => { calls.push(pkg); return { n: 9 }; },
    });
    const env = await runTasklist({ name: 'flow', space, forkEngine: engine });
    expect(env.ok).toBe(true);
    expect(env.data).toEqual({ v: 9 });
    expect(calls).toEqual([regDir]); // only the registered target reached the runner
  });
});
