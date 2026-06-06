import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ForkEngine } from './fork.js';
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
});
