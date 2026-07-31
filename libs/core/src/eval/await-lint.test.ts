import { describe, it, expect } from 'vitest';
import { createVM, type VM } from '../sandbox/quickjs.js';
import { injectGlobal } from '../sandbox/host-bridge.js';
import { lintMissingAwait, yieldingGlobalNames } from './await-lint.js';
import { bindYieldResults, runTurnLoop } from './turn-loop.js';
import { MessageHistory } from '../context/history.js';
import { ASK_DTS, FORK_DTS, COMMON_DTS } from '../typecheck/library-dts.js';
import type { RenderHost } from '../session/types.js';
import type { StreamOpts, StreamSession } from './stream-types.js';
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

// The yielding set the lint works from, as the real fragments produce it.
const YIELDING = yieldingGlobalNames(
  [ASK_DTS, FORK_DTS, COMMON_DTS, 'declare function webSearch(q: string): Promise<any>;'].join('\n'),
);

describe('yieldingGlobalNames — derived from the ambient DTS, never hardcoded', () => {
  it('collects every Promise-returning declared global of THIS context', () => {
    expect(YIELDING.has('ask')).toBe(true);
    expect(YIELDING.has('fork')).toBe(true);
    expect(YIELDING.has('webSearch')).toBe(true);
    // COMMON_DTS' own yielding members ride along.
    expect(YIELDING.has('inspect')).toBe(true);
    expect(YIELDING.has('loadKnowledge')).toBe(true);
    expect(YIELDING.has('sleep')).toBe(true);
  });

  it('excludes the synchronous / fire-and-forget globals', () => {
    expect(YIELDING.has('display')).toBe(false);
    expect(YIELDING.has('setActivity')).toBe(false);
    expect(YIELDING.has('spacePath')).toBe(false);
    expect(YIELDING.has('typecheckSource')).toBe(false);
  });

  it('follows the capability gate: a global absent from the context DTS is not in the set', () => {
    // A fork leaf's DTS carries no `ask`/`fork` fragment at all.
    const leaf = yieldingGlobalNames(COMMON_DTS);
    expect(leaf.has('ask')).toBe(false);
    expect(leaf.has('fork')).toBe(false);
    expect(leaf.has('sleep')).toBe(true);
  });
});

describe('lintMissingAwait — flags a bound yielding call with no await', () => {
  it('names the exact fix for `const r = ask("q")`', () => {
    const finding = lintMissingAwait('const answer = ask("What size?");', YIELDING);
    expect(finding).not.toBeNull();
    expect(finding!.name).toBe('ask');
    expect(finding!.message).toContain('`ask(...)` must be awaited');
    expect(finding!.message).toContain('const answer = await ask(...)');
  });

  it('flags a destructuring binding and a plain assignment too', () => {
    expect(lintMissingAwait('const { name, age } = ask("who?");', YIELDING)).not.toBeNull();
    expect(lintMissingAwait('r = fork({ instruction: "x", output: {} });', YIELDING)).not.toBeNull();
  });

  it('sees through parentheses and `as`', () => {
    expect(lintMissingAwait('const r = (ask("q"));', YIELDING)).not.toBeNull();
    expect(lintMissingAwait('const r = ask("q") as any;', YIELDING)).not.toBeNull();
  });
});

describe('lintMissingAwait — the shapes it must NOT flag', () => {
  const clean = (stmt: string) => expect(lintMissingAwait(stmt, YIELDING)).toBeNull();

  it('an awaited call', () => {
    clean('const answer = await ask("What size?");');
    clean('const { name } = await ask("who?");');
  });

  it('await Promise.all([...]) of yielding calls', () => {
    clean('const [a, b] = await Promise.all([fork({ instruction: "a", output: {} }), fork({ instruction: "b", output: {} })]);');
    clean('const rs = await Promise.all(items.map((x) => webSearch(x)));');
    clean('const rs = await Promise.allSettled([webSearch("a"), webSearch("b")]);');
  });

  it('a bare Promise combinator without await (the value is still handled as a promise)', () => {
    clean('const p = Promise.all([webSearch("a"), webSearch("b")]);');
  });

  it('a .then/.catch chain', () => {
    clean('const p = ask("q").then((a) => a);');
    clean('const p = ask("q").catch(() => null);');
  });

  it('a yielding call inside a nested function (the await may live at its call site)', () => {
    clean('const ps = items.map((x) => webSearch(x));');
    clean('const run = async () => { const r = ask("q"); return r; };');
  });

  it('an unbound call, or one passed as an argument', () => {
    clean('inspect(results);');
    clean('display(await summarize(webSearch("q")));');
  });

  it('a non-yielding global that merely looks like one', () => {
    clean('const ok = display("hello");');
    clean('const p = spacePath("knowledge");');
  });

  it('anything at all when the context declares no yielding globals', () => {
    expect(lintMissingAwait('const r = ask("q");', new Set())).toBeNull();
  });
});

