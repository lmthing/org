/**
 * Generic host-enforced function consent (plan S10):
 *   - the `@consent` pragma detection on space-function sources,
 *   - the `__requestConsent` yield seam (host-built card),
 *   - the yield router's consent gate: consent-marked KINDS gated BEFORE their
 *     resolver runs (deny → structured refusal, no side effects; no prompter →
 *     FAIL CLOSED), unmarked kinds untouched,
 *   - the injection-time wrapper for consent-marked SPACE FUNCTIONS: yields
 *     first, runs the hidden impl only on approval, impl unreachable directly.
 */
import { describe, it, expect } from 'vitest';
import { createVM, type VM } from '../sandbox/quickjs.js';
import { injectGlobal } from '../sandbox/host-bridge.js';
import { injectSpaceFunctions } from '../sandbox/inject-functions.js';
import { routeCommonYield, type YieldRouterContext } from '../eval/yield-router.js';
import type { YieldRequest } from '../eval/yield.js';
import type { Space } from '../spaces/load.js';
import type { StoreResolver } from './store.js';
import {
  CONSENT_MARKED_YIELD_KINDS,
  createConsentRequestGlobal,
  enforceConsent,
  functionRequiresConsent,
  isConsentApproval,
  summarizeConsentArgs,
  createAskConsentPrompter,
  type ConsentCard,
} from './consent.js';

const noopDeferred = { resolve: () => {}, reject: () => {} };
function req(kind: YieldRequest['kind'], args: unknown[]): YieldRequest {
  return { kind, args, deferred: noopDeferred, vmPromiseHandle: undefined } as YieldRequest;
}

function baseCtx(over: Partial<YieldRouterContext> = {}): YieldRouterContext {
  return {
    space: {} as Space,
    runDelegate: async () => {
      throw new Error('runDelegate not expected');
    },
    ...over,
  };
}

/** Eval an expression and dump the result back to the host. */
function evalDump(vm: VM, code: string): unknown {
  const res = vm.ctx.evalCode(code);
  if (res.error) {
    const err = vm.ctx.dump(res.error);
    res.error.dispose();
    throw new Error(`eval error: ${JSON.stringify(err)}`);
  }
  const value = vm.ctx.dump(res.value);
  res.value.dispose();
  return value;
}

const tick = () => new Promise<void>((r) => setTimeout(r, 0));

describe('functionRequiresConsent — the @consent pragma', () => {
  it('detects a leading JSDoc @consent', () => {
    expect(functionRequiresConsent('/** Deploys.\n * @consent\n */\nexport default function () {}')).toBe(true);
  });

  it('detects a leading line-comment @consent', () => {
    expect(functionRequiresConsent('// @consent — destructive\nexport default () => {};')).toBe(true);
  });

  it('ignores @consent inside the function body (not leading trivia)', () => {
    expect(functionRequiresConsent('export default function () {\n  // @consent\n  return 1;\n}')).toBe(false);
  });

  it('is false without the pragma', () => {
    expect(functionRequiresConsent('/** Plain fn. */\nexport default function () {}')).toBe(false);
  });
});

describe('summarizeConsentArgs / isConsentApproval', () => {
  it('renders compact JSON and truncates hostile payloads', () => {
    expect(summarizeConsentArgs(['integration-slack'])).toBe('["integration-slack"]');
    const huge = summarizeConsentArgs(['x'.repeat(10_000)]);
    expect(huge.length).toBeLessThanOrEqual(301); // cap + ellipsis
  });

  it('accepts only explicit approvals', () => {
    expect(isConsentApproval(true)).toBe(true);
    expect(isConsentApproval('approve')).toBe(true);
    expect(isConsentApproval({ approved: true })).toBe(true);
    expect(isConsentApproval(null)).toBe(false); // cancelled ask
    expect(isConsentApproval(false)).toBe(false);
    expect(isConsentApproval('yes-ish')).toBe(false);
  });
});

