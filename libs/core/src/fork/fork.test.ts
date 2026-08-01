import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import type { Space } from '../spaces/load.js';
import { ForkEngine } from './fork.js';
import { salvageData } from '../exec/envelope.js';
import { BudgetExceededError } from '../eval/budget.js';
import type { RenderHost } from '../session/types.js';
import type { StreamSession } from '../eval/stream-types.js';
import type { StreamOpts } from '../eval/stream-types.js';
import { loadSystemSpaces, defaultSystemSpaceDirs, systemFunctionSources } from '../spaces/system.js';

function makeStream(text: string): StreamSession {
  let aborted = false;
  async function* gen() {
    if (!aborted) yield text;
  }
  return {
    textStream: gen(),
    abort() { aborted = true; },
  };
}

const silentHost: RenderHost = {
  display: () => {},
  ask: () => Promise.resolve(''),
  log: () => {},
};

function makeEngine(streamText: string): ForkEngine {
  return new ForkEngine({
    maxConcurrentForks: 4,
    parentHistory: [],
    parentSpaceDir: '/tmp',
    parentAgentSlug: 'test',
    renderHost: silentHost,
    streamFn: async () => makeStream(streamText),
  });
}

describe('salvageData', () => {
  it('produces type-appropriate NEUTRAL placeholders for every schema field', () => {
    const out = salvageData({ summary: 'string', findings: 'array', count: 'number', ok: 'boolean', meta: 'object' });
    // Strings are EMPTY — no prose note that a model could read and go off-script on.
    expect(out.summary).toBe('');
    expect(out.findings).toEqual([]);
    expect(out.count).toBe(0);
    expect(out.ok).toBe(false);
    expect(out.meta).toEqual({});
    expect(JSON.stringify(out)).not.toContain('unavailable');
  });

  it('handles array shorthand and empty schema', () => {
    expect(salvageData({ items: 'string[]' }).items).toEqual([]);
    expect(salvageData({})).toEqual({});
  });
});

