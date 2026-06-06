import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ForkEngine } from './fork.js';
import { BudgetExceededError } from '../eval/budget.js';
import type { RenderHost } from '../session/types.js';
import type { StreamSession } from '../eval/stream-types.js';

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

  it('rejects when currentTask.resolve() is never called', async () => {
    const engine = makeEngine('const x = 1;\n');
    await expect(
      engine.fork({ instruction: 'test', output: { x: 'string' } }),
    ).rejects.toThrow(/without calling currentTask\.resolve/);
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
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('rejects on timeout', async () => {
    // Stream that never ends
    let aborted = false;
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
});
