import { describe, it, expect } from 'vitest';
import { buildAmbientDts, CURRENT_TASK_DTS } from './bootstrap.js';
import { sessionCapabilities, forkCapabilities, delegateCapabilities } from './capability.js';
import { LIBRARY_DTS, LIBRARY_DTS_NO_ASK } from '../typecheck/library-dts.js';
import { runTsc } from '../typecheck/tsc.js';

/** Multiset of declared top-level names (functions/consts/interfaces/namespaces),
 *  sorted — duplicates (the two delegate overloads) count twice. Whitespace and
 *  declaration ORDER are explicitly not part of the contract. */
function declNames(dts: string): string[] {
  return [...dts.matchAll(/^declare\s+(?:function|const|namespace|interface)\s+([A-Za-z_$][\w$]*)/gm)]
    .map((m) => m[1]!)
    .sort();
}

const OVERLAY = 'declare function myFn(a: string): { ok: boolean };';
const DELEGATE_SEED_DECLS = ['declare const query: string;\ndeclare const context: Record<string, any>;'];

describe('buildAmbientDts — generic fs is removed from the model surface (only fs:scratch earns it)', () => {
  const session = buildAmbientDts({ capabilities: sessionCapabilities(), overlay: OVERLAY });
  const delegate = buildAmbientDts({ capabilities: delegateCapabilities(), overlay: OVERLAY, currentTask: true, extraDecls: DELEGATE_SEED_DECLS });
  const forkGeneral = buildAmbientDts({ capabilities: forkCapabilities('general', true), overlay: OVERLAY, currentTask: true });

  it('no non-scratch context declares readFileRaw/writeFileRaw/execShell/createScratch', () => {
    for (const [label, dts] of [['session', session], ['delegate', delegate], ['general fork', forkGeneral]] as const) {
      const names = declNames(dts);
      for (const gone of ['readFileRaw', 'writeFileRaw', 'execShell', 'createScratch']) {
        expect(names, `${label} must not declare ${gone}`).not.toContain(gone);
      }
    }
  });

  it('an fs:scratch agent declares execShell + createScratch (its sandbox), but NEVER writeFileRaw/readFileRaw', () => {
    const scratch = buildAmbientDts({ capabilities: delegateCapabilities(true, { 'fs:scratch': true }), currentTask: true });
    const names = declNames(scratch);
    expect(names).toContain('execShell');
    expect(names).toContain('createScratch');
    expect(names).not.toContain('writeFileRaw');
    expect(names).not.toContain('readFileRaw');
  });

  it('LIBRARY_DTS bundles keep the full raw-primitive set (for typecheckSource), even though no context emits them by default', () => {
    // host-tools.ts typecheckSource checks standalone space-function sources against
    // LIBRARY_DTS, which must still know readFileRaw/writeFileRaw/execShell (architect
    // builder bodies call them) — that is DISTINCT from the per-agent ambient DTS above.
    for (const bundle of [LIBRARY_DTS, LIBRARY_DTS_NO_ASK]) {
      expect(bundle).toContain('declare function execShell(');
      expect(bundle).toContain('declare function writeFileRaw(');
      expect(bundle).toContain('declare function readFileRaw(');
    }
  });
});

