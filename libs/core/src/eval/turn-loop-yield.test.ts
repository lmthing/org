import { describe, it, expect } from 'vitest';
import { createVM, type VM } from '../sandbox/quickjs.js';
import { injectGlobal } from '../sandbox/host-bridge.js';
import { injectHostTools } from '../globals/host-tools.js';
import { createSetSessionMetaGlobal } from '../globals/set-session-meta.js';
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

/** A streamFn whose first N turns throw a transient stream error, then emits `statements`. */
function flakyThenStream(failTurns: number, statements: string): (opts: StreamOpts) => Promise<StreamSession> {
  let calls = 0;
  return async () => {
    const turn = calls++;
    const fail = turn < failTurns;
    const emitted = turn === failTurns; // emit code exactly once, after the failures
    let aborted = false;
    async function* gen() {
      if (fail) throw new Error('terminated');
      if (!aborted && emitted) yield statements;
    }
    return { textStream: gen(), abort() { aborted = true; } } as StreamSession;
  };
}

describe('turn loop — transient stream error recovery', () => {
  it('retries a dropped/terminated stream instead of finishing as done', async () => {
    const vm = await createVM();
    const history = new MessageHistory();
    history.append({ role: 'user', content: 'go', blockType: 'normal' });

    const result = await runTurnLoop({
      vm,
      history,
      systemBlock: 'test',
      ambientDts: LIBRARY_DTS,
      renderHost: silentHost,
      // First turn's stream throws "terminated"; the retry succeeds and binds x.
      streamFn: flakyThenStream(1, 'const x = 7;'),
      processYield: async () => undefined,
      maxRetries: 3,
    });

    expect(result).toBe('done');
    expect(readGlobal(vm, 'x')).toBe(7);
    vm.dispose();
  });

  it('gives up with error (not a false done) when every attempt drops', async () => {
    const vm = await createVM();
    const history = new MessageHistory();
    history.append({ role: 'user', content: 'go', blockType: 'normal' });

    const result = await runTurnLoop({
      vm,
      history,
      systemBlock: 'test',
      ambientDts: LIBRARY_DTS,
      renderHost: silentHost,
      streamFn: flakyThenStream(5, 'const x = 7;'), // always fails within maxRetries
      processYield: async () => undefined,
      maxRetries: 3,
    });

    expect(result).toBe('error');
    vm.dispose();
  });
});

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

describe('turn loop — setSessionMeta() runs end-to-end in a real VM (fire-and-forget)', () => {
  it('injects the real global, typechecks against LIBRARY_DTS, binds {ok:true}, and does NOT yield', async () => {
    const vm = await createVM();
    let seen: unknown;
    // Fire-and-forget: the genuine global calls the host hook SYNCHRONOUSLY (no yield),
    // so naming the conversation never ends the turn.
    const setSessionMeta = createSetSessionMetaGlobal((meta) => { seen = meta; return true; });
    injectGlobal(vm.ctx, 'setSessionMeta', setSessionMeta as (...a: unknown[]) => unknown);

    const history = new MessageHistory();
    history.append({ role: 'user', content: 'go', blockType: 'normal' });

    await runTurnLoop({
      vm,
      history,
      systemBlock: 'test',
      // LIBRARY_DTS is the real session DTS — proves setSessionMeta typechecks there.
      ambientDts: LIBRARY_DTS,
      renderHost: silentHost,
      streamFn: scriptedStream('const r = setSessionMeta({ title: "Pasta night", slug: "pasta-night" });'),
      processYield: async () => { throw new Error('setSessionMeta must not yield (fire-and-forget)'); },
      maxRetries: 2,
    });

    expect(seen).toEqual({ title: 'Pasta night', slug: 'pasta-night' });
    expect(readGlobal(vm, 'r')).toEqual({ ok: true });
    expect(vm.pendingYields.length).toBe(0); // no yield was pushed
    vm.dispose();
  });
});

