import { describe, it, expect } from 'vitest';
import { createVM, type VM } from '../sandbox/quickjs.js';
import { injectGlobal } from '../sandbox/host-bridge.js';
import { injectHostTools } from '../globals/host-tools.js';
import { runTurnLoop } from './turn-loop.js';
import { MessageHistory } from '../context/history.js';
import { LIBRARY_DTS } from '../typecheck/library-dts.js';
import type { RenderHost } from '../session/types.js';
import type { StreamSession, StreamOpts } from './stream-types.js';
import type { YieldRequest } from './yield.js';

const silentHost: RenderHost = { display: () => {}, ask: async () => undefined, log: () => {} };

/** A streamFn that emits `statements` on the first turn, then nothing (so the loop ends). */
function scriptedStream(statements: string): (opts: StreamOpts) => Promise<StreamSession> {
  let calls = 0;
  return async () => {
    const text = calls++ === 0 ? statements : '';
    let aborted = false;
    async function* gen() {
      if (!aborted && text) yield text;
    }
    return { textStream: gen(), abort() { aborted = true; } } as StreamSession;
  };
}

function readGlobal(vm: VM, name: string): unknown {
  const h = vm.ctx.getProp(vm.ctx.global, name);
  try { return vm.ctx.dump(h); } finally { h.dispose(); }
}

describe('turn loop — parallel yields (Promise.all of forks)', () => {
  it('binds each parallel yield to its OWN result (no collision)', async () => {
    const vm = await createVM();
    // A yielding global `y(tag)` that pushes a yield carrying its tag.
    const y = (tag: string) =>
      new Promise((resolve, reject) => {
        vm.pendingYields.push({ kind: 'y', args: [tag], deferred: { resolve, reject }, vmPromiseHandle: undefined } as unknown as YieldRequest);
      });
    injectGlobal(vm.ctx, 'y', y as (...a: unknown[]) => unknown);

    const history = new MessageHistory();
    history.append({ role: 'user', content: 'go', blockType: 'normal' });

    const result = await runTurnLoop({
      vm,
      history,
      systemBlock: 'test',
      ambientDts: 'declare function y(tag: string): Promise<any>;',
      renderHost: silentHost,
      streamFn: scriptedStream('const [a, b] = await Promise.all([y("X"), y("Y")]);'),
      // Each yield resolves to a distinct value keyed by its tag.
      processYield: async (req) => ({ from: req.args[0] }),
      maxRetries: 2,
    });

    expect(result).toBe('done');
    // The VM must have bound a→X's result and b→Y's result — not both to the last one.
    expect(readGlobal(vm, 'a')).toEqual({ from: 'X' });
    expect(readGlobal(vm, 'b')).toEqual({ from: 'Y' });

    // And the emitted VARIABLES block reflects the distinct values.
    const varsMsg = history.messages.find((m) => m.blockType === 'variables');
    expect(varsMsg?.content).toContain('"from": "X"');
    expect(varsMsg?.content).toContain('"from": "Y"');
    vm.dispose();
  });

  it('resolves parallel yields concurrently, not sequentially', async () => {
    const vm = await createVM();
    const startTimes: Record<string, number> = {};
    const endTimes: Record<string, number> = {};
    const y = (tag: string) =>
      new Promise((resolve, reject) => {
        vm.pendingYields.push({ kind: 'y', args: [tag], deferred: { resolve, reject }, vmPromiseHandle: undefined } as unknown as YieldRequest);
      });
    injectGlobal(vm.ctx, 'y', y as (...a: unknown[]) => unknown);

    const history = new MessageHistory();
    history.append({ role: 'user', content: 'go', blockType: 'normal' });

    await runTurnLoop({
      vm,
      history,
      systemBlock: 'test',
      ambientDts: 'declare function y(tag: string): Promise<any>;',
      renderHost: silentHost,
      streamFn: scriptedStream('const [a, b] = await Promise.all([y("X"), y("Y")]);'),
      processYield: async (req) => {
        const tag = req.args[0] as string;
        startTimes[tag] = Date.now();
        await new Promise((r) => setTimeout(r, 80));
        endTimes[tag] = Date.now();
        return { tag };
      },
      maxRetries: 2,
    });

    // Both must have started (both yields were dispatched)
    expect(startTimes['X']).toBeDefined();
    expect(startTimes['Y']).toBeDefined();
    // Y must have started before X finished — proving concurrent execution.
    expect(startTimes['Y']).toBeLessThan(endTimes['X']!);
    expect(readGlobal(vm, 'a')).toEqual({ tag: 'X' });
    expect(readGlobal(vm, 'b')).toEqual({ tag: 'Y' });
    vm.dispose();
  });

  it('binds a destructured single-yield object result to each name', async () => {
    const vm = await createVM();
    const ask2 = () =>
      new Promise((resolve, reject) => {
        vm.pendingYields.push({ kind: 'ask', args: [], deferred: { resolve, reject }, vmPromiseHandle: undefined } as YieldRequest);
      });
    injectGlobal(vm.ctx, 'ask2', ask2 as (...a: unknown[]) => unknown);

    const history = new MessageHistory();
    history.append({ role: 'user', content: 'go', blockType: 'normal' });

    await runTurnLoop({
      vm,
      history,
      systemBlock: 'test',
      ambientDts: 'declare function ask2(): Promise<any>;',
      renderHost: silentHost,
      streamFn: scriptedStream('const { name, age } = await ask2();'),
      processYield: async () => ({ name: 'Ada', age: 36 }),
      maxRetries: 2,
    });

    expect(readGlobal(vm, 'name')).toBe('Ada');
    expect(readGlobal(vm, 'age')).toBe(36);
    vm.dispose();
  });
});

