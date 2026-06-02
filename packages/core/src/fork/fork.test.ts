import { describe, it, expect } from 'vitest';
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
