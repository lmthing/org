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
const FORK_SEED_DECLS = ['declare const upstreamTask: any;', 'declare const seedVar: any;'];
const DELEGATE_SEED_DECLS = ['declare const query: string;\ndeclare const context: Record<string, any>;'];

describe('buildAmbientDts — declaration-set equivalence with the pre-unification assembly', () => {
  it('session context ≡ old `LIBRARY_DTS + overlay`', () => {
    const oldDts = LIBRARY_DTS + '\n' + OVERLAY;
    const newDts = buildAmbientDts({ capabilities: sessionCapabilities(), overlay: OVERLAY });
    expect(declNames(newDts)).toEqual(declNames(oldDts));
  });

  it('delegate context ≡ old `LIBRARY_DTS_NO_ASK + overlay + currentTask + seed`', () => {
    const currentTaskDts = `declare const currentTask: { resolve: (value: unknown) => void };`;
    const seedDts = `declare const query: string;\ndeclare const context: Record<string, any>;`;
    const oldDts = LIBRARY_DTS_NO_ASK + '\n' + OVERLAY + '\n' + currentTaskDts + '\n' + seedDts;
    const newDts = buildAmbientDts({
      capabilities: delegateCapabilities(),
      overlay: OVERLAY,
      currentTask: true,
      extraDecls: DELEGATE_SEED_DECLS,
    });
    expect(declNames(newDts)).toEqual(declNames(oldDts));
  });

  it('fork context (no canDelegateTo) ≡ old regex-stripped LIBRARY_DTS_NO_ASK assembly', () => {
    // Replicates the deleted fork.ts string surgery exactly.
    const forkBaseDts = LIBRARY_DTS_NO_ASK.replace(/^declare function (tasklist|fork|delegate)\b.*\r?\n/gm, '');
    const currentTaskDts = `declare const currentTask: { resolve: (value: unknown) => void };`;
    const oldDts = [forkBaseDts, '', OVERLAY, currentTaskDts, 'declare const upstreamTask: any;', 'declare const seedVar: any;']
      .filter(Boolean)
      .join('\n');
    const newDts = buildAmbientDts({
      capabilities: forkCapabilities('general', false),
      overlay: OVERLAY,
      currentTask: true,
      extraDecls: FORK_SEED_DECLS,
    });
    expect(declNames(newDts)).toEqual(declNames(oldDts));
  });

  it('fork context WITH canDelegateTo ≡ old assembly with the delegate overloads added back', () => {
    const forkBaseDts = LIBRARY_DTS_NO_ASK.replace(/^declare function (tasklist|fork|delegate)\b.*\r?\n/gm, '');
    const delegateDts =
      'declare function delegate(packageName: string, agentName: string, opts?: DelegateOpts): Promise<any>;\n'
      + 'declare function delegate(packageName: string, agentName: string, action?: string, opts?: DelegateOpts): Promise<any>;';
    const currentTaskDts = `declare const currentTask: { resolve: (value: unknown) => void };`;
    const oldDts = [forkBaseDts, delegateDts, OVERLAY, currentTaskDts].filter(Boolean).join('\n');
    const newDts = buildAmbientDts({
      capabilities: forkCapabilities('general', true),
      overlay: OVERLAY,
      currentTask: true,
    });
    expect(declNames(newDts)).toEqual(declNames(oldDts));
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

  it('fork (no canDelegateTo) declares NONE of ask/tasklist/fork/delegate, but keeps the common globals + currentTask', () => {
    const names = declNames(forkPlain);
    for (const absent of ['ask', 'tasklist', 'fork', 'delegate', 'setSessionMeta']) expect(names).not.toContain(absent);
    for (const present of ['display', 'inspect', 'loadKnowledge', 'sleep', 'registerSpace', 'fetch', 'execShell', 'readFileRaw', 'writeFileRaw', 'currentTask']) {
      expect(names).toContain(present);
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