describe('turn loop — inspect() surfaces values to the model', () => {
  // Regression: a BARE (unbound) inspect(x) must still surface x into the
  // VARIABLES block the model reads. Before this was wired, bare inspect
  // resolved to an empty VARIABLES block, so the model saw nothing and would
  // re-type values from memory (hallucinating the truncated tail).
  it('emits the inspected value even when the call is unbound', async () => {
    const vm = await createVM();
    // inspect(v) pushes a yield whose args mirror globals/inspect.ts: [{ value, query }].
    const inspect = (v: unknown) =>
      new Promise((resolve, reject) => {
        vm.pendingYields.push({
          kind: 'inspect',
          args: [{ value: v, query: undefined }],
          deferred: { resolve, reject },
          vmPromiseHandle: undefined,
        } as unknown as YieldRequest);
      });
    injectGlobal(vm.ctx, 'inspect', inspect as (...a: unknown[]) => unknown);

    const history = new MessageHistory();
    history.append({ role: 'user', content: 'go', blockType: 'normal' });

    await runTurnLoop({
      vm,
      history,
      systemBlock: 'test',
      ambientDts: 'declare function inspect(...v: any[]): Promise<void>;',
      renderHost: silentHost,
      // No binding — the model just probes the value.
      streamFn: scriptedStream('inspect({ marketSize: "$0.9B", units: 12000 });'),
      // Mirrors session.ts: the inspect resolved value is args[0].
      processYield: async (req) => (req.args[0] as { value: unknown }).value,
      maxRetries: 2,
    });

    const varsMsg = history.messages.find((m) => m.blockType === 'variables');
    expect(varsMsg?.content).toContain('inspected[0]');
    expect(varsMsg?.content).toContain('$0.9B');
    expect(varsMsg?.content).toContain('12000');
    vm.dispose();
  });
});

describe('turn loop — process.exit() is not retried', () => {
  it('treats process.exit() as a clean stop instead of looping retries', async () => {
    const vm = await createVM();
    injectHostTools(vm, { renderHost: silentHost, spaceDir: '/tmp' });

    const history = new MessageHistory();
    history.append({ role: 'user', content: 'go', blockType: 'normal' });

    let calls = 0;
    const streamFn = async (): Promise<StreamSession> => {
      calls++;
      let aborted = false;
      async function* gen() { if (!aborted) yield 'process.exit(1);'; }
      return { textStream: gen(), abort() { aborted = true; } };
    };

    const result = await runTurnLoop({
      vm,
      history,
      systemBlock: 'test',
      ambientDts: LIBRARY_DTS,
      renderHost: silentHost,
      streamFn,
      processYield: async () => undefined,
      maxRetries: 3,
    });

    expect(result).toBe('done'); // intentional termination, not 'error'
    expect(calls).toBe(1); // NOT retried 3× on the same process.exit() code
    vm.dispose();
  });
});