describe('turn loop — nested yield binding (yield inside an awaited async wrapper)', () => {
  it("binds the bound name to the outer async function's return value, not the inner yield's raw resolved value", async () => {
    const vm = await createVM();
    // A yielding global `y(tag)`, same shape as sleep/ask/etc.
    const y = (tag: string) =>
      new Promise((resolve, reject) => {
        vm.pendingYields.push({ kind: 'y', args: [tag], deferred: { resolve, reject }, vmPromiseHandle: undefined } as unknown as YieldRequest);
      });
    injectGlobal(vm.ctx, 'y', y as (...a: unknown[]) => unknown);

    // A plain async function (mirrors webSearch/webFetch awaiting fetch() internally)
    // that awaits the yielding global and post-processes its result before returning.
    const def = vm.evalScript(
      'globalThis.wrapper = async function wrapper() { const inner = await y("tag"); return { processed: inner, marker: "real" }; };',
    );
    expect(def.ok).toBe(true);

    const history = new MessageHistory();
    history.append({ role: 'user', content: 'go', blockType: 'normal' });

    const result = await runTurnLoop({
      vm,
      history,
      systemBlock: 'test',
      ambientDts: 'declare function wrapper(): Promise<any>; declare function y(tag: string): Promise<any>;',
      renderHost: silentHost,
      streamFn: scriptedStream('const out = await wrapper();'),
      // The INNER yield resolves to a raw sentinel, distinct from wrapper's real return —
      // proves the bound value isn't just this raw value passed through.
      processYield: async () => 'RAW_INNER_VALUE',
      maxRetries: 2,
    });

    expect(result).toBe('done');
    expect(readGlobal(vm, 'out')).toEqual({ processed: 'RAW_INNER_VALUE', marker: 'real' });
    vm.dispose();
  });

  it('services SEQUENTIAL internal yields to completion (webFetch plain→render), not just the first', async () => {
    const vm = await createVM();
    // A yielding global `y(tag)`, same shape as fetch — each call is one host yield.
    const y = (tag: string) =>
      new Promise((resolve, reject) => {
        vm.pendingYields.push({ kind: 'y', args: [tag], deferred: { resolve, reject }, vmPromiseHandle: undefined } as unknown as YieldRequest);
      });
    injectGlobal(vm.ctx, 'y', y as (...a: unknown[]) => unknown);

    // A wrapper that awaits the yielding global TWICE in sequence (mirrors webFetch's
    // auto-dynamic path: a plain fetch, then — based on its result — a second fetch to
    // the render service). The second await only becomes a pending yield after the
    // first resumes, so the turn loop must loop-service both before binding.
    const def = vm.evalScript(
      'globalThis.wrapper = async function wrapper() { const first = await y("a"); const second = await y("b"); return { first, second, marker: "real" }; };',
    );
    expect(def.ok).toBe(true);

    const history = new MessageHistory();
    history.append({ role: 'user', content: 'go', blockType: 'normal' });

    let call = 0;
    const result = await runTurnLoop({
      vm,
      history,
      systemBlock: 'test',
      ambientDts: 'declare function wrapper(): Promise<any>; declare function y(tag: string): Promise<any>;',
      renderHost: silentHost,
      streamFn: scriptedStream('const out = await wrapper();'),
      // Distinct value per sequential yield — proves BOTH ran (not just the first).
      processYield: async () => `R${call++}`,
      maxRetries: 2,
    });

    expect(result).toBe('done');
    // Before the sequential-yield fix, `out` bound the raw first Response ("R0");
    // now it is the wrapper's real return after BOTH internal awaits completed.
    expect(readGlobal(vm, 'out')).toEqual({ first: 'R0', second: 'R1', marker: 'real' });
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

/** Helper: a streamFn that emits one entry of `turns` per call, then '' forever. */
function turnsStream(turns: string[]): { fn: (o: StreamOpts) => Promise<StreamSession>; calls: () => number } {
  let i = 0;
  const fn = async () => {
    const text = turns[i++] ?? '';
    let aborted = false;
    async function* gen() { if (!aborted && text) yield text; }
    return { textStream: gen(), abort() { aborted = true; } } as StreamSession;
  };
  return { fn, calls: () => i };
}

describe('turn loop — continuation nudge (stalled mid-program after a non-yielding await-binding)', () => {
  it('re-prompts the model when it stops right after `const x = await <space fn>()`, so the run continues', async () => {
    const vm = await createVM();
    // prep(): a non-yielding host fn (returns a value, pushes no yield) — like a space fn.
    injectGlobal(vm.ctx, 'prep', (() => 42) as (...a: unknown[]) => unknown);
    // fin(): a yielding global, proves the run advanced past the stall.
    const fin = () => new Promise((resolve, reject) => {
      vm.pendingYields.push({ kind: 'fin', args: [], deferred: { resolve, reject }, vmPromiseHandle: undefined } as unknown as YieldRequest);
    });
    injectGlobal(vm.ctx, 'fin', fin as (...a: unknown[]) => unknown);

    const history = new MessageHistory();
    history.append({ role: 'user', content: 'go', blockType: 'normal' });
    // Turn 1 stops right after a non-yielding await-binding (the bug signature).
    // After the nudge, turn 2 does a real yielding call; turn 3 is empty → done.
    const s = turnsStream(['const r = await prep();', 'const finRes = await fin();', '']);

    const result = await runTurnLoop({
      vm, history, systemBlock: 'test',
      ambientDts: 'declare function prep(): Promise<number>;\ndeclare function fin(): Promise<any>;',
      renderHost: silentHost, streamFn: s.fn,
      processYield: async () => ({ ok: true }),
      maxRetries: 2,
    });

    expect(result).toBe('done');
    expect(s.calls()).toBeGreaterThanOrEqual(3); // turn1 stall + NUDGE→turn2 + turn3 empty
    expect(readGlobal(vm, 'finRes')).toEqual({ ok: true }); // continued past the stall
    vm.dispose();
  });

  it('does NOT nudge when the last statement is a literal binding (no call → no spurious extra turn)', async () => {
    const vm = await createVM();
    const history = new MessageHistory();
    history.append({ role: 'user', content: 'go', blockType: 'normal' });
    // Plain literal binding, no call → not the stranded-mid-program signature → loop ends.
    const s = turnsStream(['const x = 5;', '']);

    const result = await runTurnLoop({
      vm, history, systemBlock: 'test', ambientDts: LIBRARY_DTS,
      renderHost: silentHost, streamFn: s.fn,
      processYield: async () => undefined, maxRetries: 2,
    });

    expect(result).toBe('done');
    expect(s.calls()).toBe(1); // no nudge → streamFn called exactly once
    vm.dispose();
  });

  it('DOES nudge when the last statement binds from a SYNC non-yielding call (e.g. writeTaskFile)', async () => {
    const vm = await createVM();
    // writeTaskFile(): a SYNC non-yielding host fn (returns a value, pushes no yield).
    injectGlobal(vm.ctx, 'writeTaskFile', (() => ({ ok: true })) as (...a: unknown[]) => unknown);
    injectGlobal(vm.ctx, 'finish', (() => true) as (...a: unknown[]) => unknown);
    const history = new MessageHistory();
    history.append({ role: 'user', content: 'go', blockType: 'normal' });
    // Sync space-function call bound to a var, then the model stops — the runtime never
    // surfaces the result, so the model is stranded mid-program. Must be nudged to continue.
    const s = turnsStream(['const r = writeTaskFile("d", "tl", {});', 'const done = finish();', '']);

    const result = await runTurnLoop({
      vm, history, systemBlock: 'test',
      ambientDts: 'declare function writeTaskFile(d: string, tl: string, s: any): { ok: boolean };\ndeclare function finish(): boolean;',
      renderHost: silentHost, streamFn: s.fn,
      processYield: async () => undefined, maxRetries: 2,
    });

    expect(result).toBe('done');
    expect(s.calls()).toBeGreaterThanOrEqual(2); // stall after writeTaskFile → NUDGE → continued
    vm.dispose();
  });

  it('bounds the nudge so a model that keeps binding without yielding still terminates', async () => {
    const vm = await createVM();
    injectGlobal(vm.ctx, 'prep', (() => 1) as (...a: unknown[]) => unknown);
    const history = new MessageHistory();
    history.append({ role: 'user', content: 'go', blockType: 'normal' });
    // Every turn is a fresh non-yielding await-binding — would loop forever unbounded.
    const turns = Array.from({ length: 20 }, (_, i) => `const r${i} = await prep();`);
    const s = turnsStream(turns);

    const result = await runTurnLoop({
      vm, history, systemBlock: 'test',
      ambientDts: 'declare function prep(): Promise<number>;',
      renderHost: silentHost, streamFn: s.fn,
      processYield: async () => undefined, maxRetries: 2,
      maxContinueNudges: 3,
    });

    expect(result).toBe('done');
    // initial turn + at most 3 nudge re-prompts → never the full 20
    expect(s.calls()).toBeLessThanOrEqual(4);
    vm.dispose();
  });
});

describe('turn loop — cross-turn typecheck scope (initialContext)', () => {
  it('seeds tsc scope from initialContext so a variable bound in a PRIOR turn resolves', async () => {
    const vm = await createVM();
    // Simulate a prior turn having bound q1 in the VM (as the host does via globalThis).
    vm.evalStatement("globalThis['q1'] = { sources: ['http://example.com/a'] };");

    const history = new MessageHistory();
    history.append({ role: 'user', content: 'use q1', blockType: 'normal' });
    const s = turnsStream(['const u = q1.sources[0];', '']);

    const result = await runTurnLoop({
      vm, history, systemBlock: 'test', ambientDts: LIBRARY_DTS,
      renderHost: silentHost, streamFn: s.fn,
      processYield: async () => undefined, maxRetries: 2,
      // Prior-turn yielding statement carried forward by the Session.
      initialContext: "const q1 = { sources: ['http://example.com/a'] };",
    });

    expect(result).toBe('done');
    expect(readGlobal(vm, 'u')).toBe('http://example.com/a');
    vm.dispose();
  });

  it("WITHOUT initialContext, referencing a prior-turn variable fails tsc ('Cannot find name') — the bug", async () => {
    const vm = await createVM();
    vm.evalStatement("globalThis['q1'] = { sources: ['http://example.com/a'] };");

    const history = new MessageHistory();
    history.append({ role: 'user', content: 'use q1', blockType: 'normal' });
    // Same statement, but no initialContext → tsc has never seen q1.
    const s = turnsStream(['const u = q1.sources[0];', 'const u = q1.sources[0];', 'const u = q1.sources[0];']);

    const result = await runTurnLoop({
      vm, history, systemBlock: 'test', ambientDts: LIBRARY_DTS,
      renderHost: silentHost, streamFn: s.fn,
      processYield: async () => undefined, maxRetries: 2,
    });

    expect(result).toBe('error'); // typecheck rejects q1 on every retry
    vm.dispose();
  });

  // Regression for research-fork-scope-loss: a yielding statement whose yield ERRORS is
  // never committed to accumulatedContext, so a retry that references its bound name used
  // to fail typecheck with "Cannot find name". The fix declares the bound names ambient
  // (any) + seeds them undefined so both forward-references and re-emits resolve.
  it('a yield that ERRORS does not strand a later statement referencing its binding', async () => {
    const vm = await createVM();
    injectHostTools(vm, { renderHost: silentHost, spaceDir: '/tmp' });
    let yCalls = 0;
    const y = (q: string) =>
      new Promise((resolve, reject) => {
        vm.pendingYields.push({ kind: 'y', args: [q], deferred: { resolve, reject }, vmPromiseHandle: undefined } as unknown as YieldRequest);
      });
    injectGlobal(vm.ctx, 'y', y as (...a: unknown[]) => unknown);
    injectGlobal(vm.ctx, 'finish', (() => true) as (...a: unknown[]) => unknown);

    const history = new MessageHistory();
    history.append({ role: 'user', content: 'go', blockType: 'normal' });

    const s = turnsStream([
      'const top = await y("q");',                  // yields; the yield throws → retry
      'const got = top; const done = finish();',    // references `top` — must typecheck (the fix)
      '',
    ]);

    const result = await runTurnLoop({
      vm, history, systemBlock: 'test',
      ambientDts: 'declare function y(q: string): Promise<{ results: string[] }>;\ndeclare function finish(): boolean;',
      renderHost: silentHost, streamFn: s.fn,
      processYield: async () => { yCalls++; throw new Error('y failed (no key)'); }, // the only yield is y()
      maxRetries: 3,
    });

    expect(result).toBe('done');
    expect(yCalls).toBe(1);
    expect(readGlobal(vm, 'got')).toBeUndefined(); // top was seeded undefined after the failed yield
    // The whole point: no "Cannot find name 'top'" typecheck error on the retry.
    const errs = history.messages.filter((m) => m.blockType === 'error').map((m) => m.content).join('\n');
    expect(errs).not.toContain("Cannot find name 'top'");
    vm.dispose();
  });
});
