import { describe, it, expect, afterAll, vi } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { runDelegate } from '../delegate/delegate.js';
import { DelegateRegistry } from '../delegate/registry.js';
import { Session } from '../session/session.js';
import { loadSpace } from '../spaces/load.js';
import { createMockStreamFn } from '../testing/mock-provider.js';
import type { RenderHost } from '../session/types.js';
import type { StreamOpts } from '../eval/stream-types.js';
import type { Space, AgentDef } from '../spaces/load.js';

/**
 * Phase 5 — unified `canDelegateTo` semantics, enforced END TO END:
 *
 *   | value          | agent level                        | task level     |
 *   |----------------|------------------------------------|----------------|
 *   | omitted        | unrestricted (back-compat)         | none           |
 *   | []             | none (global withheld + no DTS)    | none           |
 *   | ["*"]          | unrestricted                       | unrestricted   |
 *   | explicit list  | hard allowlist (yield-time gate)   | allowlist      |
 *   | registered:*   | any runtime-registered space       | same           |
 *
 * These tests drive the two AGENT-level enforcement points (the delegate VM in
 * delegate.ts and the top-level session VM in session.ts) with the scripted
 * mock provider; the task-level points live in tasklist/delegate-in-task.test.ts
 * and the pure policy functions in exec/target-match.test.ts.
 */

const silentHost: RenderHost = { display: () => {}, ask: async () => undefined, log: () => {} };
const tmpDirs: string[] = [];
afterAll(async () => { await Promise.all(tmpDirs.map((d) => rm(d, { recursive: true, force: true }))); });

/** The LAST user message — what this turn is responding to (ERROR block,
 *  VARIABLES block, or the opening task). Branching on it (not the whole
 *  history) keeps turn scripts from re-firing on stale history text. */
const lastUser = (o: StreamOpts): string =>
  [...o.messages].reverse().find((m) => m.role === 'user')?.content ?? '';

function fakeAgent(slug: string, opts: { actions?: string[]; canDelegateTo?: string[] } = {}): AgentDef {
  const agent: AgentDef = {
    slug,
    title: slug,
    instructBody: '',
    charterBody: '',
    actions: (opts.actions ?? []).map((id) => ({ id, label: id, description: '', tasklist: '' })),
    config: { knowledge: [], functions: [], components: [] },
  };
  // Omitted vs [] is semantic — only set the key when the test declares it.
  if (opts.canDelegateTo !== undefined) agent.canDelegateTo = opts.canDelegateTo;
  return agent;
}

function fakeSpace(dir: string, agents: Record<string, AgentDef>): Space {
  return {
    dir,
    packageName: undefined,
    agents,
    tasklists: {},
    functions: {},
    functionsBundled: {},
    dependentSpaces: {},
    components: { view: {}, form: {} },
    knowledge: { domains: {} },
  } as Space;
}

/** A helper target space every test can delegate to. */
function helperSpace(dir = '/pol/helperspace'): Space {
  return fakeSpace(dir, { helper: fakeAgent('helper', { actions: ['act'] }) });
}

interface DelegateRun {
  result: unknown;
  /** The last-user-message of every model call, in call order (parent + child). */
  turns: string[];
  /** The system block of every model call. */
  systems: string[];
}

/**
 * Run a PARENT agent (with the given canDelegateTo) as a delegate; its scripted
 * model reacts per `parentCode(lastUserMessage)`. Child turns (matched on
 * "Run action: act") resolve `{ from: 'child' }`.
 */
async function runParent(opts: {
  canDelegateTo?: string[];
  parentCode: (last: string) => string;
  registrySpaces?: Map<string, Space>;
  dynamicSpaces?: Map<string, Space>;
}): Promise<DelegateRun> {
  const parentDir = '/pol/parentspace';
  const parentOpts: { actions?: string[]; canDelegateTo?: string[] } = {};
  if (opts.canDelegateTo !== undefined) parentOpts.canDelegateTo = opts.canDelegateTo;
  const parent = fakeSpace(parentDir, { parent: fakeAgent('parent', parentOpts) });
  const spaces = new Map<string, Space>([[parentDir, parent], ...(opts.registrySpaces ?? new Map())]);
  const registry = new DelegateRegistry(spaces);

  const turns: string[] = [];
  const systems: string[] = [];
  const streamFn = createMockStreamFn((o: StreamOpts) => {
    const last = lastUser(o);
    turns.push(last);
    systems.push(o.system ?? '');
    if (last.includes('Run action: act')) return `currentTask.resolve({ from: 'child' });`;
    return opts.parentCode(last);
  });

  const result = await runDelegate({
    packageName: parentDir,
    agentName: 'parent',
    registry,
    renderHost: silentHost,
    streamFn,
    depth: 0,
    maxDepth: 5,
    maxConcurrentForks: 2,
    dynamicSpaces: opts.dynamicSpaces,
  });
  return { result, turns, systems };
}