describe('enforceConsent — the single enforcement primitive', () => {
  const card: ConsentCard = { function: 'installSpace', argsSummary: '["x"]' };

  it('FAILS CLOSED without a prompter (headless/fork/delegate contexts)', async () => {
    await expect(enforceConsent(undefined, card)).rejects.toThrow(/requires user consent.*interactive/i);
  });

  it('throws the structured refusal on denial', async () => {
    await expect(enforceConsent(async () => false, card)).rejects.toThrow(/consent denied.*declined "installSpace"/i);
  });

  it('returns silently on approval', async () => {
    await expect(enforceConsent(async () => true, card)).resolves.toBeUndefined();
  });
});

describe('createAskConsentPrompter — the renderHost.ask ride', () => {
  it('renders a ConsentCard descriptor and maps the submission to a boolean', async () => {
    const asked: Array<{ id: string; descriptor: unknown }> = [];
    const prompter = createAskConsentPrompter({
      ask: async (id, descriptor) => {
        asked.push({ id, descriptor });
        return { approved: true };
      },
    });
    const granted = await prompter({ function: 'installSpace', space: 'sys', argsSummary: '["x"]' });
    expect(granted).toBe(true);
    const desc = asked[0]!.descriptor as { type: string; props: Record<string, unknown> };
    expect(desc.type).toBe('ConsentCard');
    expect(desc.props).toEqual({ function: 'installSpace', space: 'sys', argsSummary: '["x"]' });
  });

  it('treats a cancelled ask (null) as denial', async () => {
    const prompter = createAskConsentPrompter({ ask: async () => null });
    expect(await prompter({ function: 'f', argsSummary: '[]' })).toBe(false);
  });
});

describe('yield router — consent-marked GLOBAL kinds gated before execution', () => {
  it('installSpace is registered as consent-marked', () => {
    expect(CONSENT_MARKED_YIELD_KINDS.has('installSpace')).toBe(true);
  });

  it('deny → structured refusal and the resolver is NEVER called (no side effects)', async () => {
    let installCalled = false;
    const store: StoreResolver = {
      search: async () => [],
      inspect: async () => undefined,
      install: async () => {
        installCalled = true;
        return { ok: true, spaceId: 'x', installedDir: '/nope' };
      },
    };
    await expect(
      routeCommonYield(req('installSpace', ['x']), baseCtx({ storeResolver: store, requestConsent: async () => false })),
    ).rejects.toThrow(/consent denied/i);
    expect(installCalled).toBe(false);
  });

  it('no prompter → FAILS CLOSED and the resolver is never called', async () => {
    let installCalled = false;
    const store: StoreResolver = {
      search: async () => [],
      inspect: async () => undefined,
      install: async () => {
        installCalled = true;
        return { ok: true, spaceId: 'x', installedDir: '/nope' };
      },
    };
    await expect(
      routeCommonYield(req('installSpace', ['x']), baseCtx({ storeResolver: store })),
    ).rejects.toThrow(/requires user consent/i);
    expect(installCalled).toBe(false);
  });

  it('the card carries the kind + host-summarized args', async () => {
    const cards: ConsentCard[] = [];
    const store: StoreResolver = {
      search: async () => [],
      inspect: async () => undefined,
      install: async (spaceId) => ({ ok: false, spaceId, error: 'stop here' }),
    };
    await routeCommonYield(
      req('installSpace', ['integration-slack']),
      baseCtx({
        storeResolver: store,
        requestConsent: async (card) => {
          cards.push(card);
          return true;
        },
      }),
    );
    expect(cards).toEqual([{ function: 'installSpace', argsSummary: '["integration-slack"]' }]);
  });

  it('an UNMARKED kind (storeSearch) never consults the prompter', async () => {
    let prompted = false;
    const store: StoreResolver = {
      search: async () => [{ id: 'a' }],
      inspect: async () => undefined,
      install: async () => ({ ok: false, spaceId: 'x' }),
    };
    const r = await routeCommonYield(
      req('storeSearch', [undefined]),
      baseCtx({
        storeResolver: store,
        requestConsent: async () => {
          prompted = true;
          return false;
        },
      }),
    );
    expect(r).toEqual({ handled: true, value: [{ id: 'a' }] });
    expect(prompted).toBe(false);
  });
});