describe('ForkEngine', () => {
  it('resolves when currentTask.resolve() is called with a valid value', async () => {
    const engine = makeEngine('currentTask.resolve({ answer: "pasta" });\n');
    const result = await engine.fork<{ answer: string }>({
      instruction: 'test task',
      output: { answer: 'string' },
    });
    expect(result).toEqual({ answer: 'pasta' });
  });

  it('does not crash (QuickJS lifetime) when currentTask.resolve() is called with a multi-field object', async () => {
    const engine = makeEngine(
      'currentTask.resolve({ title: "spaghetti", steps: 3, ready: true });\n',
    );
    const result = await engine.fork<{ title: string; steps: number; ready: boolean }>({
      instruction: 'test task',
      output: { title: 'string', steps: 'number', ready: 'boolean' },
    });
    expect(result).toMatchObject({ title: 'spaghetti', steps: 3, ready: true });
  });

  it('types an upstream array-field output so a callback over it is not implicit-any (TS7006)', async () => {
    // Regression: a plan node's `tables: array` output must be typed `{ tables: any[] }`, so
    // `plan_tables.tables.find(t => …)` gives `t` a contextual type instead of aborting the fork.
    const engine = makeEngine(
      'const t = plan_tables.tables.find((t) => t.name === "items");\ncurrentTask.resolve({ found: !!t });\n',
    );
    const result = await engine.fork<{ found: boolean }>({
      instruction: 'inspect upstream tables',
      output: { found: 'boolean' },
      upstreamOutputs: { plan_tables: { tables: [{ name: 'items' }] } },
      upstreamOutputSchemas: { plan_tables: { fields: { tables: 'array' }, isArray: false } },
    });
    expect(result).toEqual({ found: true });
  });

  it('types a forEach-node upstream as an ARRAY so the collector callback is not implicit-any', async () => {
    // Regression guard against the forEach-as-object bug: a forEach dependency's collected value
    // is an array of its output shape, so it must be typed `Array<{ n: number }>` — otherwise a
    // `.reduce`/`.map` over it fails typecheck and the fork salvages to a neutral (e.g. total 0).
    const engine = makeEngine(
      'const total = implement_rows.reduce((sum, r) => sum + r.n, 0);\ncurrentTask.resolve({ total });\n',
    );
    const result = await engine.fork<{ total: number }>({
      instruction: 'sum a forEach output',
      output: { total: 'number' },
      upstreamOutputs: { implement_rows: [{ n: 2 }, { n: 3 }] },
      upstreamOutputSchemas: { implement_rows: { fields: { n: 'number' }, isArray: true } },
    });
    expect(result).toEqual({ total: 5 });
  });

  it('salvages a NEUTRAL schema-valid placeholder when currentTask.resolve() is never called', async () => {
    // Robustness contract: rather than hard-failing the parent when the model wanders
    // without resolving (model stupidity), the fork forces resolve-only turns and, as a
    // last resort, returns a type-appropriate NEUTRAL placeholder ("" for strings — no
    // alarming prose in the data plane) so orchestration can proceed.
    const engine = makeEngine('const x = 1;\n');
    const result = await engine.fork<{ x: string }>({ instruction: 'test', output: { x: 'string' } });
    expect(result.x).toBe('');
  });

  it('forkWithMeta reports { degraded: true, reason: "no_resolve" } for a salvaged fork and degraded: false for a clean one', async () => {
    // The typed degradation signal that replaces the old prose placeholder (Phase 3).
    const salvagedMeta = await makeEngine('const x = 1;\n').forkWithMeta<{ x: string }>({
      instruction: 'test', output: { x: 'string' },
    });
    expect(salvagedMeta.degraded).toBe(true);
    expect(salvagedMeta.reason).toBe('no_resolve');
    expect(salvagedMeta.value).toEqual({ x: '' });

    const cleanMeta = await makeEngine('currentTask.resolve({ x: "real" });\n').forkWithMeta<{ x: string }>({
      instruction: 'test', output: { x: 'string' },
    });
    expect(cleanMeta.degraded).toBe(false);
    expect(cleanMeta.reason).toBeUndefined();
    expect(cleanMeta.value).toEqual({ x: 'real' });
  });

  it('injects the JSX runtime so a fork can display(<JSX>) without "React is not defined"', async () => {
    // Regression: research forks crashed ×3 because React/catalog stubs were not
    // injected into the fork VM, so transpiled `display(<Stack>…)` threw.
    const engine = makeEngine('display(<Stack><Heading>Hi</Heading></Stack>);\ncurrentTask.resolve({ ok: true });\n');
    const result = await engine.fork<{ ok: boolean }>({ instruction: 'render', output: { ok: 'boolean' } });
    expect(result).toEqual({ ok: true });
  });

  it('rejects when the resolved value does not match the output schema', async () => {
    // Schema wants a number; the fork resolves a string → validateOutput fails and the fork rejects.
    // (Tolerance to a bad forEach item lives in the ORCHESTRATOR — retry-then-salvage — not here.)
    const engine = makeEngine('currentTask.resolve({ count: "not a number" });\n');
    await expect(
      engine.fork({ instruction: 'count things', output: { count: 'number' } }),
    ).rejects.toThrow(/does not match schema/);
  });

  it('loadKnowledge in fork returns file content, not undefined', async () => {
    // Regression: the fork's processYield returned undefined for loadKnowledge,
    // which raced against loadKnowledgeFile().then(resolve) and won — binding
    // k = undefined. validateOutput then failed and the fork rejected silently.
    const tmpDir = mkdtempSync(join(tmpdir(), 'fork-lk-test-'));
    try {
      const knowledgeDir = join(tmpDir, 'knowledge', 'domain', 'field');
      mkdirSync(knowledgeDir, { recursive: true });
      writeFileSync(join(knowledgeDir, 'opt.md'), '---\nvariable: x\n---\n\nHello knowledge');

      // Turn 1: call loadKnowledge (yield). Turn 2 (k in scope): call resolve.
      let callCount = 0;
      const engine = new ForkEngine({
        maxConcurrentForks: 4,
        parentHistory: [],
        parentSpaceDir: tmpDir,
        parentAgentSlug: 'test',
        renderHost: silentHost,
        streamFn: async () => {
          callCount++;
          return makeStream(
            callCount === 1
              ? "const k = await loadKnowledge('domain', 'field', 'opt.md');\n"
              : "currentTask.resolve({ body: (k as any).body, loaded: !!k });\n"
          );
        },
      });

      const result = await engine.fork<{ body: string; loaded: boolean }>({
        instruction: 'test',
        output: { body: 'string', loaded: 'boolean' },
      });

      expect(result.body).toBe('Hello knowledge');
      expect(result.loaded).toBe(true);
    } finally {
      rmSync(tmpDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
  });

  it('rejects on timeout', async () => {
    // Stream that never ends. It yields NOTHING on purpose — that is what "the model produced no
    // statement before the deadline" looks like — so `require-yield` is suppressed rather than
    // satisfied: adding a `yield` to quiet it would change what this test is testing.
    let aborted = false;
    // eslint-disable-next-line require-yield
    async function* neverEnds() {
      while (!aborted) {
        await new Promise((r) => setTimeout(r, 10));
      }
    }
    const engine = new ForkEngine({
      maxConcurrentForks: 4,
      parentHistory: [],
      parentSpaceDir: '/tmp',
      parentAgentSlug: 'test',
      renderHost: silentHost,
      streamFn: async () => ({ textStream: neverEnds(), abort() { aborted = true; } }),
    });
    await expect(
      engine.fork({ instruction: 'test', output: {}, timeout: 50 }),
    ).rejects.toThrow(/timed out/);
    aborted = true;
  });

  describe('budget enforcement', () => {
    // A fork that yields (sleep) every turn but never resolves — it loops until
    // a budget cap stops it. The fresh generator per call keeps it going.
    function makeForeverEngine(limits: Record<string, number>): ForkEngine {
      return new ForkEngine({
        maxConcurrentForks: 4,
        parentHistory: [],
        parentSpaceDir: '/tmp',
        parentAgentSlug: 'test',
        renderHost: silentHost,
        streamFn: async () => {
          let done = false;
          async function* gen() { if (!done) yield 'await sleep("1ms");\n'; }
          return { textStream: gen(), abort() { done = true; } } as StreamSession;
        },
        budgetLimits: limits,
      });
    }

    it('stops a non-resolving fork at maxEpisodes with BudgetExceededError', async () => {
      const engine = makeForeverEngine({ maxEpisodes: 3 });
      await expect(
        engine.fork({ instruction: 'loop forever', output: { x: 'string' } }),
      ).rejects.toBeInstanceOf(BudgetExceededError);
    });

    it('reports the episodes kind and the limit on the thrown error', async () => {
      const engine = makeForeverEngine({ maxEpisodes: 2 });
      await engine
        .fork({ instruction: 'loop', output: { x: 'string' } })
        .then(() => { throw new Error('should have rejected'); })
        .catch((err) => {
          expect(err).toBeInstanceOf(BudgetExceededError);
          expect((err as BudgetExceededError).kind).toBe('episodes');
          expect((err as BudgetExceededError).limit).toBe(2);
        });
    });

    it('stops at maxToolCalls when episodes are unbounded', async () => {
      const engine = makeForeverEngine({ maxToolCalls: 2 });
      await expect(
        engine.fork({ instruction: 'loop', output: { x: 'string' } }),
      ).rejects.toBeInstanceOf(BudgetExceededError);
    });

    it('rejects immediately when fork depth exceeds maxForkDepth (no VM spun up)', async () => {
      const engine = new ForkEngine({
        maxConcurrentForks: 4,
        parentHistory: [],
        parentSpaceDir: '/tmp',
        parentAgentSlug: 'test',
        renderHost: silentHost,
        streamFn: async () => makeStream('currentTask.resolve({ x: "y" });\n'),
        budgetLimits: { maxForkDepth: 1 },
        forkDepth: 2,
      });
      await engine
        .fork({ instruction: 'too deep', output: { x: 'string' } })
        .then(() => { throw new Error('should have rejected'); })
        .catch((err) => {
          expect(err).toBeInstanceOf(BudgetExceededError);
          expect((err as BudgetExceededError).kind).toBe('forkDepth');
        });
    });

    it('does not interfere with a fork that resolves within budget', async () => {
      const engine = new ForkEngine({
        maxConcurrentForks: 4,
        parentHistory: [],
        parentSpaceDir: '/tmp',
        parentAgentSlug: 'test',
        renderHost: silentHost,
        streamFn: async () => makeStream('currentTask.resolve({ answer: "ok" });\n'),
        budgetLimits: { maxEpisodes: 10, maxToolCalls: 10, maxForkDepth: 3 },
      });
      const result = await engine.fork<{ answer: string }>({
        instruction: 'quick',
        output: { answer: 'string' },
      });
      expect(result).toEqual({ answer: 'ok' });
    });
  });

  describe('progress global', () => {
    it('exposes a live read-only budget snapshot inside the fork VM', async () => {
      const engine = new ForkEngine({
        maxConcurrentForks: 4,
        parentHistory: [],
        parentSpaceDir: '/tmp',
        parentAgentSlug: 'test',
        renderHost: silentHost,
        streamFn: async () =>
          makeStream(
            'const p = progress();\ncurrentTask.resolve({ episodes: p.episodes, toolCalls: p.toolCalls });\n',
          ),
        budgetLimits: { maxEpisodes: 10 },
      });
      const result = await engine.fork<{ episodes: number; toolCalls: number }>({
        instruction: 'read progress',
        output: { episodes: 'number', toolCalls: 'number' },
      });
      // First turn has ticked one episode; no yields resolved before resolve().
      expect(result.episodes).toBeGreaterThanOrEqual(1);
      expect(typeof result.toolCalls).toBe('number');
    });
  });

  describe('concurrency (maxConcurrentForks)', () => {
    // streamFn holds the slot for a beat and records how many forks are in flight,
    // so `peak` reveals whether the cap actually serialized them.
    function trackingEngine(max: number, track: { active: number; peak: number }): ForkEngine {
      return new ForkEngine({
        maxConcurrentForks: max,
        parentHistory: [],
        parentSpaceDir: '/tmp',
        parentAgentSlug: 'test',
        renderHost: silentHost,
        streamFn: async () => {
          track.active++;
          track.peak = Math.max(track.peak, track.active);
          await new Promise((r) => setTimeout(r, 15));
          track.active--;
          return makeStream('currentTask.resolve({ ok: true });\n');
        },
      });
    }

    it('runs forks in parallel up to the cap', async () => {
      const track = { active: 0, peak: 0 };
      const engine = trackingEngine(4, track);
      await Promise.all([
        engine.fork({ instruction: 'a', output: { ok: 'boolean' } }),
        engine.fork({ instruction: 'b', output: { ok: 'boolean' } }),
      ]);
      expect(track.peak).toBe(2); // both in flight at once
    });

    it('serializes forks when the cap is 1 (the second waits for a slot)', async () => {
      const track = { active: 0, peak: 0 };
      const engine = trackingEngine(1, track);
      await Promise.all([
        engine.fork({ instruction: 'a', output: { ok: 'boolean' } }),
        engine.fork({ instruction: 'b', output: { ok: 'boolean' } }),
      ]);
      expect(track.peak).toBe(1); // never more than one concurrently
    });
  });

  describe('registerSpace in a fork', () => {
    /** Write a minimal, loadable one-agent space under `dir`. */
    function writeSpace(dir: string): void {
      const agent = join(dir, 'agents', 'main', 'instruct.md');
      mkdirSync(dirname(agent), { recursive: true });
      writeFileSync(agent, 'You are a worker.\n');
    }

    it('populates the shared dynamicSpaces map — visible to the parent delegate path', async () => {
      const tmpDir = mkdtempSync(join(tmpdir(), 'fork-regspace-'));
      try {
        const workerDir = join(tmpDir, 'worker');
        writeSpace(workerDir);

        // The SAME Map reference the parent Session hands to delegate().
        const dynamicSpaces = new Map<string, Space>();
        let call = 0;
        const engine = new ForkEngine({
          maxConcurrentForks: 4,
          parentHistory: [],
          parentSpaceDir: tmpDir,
          parentAgentSlug: 'test',
          renderHost: silentHost,
          // Turn 1: register the space (yields). Turn 2 (r in scope): resolve.
          streamFn: async () => {
            call++;
            return makeStream(
              call === 1
                ? `const r = await registerSpace(${JSON.stringify(workerDir)});\n`
                : `currentTask.resolve({ ok: (r as any).ok, slug: (r as any).agentSlug });\n`,
            );
          },
          dynamicSpaces,
        });

        const result = await engine.fork<{ ok: boolean; slug: string }>({
          instruction: 'register the worker space',
          output: { ok: 'boolean', slug: 'string' },
        });
        expect(result).toEqual({ ok: true, slug: 'main' });
        // The fork mutated the shared map → a later parent delegate() can resolve it.
        expect(dynamicSpaces.has(workerDir)).toBe(true);
        expect(dynamicSpaces.get(workerDir)!.agents['main']).toBeDefined();
      } finally {
        rmSync(tmpDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
      }
    });

    it('withholds registerSpace from read-only roles (explore) — it is not in scope', async () => {
      const tmpDir = mkdtempSync(join(tmpdir(), 'fork-regspace-ro-'));
      try {
        const dynamicSpaces = new Map<string, Space>();
        const engine = new ForkEngine({
          maxConcurrentForks: 4,
          parentHistory: [],
          parentSpaceDir: tmpDir,
          parentAgentSlug: 'test',
          renderHost: silentHost,
          // Probe whether the global exists rather than calling it (an undefined-global
          // await surfaces as an unhandled rejection, not an eval error, so calling it
          // wouldn't reliably fail the fork).
          streamFn: async () =>
            makeStream(`currentTask.resolve({ available: typeof registerSpace === "function" });\n`),
          dynamicSpaces,
        });
        const result = await engine.fork<{ available: boolean }>({
          instruction: 'probe',
          output: { available: 'boolean' },
          role: 'explore',
        });
        expect(result.available).toBe(false); // not injected for read-only roles
        expect(dynamicSpaces.size).toBe(0);
      } finally {
        rmSync(tmpDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
      }
    });

    it('makes registerSpace available to write-capable (general) roles', async () => {
      const tmpDir = mkdtempSync(join(tmpdir(), 'fork-regspace-gen-'));
      try {
        const engine = new ForkEngine({
          maxConcurrentForks: 4,
          parentHistory: [],
          parentSpaceDir: tmpDir,
          parentAgentSlug: 'test',
          renderHost: silentHost,
          streamFn: async () =>
            makeStream(`currentTask.resolve({ available: typeof registerSpace === "function" });\n`),
          dynamicSpaces: new Map<string, Space>(),
        });
        const result = await engine.fork<{ available: boolean }>({
          instruction: 'probe',
          output: { available: 'boolean' },
          role: 'general',
        });
        expect(result.available).toBe(true);
      } finally {
        rmSync(tmpDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
      }
    });
  });
});

/**
 * Task-node default filtering (`.issues/research-store-noop-diagnosis.md`, cause (b)):
 * `pickAllowed`'s default branch (task OMITS `functions:`) used to hand back the RAW,
 * unfiltered fork-engine pool — which (since Slice B) includes granted-only universal
 * functions like webSearch/webFetch even though the OWNING agent's own top-level VM
 * never sees them. A scaffolded task with no `functions:` (e.g. an `answer` task meant
 * only to check coverage) thus silently got web access anyway and could research inline
 * instead of honestly reporting `covered:false` for the caller to escalate. The fix
 * re-applies `filterUniversalFunctions` in the omitted-`functions:` default branch, so a
 * task must now opt in EXPLICITLY (`functions: [webSearch, ...]`) — mirroring the
 * top-level "not granted ⇒ not injected" rule Slice B already applies to the agent VM.
 */
describe('ForkEngine — task-node default omits granted-only universal functions (research-store-noop fix)', () => {
  it('omitted `functions:` — a task statement referencing `webSearch` is UNRESOLVED (typecheck failure, retryable)', async () => {
    const systemSpaces = await loadSystemSpaces(defaultSystemSpaceDirs());
    const pool = systemFunctionSources(systemSpaces); // the UNFILTERED pool (includes webSearch/webFetch)
    expect(pool['webSearch']).toBeTruthy(); // sanity: the pool really carries it

    const retryPrompts: string[] = [];
    let call = 0;
    const engine = new ForkEngine({
      maxConcurrentForks: 4,
      parentHistory: [],
      parentSpaceDir: '/tmp',
      parentAgentSlug: 'test',
      renderHost: silentHost,
      agentFunctions: pool,
      streamFn: async (opts: StreamOpts) => {
        call++;
        if (call === 1) return makeStream(`const x = typeof webSearch;\ncurrentTask.resolve({ kind: x });`);
        // Retry turn: capture what the model was shown, then resolve cleanly so the
        // fork completes instead of burning all 3 attempts.
        const last = [...opts.messages].reverse().find((m) => m.role === 'user')?.content ?? '';
        retryPrompts.push(last);
        return makeStream(`currentTask.resolve({ kind: 'retried' });`);
      },
    });

    const result = await engine.fork<{ kind: string }>({
      instruction: 'no functions declared — should NOT see webSearch',
      output: { kind: 'string' },
      // functions: omitted entirely
    });

    expect(retryPrompts.length).toBeGreaterThan(0);
    expect(retryPrompts[0]).toMatch(/webSearch/);
    expect(retryPrompts[0]).toMatch(/Cannot find name/);
    expect(result.kind).toBe('retried');
  });

  it('explicit `functions: ["webSearch"]` still resolves it from the pool (opt-in unaffected — research_and_store\'s own nodes rely on this)', async () => {
    const systemSpaces = await loadSystemSpaces(defaultSystemSpaceDirs());
    const pool = systemFunctionSources(systemSpaces);

    let sawTypecheckRetry = false;
    const engine = new ForkEngine({
      maxConcurrentForks: 4,
      parentHistory: [],
      parentSpaceDir: '/tmp',
      parentAgentSlug: 'test',
      renderHost: silentHost,
      agentFunctions: pool,
      streamFn: async (opts: StreamOpts) => {
        const last = [...opts.messages].reverse().find((m) => m.role === 'user')?.content ?? '';
        if (last.includes('Cannot find name')) sawTypecheckRetry = true;
        // Referencing (not calling) the identifier is enough to prove it resolved —
        // same reasoning as the delegate.test.ts Slice B positive case.
        return makeStream(`currentTask.resolve({ kind: typeof webSearch });`);
      },
    });

    const result = await engine.fork<{ kind: string }>({
      instruction: 'explicit web grant on this task node',
      output: { kind: 'string' },
      functions: ['webSearch'],
    });

    expect(sawTypecheckRetry).toBe(false);
    expect(result.kind).toBe('function');
  });
});