// ---------------------------------------------------------------------------
// Agent level, delegate VM (delegate.ts)
// ---------------------------------------------------------------------------

describe('agent-level canDelegateTo: [] (no delegation)', () => {
  it('the delegated agent VM has NO delegate global, and the prompt does not advertise it', async () => {
    const { result, systems } = await runParent({
      canDelegateTo: [],
      parentCode: () => `currentTask.resolve({ t: typeof (globalThis as any).delegate });`,
    });
    expect(result).toEqual({ t: 'undefined' });
    expect(systems[0]).not.toContain('`delegate(');
  });

  it('a scripted delegate() statement fails TYPECHECK (not at runtime) and the model recovers', async () => {
    const { result, turns } = await runParent({
      canDelegateTo: [],
      registrySpaces: new Map([['/pol/helperspace', helperSpace()]]),
      parentCode: (last) => {
        if (last.includes('ERROR')) return `currentTask.resolve({ note: 'recovered' });`;
        return `const r = await delegate('helperspace', 'helper', 'act', { query: 'x' });`;
      },
    });
    expect(result).toEqual({ note: 'recovered' });
    // The failure was a TYPECHECK error (delegate absent from the ambient DTS),
    // not a runtime/gate error — the stray call never reached the yield layer.
    const errTurn = turns.find((t) => t.includes('ERROR'));
    expect(errTurn).toContain("Cannot find name 'delegate'");
    // The child never ran.
    expect(turns.some((t) => t.includes('Run action: act'))).toBe(false);
  });
});

describe('agent-level allowlist', () => {
  it('an out-of-list target throws an actionable error naming the allowed targets (retryable)', async () => {
    const { result, turns } = await runParent({
      canDelegateTo: ['helperspace/helper'],
      registrySpaces: new Map([['/pol/helperspace', helperSpace()]]),
      parentCode: (last) => {
        if (last.includes('is not permitted')) {
          // Self-correct to the allowed target on the retry.
          return `const r = await delegate('helperspace', 'helper', 'act', { query: 'x' });`;
        }
        if (last.includes('VARIABLES')) return `currentTask.resolve({ got: (r as any).from });`;
        return `const r = await delegate('evilspace', 'villain', 'act', { query: 'x' });`;
      },
    });
    expect(result).toEqual({ got: 'child' });
    const errTurn = turns.find((t) => t.includes('is not permitted'));
    expect(errTurn).toContain('delegate("evilspace", "villain")');
    expect(errTurn).toContain('allowed targets: helperspace/helper');
  });

  it('an in-list target succeeds and #action entries narrow the allowed actions', async () => {
    // The entry allows only #act — a call with action 'other' passes the target
    // gate but is rejected by the allowedActions narrowing inside runDelegate.
    const { result, turns } = await runParent({
      canDelegateTo: ['helperspace/helper#act'],
      registrySpaces: new Map([['/pol/helperspace', helperSpace()]]),
      parentCode: (last) => {
        if (last.includes('does not allow action')) {
          return `const r = await delegate('helperspace', 'helper', 'act', { query: 'x' });`;
        }
        if (last.includes('VARIABLES')) return `currentTask.resolve({ got: (r as any).from });`;
        return `const r = await delegate('helperspace', 'helper', 'other', { query: 'x' });`;
      },
    });
    expect(result).toEqual({ got: 'child' });
    expect(turns.some((t) => t.includes('does not allow action "other"'))).toBe(true);
  });
});

describe('agent-level ["*"] and omitted (unrestricted)', () => {
  it('["*"] delegates to any target', async () => {
    const { result } = await runParent({
      canDelegateTo: ['*'],
      registrySpaces: new Map([['/pol/helperspace', helperSpace()]]),
      parentCode: (last) => {
        if (last.includes('VARIABLES')) return `currentTask.resolve({ got: (r as any).from });`;
        return `const r = await delegate('helperspace', 'helper', 'act', { query: 'x' });`;
      },
    });
    expect(result).toEqual({ got: 'child' });
  });

  it('omitted stays unrestricted (back-compat lock for user spaces on disk)', async () => {
    const { result } = await runParent({
      // canDelegateTo deliberately NOT set
      registrySpaces: new Map([['/pol/helperspace', helperSpace()]]),
      parentCode: (last) => {
        if (last.includes('VARIABLES')) return `currentTask.resolve({ got: (r as any).from });`;
        return `const r = await delegate('helperspace', 'helper', 'act', { query: 'x' });`;
      },
    });
    expect(result).toEqual({ got: 'child' });
  });
});