describe('buildAmbientDts — per-context declaration contract', () => {
  const session = buildAmbientDts({ capabilities: sessionCapabilities() });
  const forkPlain = buildAmbientDts({ capabilities: forkCapabilities('explore', false), currentTask: true });
  const forkDelegating = buildAmbientDts({ capabilities: forkCapabilities('general', true), currentTask: true });
  const delegate = buildAmbientDts({ capabilities: delegateCapabilities(), currentTask: true, extraDecls: DELEGATE_SEED_DECLS });

  it('session declares ask/tasklist/fork/delegate (2 overloads)', () => {
    const names = declNames(session);
    expect(names).toContain('ask');
    expect(names).toContain('tasklist');
    expect(names).toContain('fork');
    expect(names.filter((n) => n === 'delegate')).toHaveLength(2);
    expect(names).toContain('setSessionMeta');
    expect(names).not.toContain('currentTask');
  });

  it('read-only fork (explore) declares NONE of ask/tasklist/fork/delegate NOR any generic fs, but keeps the read-only common globals + currentTask', () => {
    const names = declNames(forkPlain);
    // Orchestration/session globals absent (headless leaf) AND the generic fs primitives
    // absent — the whole family (readFileRaw/writeFileRaw/execShell/createScratch) is off the
    // model surface unless the agent holds fs:scratch, which a fork role does not.
    for (const absent of ['ask', 'tasklist', 'fork', 'delegate', 'setSessionMeta', 'execShell', 'writeFileRaw', 'readFileRaw', 'createScratch']) {
      expect(names, `read-only fork DTS must not declare ${absent}`).not.toContain(absent);
    }
    for (const present of ['display', 'inspect', 'loadKnowledge', 'sleep', 'registerSpace', 'fetch', 'currentTask']) {
      expect(names).toContain(present);
    }
  });

  it('a general fork does NOT declare the generic fs primitives (no fs:scratch grant)', () => {
    const names = declNames(forkDelegating); // general role → allowWrite:true, but scratchFs:false
    for (const gone of ['execShell', 'writeFileRaw', 'readFileRaw', 'createScratch']) {
      expect(names).not.toContain(gone);
    }
  });

  it('fork WITH canDelegateTo gets exactly the delegate overloads back — still no ask/tasklist/fork', () => {
    const names = declNames(forkDelegating);
    expect(names.filter((n) => n === 'delegate')).toHaveLength(2);
    for (const absent of ['ask', 'tasklist', 'fork']) expect(names).not.toContain(absent);
  });

  it('delegate context has no ask but has fork/tasklist/delegate/currentTask/query/context', () => {
    const names = declNames(delegate);
    expect(names).not.toContain('ask');
    expect(names).not.toContain('setSessionMeta');
    for (const present of ['fork', 'tasklist', 'delegate', 'currentTask', 'query', 'context']) {
      expect(names).toContain(present);
    }
  });

  it('CURRENT_TASK_DTS is the exact declaration the old sites inlined', () => {
    expect(CURRENT_TASK_DTS).toBe('declare const currentTask: { resolve: (value: unknown) => void };');
  });
});

describe('buildAmbientDts — typecheck enforcement (stray calls fail cleanly)', () => {
  const forkPlain = buildAmbientDts({ capabilities: forkCapabilities('general', false), currentTask: true });
  const delegate = buildAmbientDts({ capabilities: delegateCapabilities(), currentTask: true });
  const session = buildAmbientDts({ capabilities: sessionCapabilities() });

  it('tasklist() fails typecheck in a fork but passes in a delegate', () => {
    const stmt = 'const r = await tasklist("flow");';
    expect(runTsc({ ambientDts: forkPlain, sessionContext: '', statement: stmt }).ok).toBe(false);
    expect(runTsc({ ambientDts: delegate, sessionContext: '', statement: stmt }).ok).toBe(true);
  });

  it('ask() fails typecheck in a delegate but passes in the session', () => {
    const stmt = 'const a = await ask("q?");';
    expect(runTsc({ ambientDts: delegate, sessionContext: '', statement: stmt }).ok).toBe(false);
    expect(runTsc({ ambientDts: session, sessionContext: '', statement: stmt }).ok).toBe(true);
  });

  it('setSessionMeta() fails typecheck in fork/delegate but passes in the session', () => {
    const stmt = 'const r = await setSessionMeta({ title: "T", slug: "s" });';
    expect(runTsc({ ambientDts: forkPlain, sessionContext: '', statement: stmt }).ok).toBe(false);
    expect(runTsc({ ambientDts: delegate, sessionContext: '', statement: stmt }).ok).toBe(false);
    expect(runTsc({ ambientDts: session, sessionContext: '', statement: stmt }).ok).toBe(true);
  });
});

describe('buildAmbientDts — connections:use gates callConnection', () => {
  const withGoogle = buildAmbientDts({
    capabilities: sessionCapabilities(true, { 'connections:use': { providers: ['google'] } }),
  });
  const withoutCap = buildAmbientDts({ capabilities: sessionCapabilities() });

  it('callConnection typechecks for a granted provider', () => {
    const stmt = 'const r = await callConnection("google", { method: "GET", path: "/x" }); const d = r.data;';
    expect(runTsc({ ambientDts: withGoogle, sessionContext: '', statement: stmt }).ok).toBe(true);
  });

  it('callConnection with a non-granted provider fails typecheck (provider union)', () => {
    const stmt = 'const r = await callConnection("slack", { method: "GET", path: "/x" });';
    expect(runTsc({ ambientDts: withGoogle, sessionContext: '', statement: stmt }).ok).toBe(false);
  });

  it('callConnection is absent without the connections:use grant', () => {
    const stmt = 'const r = await callConnection("google", { method: "GET", path: "/x" });';
    expect(runTsc({ ambientDts: withoutCap, sessionContext: '', statement: stmt }).ok).toBe(false);
  });
});
