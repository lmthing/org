import { describe, it, expect, afterAll } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { runTasklist } from './orchestrator.js';
import { ForkEngine } from '../fork/fork.js';
import { loadSpace } from '../spaces/load.js';
import { createMockStreamFn } from '../testing/mock-provider.js';
import type { RenderHost } from '../session/types.js';
import type { StreamOpts } from '../eval/stream-types.js';

/**
 * Coverage for the host-driven `forEach` map node and per-task `role`/`functions`
 * scoping (the new authoring primitives). Drives the REAL runTasklist + ForkEngine
 * with the scripted mock provider — no API keys.
 */

const tmpDirs: string[] = [];
afterAll(async () => {
  await Promise.all(tmpDirs.map((d) => rm(d, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })));
});

async function makeTasklistSpace(files: Record<string, string>): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'lmthing-foreach-'));
  tmpDirs.push(dir);
  await mkdir(join(dir, 'agents', 'main'), { recursive: true });
  await writeFile(join(dir, 'agents', 'main', 'instruct.md'), 'You are a runner.\n', 'utf8');
  const tl = join(dir, 'tasklists', 'flow');
  await mkdir(tl, { recursive: true });
  for (const [name, contents] of Object.entries(files)) {
    await writeFile(join(tl, name), contents, 'utf8');
  }
  return dir;
}

const silentHost: RenderHost = { display: () => {}, ask: async () => undefined, log: () => {} };

describe('forEach map node', () => {
  it('fans a task out once per element and collects the results into an array', async () => {
    const dir = await makeTasklistSpace({
      '01-list.md': `---\nid: list\noutput:\n  items: array\n---\n\nLIST_T: produce the list.`,
      '02-square.md': `---\nid: square\ndependsOn: [list]\nforEach: list.items\noutput:\n  n: number\n---\n\nSQUARE_T: square the item.`,
      '03-done.md': `---\nid: done\ndependsOn: [square]\ngoal: true\noutput:\n  total: number\n---\n\nDONE_T: sum the squares.`,
    });
    const space = await loadSpace(dir);
    const seen: string[] = [];
    const streamFn = createMockStreamFn((o: StreamOpts) => {
      const user = o.messages.map((m) => m.content).join('\n');
      if (user.includes('LIST_T')) { seen.push('list'); return `currentTask.resolve({ items: [2, 3, 4] });`; }
      // Each per-element fork sees its element bound as `item`.
      if (user.includes('SQUARE_T')) { seen.push('square'); return `currentTask.resolve({ n: item * item });`; }
      // The dependent task receives `square` as the collected ARRAY of element outputs.
      if (user.includes('DONE_T')) { seen.push('done'); return `currentTask.resolve({ total: square.reduce((s: number, e: { n: number }) => s + e.n, 0) });`; }
      return '';
    });
    const engine = new ForkEngine({
      maxConcurrentForks: 4, parentHistory: [], parentSpaceDir: dir, parentAgentSlug: 'main',
      renderHost: silentHost, streamFn,
    });
    const goal = await runTasklist({ name: 'flow', space, forkEngine: engine });
    // 2²+3²+4² = 29
    expect(goal.data).toEqual({ total: 29 });
    expect(goal.ok).toBe(true);
    expect(goal.degraded).toBe(false);
    // square ran three times (one per element).
    expect(seen.filter((s) => s === 'square')).toHaveLength(3);
  });

  it('runs zero element forks when the source array is empty', async () => {
    const dir = await makeTasklistSpace({
      '01-list.md': `---\nid: list\noutput:\n  items: array\n---\n\nLIST_T: produce the list.`,
      '02-each.md': `---\nid: each\ndependsOn: [list]\nforEach: list.items\ngoal: true\noutput:\n  n: number\n---\n\nEACH_T: per item.`,
    });
    const space = await loadSpace(dir);
    const seen: string[] = [];
    const streamFn = createMockStreamFn((o: StreamOpts) => {
      const user = o.messages.map((m) => m.content).join('\n');
      if (user.includes('LIST_T')) return `currentTask.resolve({ items: [] });`;
      if (user.includes('EACH_T')) { seen.push('each'); return `currentTask.resolve({ n: 1 });`; }
      return '';
    });
    const engine = new ForkEngine({
      maxConcurrentForks: 4, parentHistory: [], parentSpaceDir: dir, parentAgentSlug: 'main',
      renderHost: silentHost, streamFn,
    });
    const goal = await runTasklist({ name: 'flow', space, forkEngine: engine });
    expect(goal.data).toEqual([]); // empty source → empty collected array
    expect(seen).toHaveLength(0); // no element forks dispatched
  });
});