describe('agent-level registered:*', () => {
  const regDir = '/dyn/regspace';

  it('allows delegation to a dynamicSpaces-registered space', async () => {
    const reg = helperSpace(regDir);
    const { result } = await runParent({
      canDelegateTo: ['registered:*'],
      registrySpaces: new Map([[regDir, reg]]),
      dynamicSpaces: new Map([[regDir, reg]]),
      parentCode: (last) => {
        if (last.includes('VARIABLES')) return `currentTask.resolve({ got: (r as any).from });`;
        return `const r = await delegate('${regDir}', 'helper', 'act', { query: 'x' });`;
      },
    });
    expect(result).toEqual({ got: 'child' });
  });

  it('the SAME registered target is denied when registered:* is absent (and it is not listed)', async () => {
    const reg = helperSpace(regDir);
    const { result, turns } = await runParent({
      canDelegateTo: ['someother/agent'],
      registrySpaces: new Map([[regDir, reg]]),
      dynamicSpaces: new Map([[regDir, reg]]),
      parentCode: (last) => {
        if (last.includes('is not permitted')) return `currentTask.resolve({ note: 'denied' });`;
        return `const r = await delegate('${regDir}', 'helper', 'act', { query: 'x' });`;
      },
    });
    expect(result).toEqual({ note: 'denied' });
    expect(turns.some((t) => t.includes('allowed targets: someother/agent'))).toBe(true);
  });

  it('an UNREGISTERED target is denied when only registered:* is granted', async () => {
    const { result, turns } = await runParent({
      canDelegateTo: ['registered:*'],
      registrySpaces: new Map([['/pol/helperspace', helperSpace()]]),
      dynamicSpaces: new Map(), // nothing registered
      parentCode: (last) => {
        if (last.includes('is not permitted')) return `currentTask.resolve({ note: 'denied' });`;
        return `const r = await delegate('helperspace', 'helper', 'act', { query: 'x' });`;
      },
    });
    expect(result).toEqual({ note: 'denied' });
    expect(turns.some((t) => t.includes('registerSpace()'))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Agent level, top-level SESSION VM (session.ts)
// ---------------------------------------------------------------------------

/** On-disk space whose `main` agent carries the given extra frontmatter lines. */
async function makeSessionSpace(frontmatter: string, body = 'Test agent.'): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'lmthing-policy-'));
  tmpDirs.push(dir);
  const file = join(dir, 'agents', 'main', 'instruct.md');
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, `---\ntitle: Main\n${frontmatter}\n---\n\n${body}\n`, 'utf8');
  return dir;
}

/** On-disk worker space to delegate to (resolved lazily by dir path). */
async function makeWorkerSpace(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'lmthing-policy-worker-'));
  tmpDirs.push(dir);
  const file = join(dir, 'agents', 'worker', 'instruct.md');
  await mkdir(dirname(file), { recursive: true });
  await writeFile(
    file,
    `---\ntitle: Worker\nactions:\n  - id: compute\n    label: Compute\n    description: Compute\n---\n\nWorker.\n`,
    'utf8',
  );
  return dir;
}

async function runSession(
  spaceDir: string,
  streamFn: ReturnType<typeof createMockStreamFn>,
): Promise<{ displays: unknown[]; error?: Error }> {
  const displays: unknown[] = [];
  const session = new Session(
    {
      spaceDir,
      agentSlug: 'main',
      modelAlias: 'mock',
      renderHost: { display: (d) => { displays.push(d); }, ask: async () => undefined, log: () => {} },
      systemSpaceDirs: [],
    },
    { streamFn },
  );
  let error: Error | undefined;
  try {
    await session.start('go');
  } catch (e) {
    error = e as Error;
  }
  session.dispose();
  return { displays, error };
}