describe('turn loop — the missing-await lint fails the statement BEFORE it evaluates', () => {
  it('surfaces the fix to the model and never runs the yield', async () => {
    const vm = await createVM();
    let yieldCalls = 0;
    const ask = (q: string) =>
      new Promise((resolve, reject) => {
        vm.pendingYields.push({ kind: 'ask', args: [q], deferred: { resolve, reject }, vmPromiseHandle: undefined } as YieldRequest);
      });
    injectGlobal(vm.ctx, 'ask', ask as (...a: unknown[]) => unknown);

    const history = new MessageHistory();
    history.append({ role: 'user', content: 'go', blockType: 'normal' });

    const result = await runTurnLoop({
      vm,
      history,
      systemBlock: 'test',
      ambientDts: 'declare function ask(q: string): Promise<any>;',
      renderHost: silentHost,
      // The exact failure: typechecks clean, yields at call time, binds the Promise.
      streamFn: scriptedStream('const answer = ask("What size?");'),
      processYield: async () => { yieldCalls++; return 'large'; },
      maxRetries: 2,
    });

    expect(result).toBe('done'); // the retry produced no statements → clean stop
    // The statement never reached eval, so no yield was ever registered or resolved.
    expect(yieldCalls).toBe(0);
    expect(vm.pendingYields.length).toBe(0);
    expect(readGlobal(vm, 'answer')).toBeUndefined();

    const errorBlock = history.messages.find((m) => m.blockType === 'error');
    expect(errorBlock).toBeDefined();
    expect(errorBlock!.content).toContain('`ask(...)` must be awaited');
    expect(errorBlock!.content).toContain('const answer = await ask(...)');
    vm.dispose();
  });

  it('leaves a correctly-awaited Promise.all of yields untouched', async () => {
    const vm = await createVM();
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
      processYield: async (req) => ({ from: req.args[0] }),
      maxRetries: 2,
    });

    expect(result).toBe('done');
    expect(history.messages.some((m) => m.blockType === 'error')).toBe(false);
    expect(readGlobal(vm, 'a')).toEqual({ from: 'X' });
    expect(readGlobal(vm, 'b')).toEqual({ from: 'Y' });
    vm.dispose();
  });
});

describe('bindYieldResults — a Promise left in the VM never beats the resolved value', () => {
  it('prefers the host-resolved value when the binding holds an un-awaited Promise', async () => {
    const vm = await createVM();
    // Exactly what `const answer = ask("q");` leaves behind: a PENDING promise on the global.
    expect(vm.evalScript('globalThis.answer = new Promise(() => {});').ok).toBe(true);
    // getVar is no help here: `ctx.dump` CONSUMES a promise handle, so getVar's own
    // dispose then throws QuickJSUseAfterFree — the un-awaited binding used to take the
    // whole turn down with it (it never even reached the `{}` the model was blamed for).
    expect(() => vm.getVar('answer')).toThrow(/Lifetime not alive/);

    const bound = bindYieldResults(vm, { kind: 'simple', names: ['answer'] }, 1, ['large']);
    expect(bound['answer']).toBe('large');
    vm.dispose();
  });

  it('also prefers it when the promise has already SETTLED (still a promise handle)', async () => {
    const vm = await createVM();
    expect(vm.evalScript('globalThis.r = Promise.resolve({ deep: 1 });').ok).toBe(true);
    vm.drivePendingJobs();
    expect(() => vm.getVar('r')).toThrow(/Lifetime not alive/);

    const bound = bindYieldResults(vm, { kind: 'simple', names: ['r'] }, 1, [{ deep: 1 }]);
    expect(bound['r']).toEqual({ deep: 1 });
    vm.dispose();
  });

  it('still prefers the VM value for a NON-promise binding (the nested-async recovery)', async () => {
    const vm = await createVM();
    expect(vm.evalScript('globalThis.out = { processed: "RAW", marker: "real" };').ok).toBe(true);
    const bound = bindYieldResults(vm, { kind: 'simple', names: ['out'] }, 1, ['RAW']);
    expect(bound['out']).toEqual({ processed: 'RAW', marker: 'real' });
    vm.dispose();
  });

  it('a genuinely empty object returned by a tool is NOT mistaken for a promise', async () => {
    const vm = await createVM();
    expect(vm.evalScript('globalThis.r = {};').ok).toBe(true);
    const bound = bindYieldResults(vm, { kind: 'simple', names: ['r'] }, 1, ['ignored']);
    expect(bound['r']).toEqual({});
    vm.dispose();
  });
});

describe('turn loop — a missing await the lint deliberately lets through still binds a value', () => {
  it('binds the resolved value, not {}, for a call the lint cannot see (untyped wrapper)', async () => {
    const vm = await createVM();
    const y = (tag: string) =>
      new Promise((resolve, reject) => {
        vm.pendingYields.push({ kind: 'y', args: [tag], deferred: { resolve, reject }, vmPromiseHandle: undefined } as unknown as YieldRequest);
      });
    injectGlobal(vm.ctx, 'y', y as (...a: unknown[]) => unknown);
    // An async wrapper whose DTS return type is `any` (an un-annotated space function),
    // so it is not in the yielding set and the lint never fires on it — the safety net's
    // job alone. Its own await of `y()` is the real yield.
    expect(
      vm.evalScript('globalThis.wrapper = async function wrapper() { const inner = await y("tag"); return { processed: inner }; };').ok,
    ).toBe(true);

    const history = new MessageHistory();
    history.append({ role: 'user', content: 'go', blockType: 'normal' });

    const result = await runTurnLoop({
      vm,
      history,
      systemBlock: 'test',
      ambientDts: 'declare function wrapper(): any; declare function y(tag: string): Promise<any>;',
      renderHost: silentHost,
      streamFn: scriptedStream('const out = wrapper();'), // NO await — evades the lint
      processYield: async () => 'RESOLVED_VALUE',
      maxRetries: 2,
    });

    expect(result).toBe('done');
    // Before the binding rule this bound the QuickJS Promise, dumped as {} — the model
    // read "the tool returned nothing". Now it is the host-resolved value.
    expect(readGlobal(vm, 'out')).toBe('RESOLVED_VALUE');
    const varsMsg = history.messages.find((m) => m.blockType === 'variables');
    expect(varsMsg?.content).toContain('RESOLVED_VALUE');
    vm.dispose();
  });
});