describe('charter + tasklist goal injection into task forks', () => {
  it('injects the parent charter and the tasklist goal, but never raw instruct.md', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'lmthing-foreach-'));
    tmpDirs.push(dir);
    await mkdir(join(dir, 'agents', 'main'), { recursive: true });
    await writeFile(join(dir, 'agents', 'main', 'instruct.md'), 'SECRET_INSTRUCT_BODY: route via delegate and ask the user.\n', 'utf8');
    await writeFile(join(dir, 'agents', 'main', 'charter.md'), 'CHARTER_IDENTITY: you are a precise widget expert.\n', 'utf8');
    const tl = join(dir, 'tasklists', 'flow');
    await mkdir(tl, { recursive: true });
    await writeFile(join(tl, 'index.md'), `---\n---\n\nTASKLIST_GOAL: assemble the widget end to end.`, 'utf8');
    await writeFile(join(tl, '01-only.md'), `---\nid: only\ngoal: true\noutput:\n  v: number\n---\n\nONLY_T: do the step.`, 'utf8');
    const space = await loadSpace(dir);
    let systemSeen = '';
    const streamFn = createMockStreamFn((o: StreamOpts) => {
      systemSeen = o.system ?? '';
      const user = o.messages.map((m) => m.content).join('\n');
      if (user.includes('ONLY_T')) return `currentTask.resolve({ v: 1 });`;
      return '';
    });
    const engine = new ForkEngine({
      maxConcurrentForks: 4, parentHistory: [], parentSpaceDir: dir, parentAgentSlug: 'main',
      parentAgentCharter: space.agents['main']!.charterBody,
      renderHost: silentHost, streamFn,
    });
    await runTasklist({ name: 'flow', space, forkEngine: engine });
    expect(systemSeen).toContain('CHARTER_IDENTITY'); // charter injected
    expect(systemSeen).toContain('TASKLIST_GOAL'); // tasklist index.md goal injected
    expect(systemSeen).not.toContain('SECRET_INSTRUCT_BODY'); // instruct.md NOT injected into forks
  });
});

describe('per-task role + functions scoping', () => {
  it('withholds all generic-fs prompt lines from a non-scratch task (fs is off every fork)', async () => {
    const dir = await makeTasklistSpace({
      '01-probe.md': `---\nid: probe\nrole: explore\ngoal: true\noutput:\n  ok: boolean\n---\n\nPROBE_T: read-only probe.`,
    });
    const space = await loadSpace(dir);
    let systemSeen = '';
    const streamFn = createMockStreamFn((o: StreamOpts) => {
      systemSeen = o.system ?? '';
      const user = o.messages.map((m) => m.content).join('\n');
      if (user.includes('PROBE_T')) {
        // A read-only task must NOT reference writeFileRaw — it is now stripped from
        // the ambient DTS (allowWrite:false), so a stray call would fail typecheck.
        // The capability/DTS gate itself is pinned by bootstrap.test.ts + roles.test.ts;
        // this test owns the PROMPT gate below.
        return `currentTask.resolve({ ok: true });`;
      }
      return '';
    });
    const engine = new ForkEngine({
      maxConcurrentForks: 4, parentHistory: [], parentSpaceDir: dir, parentAgentSlug: 'main',
      renderHost: silentHost, streamFn,
    });
    const goal = (await runTasklist({ name: 'flow', space, forkEngine: engine })).data as { ok: boolean };
    expect(goal.ok).toBe(true);
    // Prompt gate: a non-scratch fork's system prompt does NOT advertise the write
    // primitives (writeFileRaw/readFileRaw are gone entirely) and explicitly tells the
    // fork there is no filesystem and execShell is unavailable.
    expect(systemSeen).not.toMatch(/writeFileRaw|readFileRaw/);
    expect(systemSeen).toMatch(/NO filesystem/i);
    expect(systemSeen).toMatch(/execShell is unavailable/);
  });

  it('injects + advertises only the allowlisted functions', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'lmthing-foreach-'));
    tmpDirs.push(dir);
    await mkdir(join(dir, 'agents', 'main'), { recursive: true });
    await writeFile(join(dir, 'agents', 'main', 'instruct.md'), 'You are a runner.\n', 'utf8');
    await mkdir(join(dir, 'functions'), { recursive: true });
    await writeFile(join(dir, 'functions', 'allowedFn.ts'), 'export function allowedFn(): number { return 7; }\n', 'utf8');
    await writeFile(join(dir, 'functions', 'deniedFn.ts'), 'export function deniedFn(): number { return 9; }\n', 'utf8');
    const tl = join(dir, 'tasklists', 'flow');
    await mkdir(tl, { recursive: true });
    await writeFile(
      join(tl, '01-scoped.md'),
      `---\nid: scoped\nrole: general\nfunctions: [allowedFn]\ngoal: true\noutput:\n  v: number\n---\n\nSCOPED_T: call the allowed fn.`,
      'utf8',
    );
    const space = await loadSpace(dir);
    let systemSeen = '';
    const streamFn = createMockStreamFn((o: StreamOpts) => {
      systemSeen = o.system ?? '';
      const user = o.messages.map((m) => m.content).join('\n');
      if (user.includes('SCOPED_T')) return `currentTask.resolve({ v: allowedFn() });`;
      return '';
    });
    const engine = new ForkEngine({
      maxConcurrentForks: 4, parentHistory: [], parentSpaceDir: dir, parentAgentSlug: 'main',
      renderHost: silentHost, streamFn,
      agentFunctions: { allowedFn: 'export function allowedFn(): number { return 7; }', deniedFn: 'export function deniedFn(): number { return 9; }' },
    });
    const goal = (await runTasklist({ name: 'flow', space, forkEngine: engine })).data as { v: number };
    expect(goal.v).toBe(7); // allowlisted fn injected + callable
    expect(systemSeen).toContain('allowedFn');
    expect(systemSeen).not.toContain('deniedFn'); // denied fn neither advertised nor injected
  });
});