describe('session-level enforcement (top-level VM)', () => {
  it('canDelegateTo: [] — no delegate global in the session VM; a stray call fails typecheck', async () => {
    const spaceDir = await makeSessionSpace('canDelegateTo: []');
    const turns: string[] = [];
    const streamFn = createMockStreamFn((o: StreamOpts) => {
      const last = lastUser(o);
      turns.push(last);
      if (last.includes('ERROR')) return `display("t=" + typeof (globalThis as any).delegate);`;
      return `const r = await delegate('anything', 'agent', { query: 'x' });`;
    });
    const { displays, error } = await runSession(spaceDir, streamFn);
    expect(error).toBeUndefined();
    expect(displays).toContain('t=undefined'); // global truly withheld at injection
    expect(turns.some((t) => t.includes("Cannot find name 'delegate'"))).toBe(true);
  });

  it('allowlist — an out-of-list session delegate throws naming the allowed targets; in-list works', async () => {
    const workerDir = await makeWorkerSpace();
    const spaceDir = await makeSessionSpace(`canDelegateTo:\n  - ${workerDir}/worker`);
    const turns: string[] = [];
    const streamFn = createMockStreamFn((o: StreamOpts) => {
      const last = lastUser(o);
      turns.push(last);
      if (last.includes('Run action: compute')) return `currentTask.resolve({ v: 11 });`;
      if (last.includes('is not permitted')) {
        return `const r = await delegate(${JSON.stringify(workerDir)}, 'worker', 'compute', { query: 'x' });`;
      }
      if (last.includes('VARIABLES')) return `display("v=" + (r as any).v);`;
      return `const r = await delegate('/not/allowed', 'worker', 'compute', { query: 'x' });`;
    });
    const { displays, error } = await runSession(spaceDir, streamFn);
    expect(error).toBeUndefined();
    expect(displays).toContain('v=11');
    const errTurn = turns.find((t) => t.includes('is not permitted'));
    expect(errTurn).toContain(`allowed targets: ${workerDir}/worker`);
  });
});

// ---------------------------------------------------------------------------
// Loader — omitted/[] preservation + the migration warning
// ---------------------------------------------------------------------------

describe('loader canDelegateTo handling', () => {
  it('preserves the omitted-vs-empty distinction on AgentDef', async () => {
    const omitted = await loadSpace(await makeSessionSpace('knowledge: []'));
    expect(omitted.agents['main']!.canDelegateTo).toBeUndefined();

    const empty = await loadSpace(await makeSessionSpace('canDelegateTo: []'), { onWarn: () => {} });
    expect(empty.agents['main']!.canDelegateTo).toEqual([]);

    const listed = await loadSpace(await makeSessionSpace('canDelegateTo:\n  - sp/ag'));
    expect(listed.agents['main']!.canDelegateTo).toEqual(['sp/ag']);
  });

  it('warns on canDelegateTo: [] ONLY when the instruct body calls delegate() (the confusing combo)', async () => {
    const onWarn = vi.fn();
    // Body calls delegate() while frontmatter forbids delegation → warn.
    await loadSpace(
      await makeSessionSpace('canDelegateTo: []', "Call `await delegate('sp', 'ag', { query })` to hand off."),
      { onWarn },
    );
    expect(onWarn).toHaveBeenCalledTimes(1);
    expect(onWarn.mock.calls[0]![0]).toContain('canDelegateTo: [] means no delegation');
    expect(onWarn.mock.calls[0]![0]).toContain('agent "main"');
  });

  it('does NOT warn on canDelegateTo: [] for a non-delegating agent (hard none is the correct declaration)', async () => {
    const onWarn = vi.fn();
    // Generated specialists + researcher/engineer/memory declare [] and never
    // delegate — a per-agent warning there is pure noise.
    await loadSpace(await makeSessionSpace('canDelegateTo: []'), { onWarn });
    expect(onWarn).not.toHaveBeenCalled();
  });

  it('defaults the warn channel to console.warn', async () => {
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      await loadSpace(await makeSessionSpace('canDelegateTo: []', 'Try `delegate("sp", "ag")` for handoff.'));
      expect(spy).toHaveBeenCalled();
      expect(String(spy.mock.calls.at(-1)![0])).toContain('canDelegateTo: [] means no delegation');
    } finally {
      spy.mockRestore();
    }
  });

  it('does NOT warn when the key is omitted or non-empty', async () => {
    const onWarn = vi.fn();
    await loadSpace(await makeSessionSpace('knowledge: []'), { onWarn });
    await loadSpace(
      await makeSessionSpace('canDelegateTo:\n  - sp/ag', "Call `await delegate('sp', 'ag', { query })`."),
      { onWarn },
    );
    expect(onWarn).not.toHaveBeenCalled();
  });
});