describe('yield router — the `consent` kind (space-function wrappers)', () => {
  const card: ConsentCard = { function: 'deploy', space: 'ops', argsSummary: '["prod"]' };

  it('resolves { granted: true } on approval, passing the card through verbatim', async () => {
    const seen: ConsentCard[] = [];
    const r = await routeCommonYield(
      req('consent', [card]),
      baseCtx({
        requestConsent: async (c) => {
          seen.push(c);
          return true;
        },
      }),
    );
    expect(r).toEqual({ handled: true, value: { granted: true } });
    expect(seen).toEqual([card]);
  });

  it('rejects with the refusal on denial and FAILS CLOSED without a prompter', async () => {
    await expect(
      routeCommonYield(req('consent', [card]), baseCtx({ requestConsent: async () => false })),
    ).rejects.toThrow(/consent denied/i);
    await expect(routeCommonYield(req('consent', [card]), baseCtx())).rejects.toThrow(/requires user consent/i);
  });
});

describe('space-function consent wrapper (injection-time, in a real VM)', () => {
  const CONSENT_FN = '/** Dangerous.\n * @consent\n */\nexport default function (target) { globalThis.__ran = target; return "done:" + target; }';

  async function vmWithConsentFn(yields: YieldRequest[]): Promise<VM> {
    const vm = await createVM();
    injectGlobal(
      vm.ctx,
      '__requestConsent',
      createConsentRequestGlobal((r) => yields.push(r), 'ops') as (...a: unknown[]) => unknown,
    );
    injectSpaceFunctions(vm, { deploy: CONSENT_FN }, {}, () => {});
    return vm;
  }

  it('yields the consent card BEFORE executing; approval runs the impl', async () => {
    const yields: YieldRequest[] = [];
    const vm = await vmWithConsentFn(yields);
    evalDump(vm, 'globalThis.__p = deploy("prod"); "kicked"');

    // The consent yield fired synchronously; the impl has NOT run.
    expect(yields).toHaveLength(1);
    expect(yields[0]!.kind).toBe('consent');
    expect(yields[0]!.args[0]).toEqual({ function: 'deploy', space: 'ops', argsSummary: '["prod"]' });
    expect(evalDump(vm, 'globalThis.__ran === undefined')).toBe(true);

    // Host approves → the wrapper proceeds to the hidden impl.
    yields[0]!.deferred.resolve({ granted: true });
    await tick();
    expect(evalDump(vm, 'globalThis.__ran')).toBe('prod');
    vm.dispose();
  });

  it('denial (rejected yield) → the impl NEVER runs', async () => {
    const yields: YieldRequest[] = [];
    const vm = await vmWithConsentFn(yields);
    evalDump(vm, 'globalThis.__err = null; deploy("prod").catch(function (e) { globalThis.__err = String(e); }); "kicked"');
    expect(yields).toHaveLength(1);

    yields[0]!.deferred.reject(new Error('consent denied: the user declined "deploy"'));
    await tick();
    expect(evalDump(vm, 'globalThis.__ran === undefined')).toBe(true);
    expect(evalDump(vm, 'String(globalThis.__err)')).toContain('consent denied');
    vm.dispose();
  });

  it('the unwrapped impl is unreachable from sandbox code', async () => {
    const yields: YieldRequest[] = [];
    const vm = await vmWithConsentFn(yields);
    // The only global binding is the wrapper; calling it always yields first.
    evalDump(vm, 'deploy("x"); "kicked"');
    expect(yields).toHaveLength(1);
    // No secondary binding (e.g. an unwrapped `deploy` impl) exists anywhere.
    const names = evalDump(vm, 'Object.getOwnPropertyNames(globalThis).filter(function (n) { return n.indexOf("deploy") !== -1; })');
    expect(names).toEqual(['deploy']);
    vm.dispose();
  });

  it('an UNMARKED function is injected directly — synchronous, no yield', async () => {
    const yields: YieldRequest[] = [];
    const vm = await createVM();
    injectGlobal(
      vm.ctx,
      '__requestConsent',
      createConsentRequestGlobal((r) => yields.push(r)) as (...a: unknown[]) => unknown,
    );
    injectSpaceFunctions(vm, { dbl: 'export default (n) => n * 2;' }, {}, () => {});
    expect(evalDump(vm, 'dbl(21)')).toBe(42);
    expect(yields).toHaveLength(0);
    vm.dispose();
  });
});
