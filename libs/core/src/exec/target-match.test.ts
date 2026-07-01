import { describe, it, expect } from 'vitest';
import { refMatchesDelegateCall, resolveTaskDelegate } from './target-match.js';

/**
 * Table-driven coverage of the UNIFIED delegate-target matcher — the union of
 * the two pre-unification matchers:
 *  - fork.ts resolveTaskDelegate: space-part tolerance
 *      pkg === packageName || packageName.endsWith('/'+pkg) || pkg.endsWith('/'+packageName)
 *  - delegate.ts inline directDeps.find: full-target tolerance
 *      target === packageName || target.endsWith('/'+packageName) || packageName.endsWith('/'+target)
 */
describe('refMatchesDelegateCall (unified matcher)', () => {
  const cases: Array<{ ref: string; pkg: string; agent: string; want: boolean; why: string }> = [
    // exact space/agent
    { ref: 'sp/ag', pkg: 'sp', agent: 'ag', want: true, why: 'exact match' },
    { ref: 'sp/ag', pkg: 'sp', agent: 'other', want: false, why: 'agent mismatch' },
    { ref: 'sp/ag', pkg: 'other', agent: 'ag', want: false, why: 'space mismatch' },
    // action suffix is ignored here (gating happens in resolveTaskDelegate)
    { ref: 'sp/ag#act', pkg: 'sp', agent: 'ag', want: true, why: '#action stripped for matching' },
    // dir-suffix tolerance, both directions (old fork matcher)
    { ref: 'deep/nested/sp/ag', pkg: 'sp', agent: 'ag', want: true, why: 'entry space dir-suffix matches bare pkg' },
    { ref: 'sp/ag', pkg: '/abs/path/sp', agent: 'ag', want: true, why: 'call pkg dir-suffix matches entry space' },
    { ref: 'sp/ag', pkg: 'nosp', agent: 'ag', want: false, why: 'suffix must be a path segment' },
    // full-target tolerance (old delegate matcher): whole "space/agent" passed as packageName
    { ref: 'sp/ag', pkg: 'sp/ag', agent: 'ag', want: true, why: 'full target as packageName' },
    { ref: 'sp/ag', pkg: '/abs/sp/ag', agent: 'ag', want: true, why: 'full target as packageName dir-suffix' },
    // bare self-scope entries: package part compares the agent slug itself (old fork behavior)
    { ref: 'ag', pkg: 'ag', agent: 'ag', want: true, why: 'bare entry, pkg equals agent slug' },
    { ref: 'ag', pkg: 'x/ag', agent: 'ag', want: true, why: 'bare entry, pkg dir-suffix of agent slug' },
    { ref: 'ag', pkg: 'sp', agent: 'ag', want: false, why: 'bare entry does not match an unrelated pkg' },
    // npm: prefix (parseDelegateRef strips it — the old hand-rolled parsers did not; union accepts)
    { ref: 'npm:pkg/ag', pkg: 'pkg', agent: 'ag', want: true, why: 'npm-prefixed entry' },
    { ref: 'npm:@org/space/ag', pkg: '@org/space', agent: 'ag', want: true, why: 'scoped npm package' },
    // unparseable refs never match
    { ref: 'npm:agentonly', pkg: 'agentonly', agent: 'agentonly', want: false, why: 'invalid npm ref (no pkg/agent path)' },
    // wildcard entries carry no matcher semantics here (Phase 5 territory)
    { ref: 'sp/*', pkg: 'sp', agent: 'ag', want: false, why: 'wildcard agent does not match a concrete agent' },
  ];

  for (const c of cases) {
    it(`${c.ref} vs delegate("${c.pkg}", "${c.agent}") → ${c.want} (${c.why})`, () => {
      expect(refMatchesDelegateCall(c.ref, c.pkg, c.agent)).toBe(c.want);
    });
  }
});

describe('resolveTaskDelegate (allowlist over the unified matcher)', () => {
  it('allows a matching target and scopes the action', () => {
    const r = resolveTaskDelegate(['system-research/researcher#deep_research'], 'system-research', 'researcher');
    expect(r).toEqual({ allowedActions: ['deep_research'] });
  });

  it('allows ANY action when the entry has no #action', () => {
    expect(resolveTaskDelegate(['sp/ag'], 'sp', 'ag')).toEqual({ allowedActions: undefined });
  });

  it('aggregates actions across entries for the same target', () => {
    expect(resolveTaskDelegate(['sp/ag#a', 'sp/ag#b'], 'sp', 'ag')).toEqual({ allowedActions: ['a', 'b'] });
  });

  it('an action-less entry absorbs action-scoped ones (any action allowed)', () => {
    expect(resolveTaskDelegate(['sp/ag#a', 'sp/ag'], 'sp', 'ag')).toEqual({ allowedActions: undefined });
  });

  it('a trailing empty "#" means any action (old `action || undefined` behavior)', () => {
    expect(resolveTaskDelegate(['sp/ag#'], 'sp', 'ag')).toEqual({ allowedActions: undefined });
  });

  it('denies a target not in the allowlist', () => {
    expect(resolveTaskDelegate(['sp/ag#x'], 'other', 'ag')).toBeNull();
    expect(resolveTaskDelegate(['sp/ag#x'], 'sp', 'nope')).toBeNull();
    expect(resolveTaskDelegate([], 'sp', 'ag')).toBeNull();
  });

  it('accepts dir-suffix and npm-prefixed forms (union of both old matchers)', () => {
    expect(resolveTaskDelegate(['deep/sp/ag#go'], 'sp', 'ag')).toEqual({ allowedActions: ['go'] });
    expect(resolveTaskDelegate(['sp/ag#go'], '/abs/path/sp', 'ag')).toEqual({ allowedActions: ['go'] });
    expect(resolveTaskDelegate(['npm:pkg/ag#go'], 'pkg', 'ag')).toEqual({ allowedActions: ['go'] });
    // full-target-as-packageName tolerance (old delegate-side form)
    expect(resolveTaskDelegate(['sp/ag#go'], 'sp/ag', 'ag')).toEqual({ allowedActions: ['go'] });
  });

  it('bare self-scope entries keep the old fork semantics (pkg compares the slug)', () => {
    expect(resolveTaskDelegate(['ag'], 'ag', 'ag')).toEqual({ allowedActions: undefined });
    expect(resolveTaskDelegate(['ag#go'], 'x/ag', 'ag')).toEqual({ allowedActions: ['go'] });
    expect(resolveTaskDelegate(['ag'], 'sp', 'ag')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Unified canDelegateTo policy (Phase 5)
// ---------------------------------------------------------------------------

import {
  evaluateDelegatePolicy,
  isDelegateAllowed,
  matchesRegisteredSpace,
  formatDelegateDenial,
  REGISTERED_WILDCARD,
} from './target-match.js';

describe('evaluateDelegatePolicy', () => {
  it('omitted: agent level defaults to unrestricted (back-compat), task level to none', () => {
    expect(evaluateDelegatePolicy(undefined, 'agent')).toEqual({ mode: 'unrestricted', entries: [], allowRegistered: false });
    expect(evaluateDelegatePolicy(undefined, 'task')).toEqual({ mode: 'none', entries: [], allowRegistered: false });
  });

  it('[] means NO delegation at BOTH levels', () => {
    expect(evaluateDelegatePolicy([], 'agent').mode).toBe('none');
    expect(evaluateDelegatePolicy([], 'task').mode).toBe('none');
  });

  it('["*"] means explicitly unrestricted at both levels', () => {
    expect(evaluateDelegatePolicy(['*'], 'agent').mode).toBe('unrestricted');
    expect(evaluateDelegatePolicy(['*'], 'task').mode).toBe('unrestricted');
    // "*" absorbs anything else listed alongside it
    expect(evaluateDelegatePolicy(['sp/ag', '*'], 'agent').mode).toBe('unrestricted');
  });

  it('an explicit list is an allowlist; registered:* is split out as a flag', () => {
    expect(evaluateDelegatePolicy(['sp/ag', 'x/y#act'], 'agent')).toEqual({
      mode: 'allowlist', entries: ['sp/ag', 'x/y#act'], allowRegistered: false,
    });
    expect(evaluateDelegatePolicy(['sp/ag', REGISTERED_WILDCARD], 'task')).toEqual({
      mode: 'allowlist', entries: ['sp/ag'], allowRegistered: true,
    });
    // registered:* alone is still an allowlist (NOT unrestricted)
    expect(evaluateDelegatePolicy([REGISTERED_WILDCARD], 'agent')).toEqual({
      mode: 'allowlist', entries: [], allowRegistered: true,
    });
  });
});

describe('matchesRegisteredSpace', () => {
  const dyn = new Map<string, { dir: string; packageName?: string }>([
    ['/tmp/projects/regspace', { dir: '/tmp/projects/regspace', packageName: '@org/regspace' }],
  ]);

  it('matches by map key, dir (with suffix tolerance) and package name', () => {
    expect(matchesRegisteredSpace('/tmp/projects/regspace', dyn)).toBe(true);
    expect(matchesRegisteredSpace('regspace', dyn)).toBe(true); // dir-suffix tolerance
    expect(matchesRegisteredSpace('@org/regspace', dyn)).toBe(true);
  });

  it('rejects unregistered names and handles an absent map', () => {
    expect(matchesRegisteredSpace('otherspace', dyn)).toBe(false);
    expect(matchesRegisteredSpace('regspace', undefined)).toBe(false);
  });
});

describe('isDelegateAllowed (the yield-time gate)', () => {
  const dyn = new Map<string, { dir: string; packageName?: string }>([
    ['/dyn/regspace', { dir: '/dyn/regspace' }],
  ]);

  it('none denies everything; unrestricted allows everything', () => {
    expect(isDelegateAllowed(evaluateDelegatePolicy([], 'agent'), 'sp', 'ag')).toEqual({ allowed: false });
    expect(isDelegateAllowed(evaluateDelegatePolicy(undefined, 'agent'), 'sp', 'ag')).toEqual({ allowed: true });
    expect(isDelegateAllowed(evaluateDelegatePolicy(['*'], 'task'), 'anything', 'ag')).toEqual({ allowed: true });
  });

  it('allowlist: in-list targets pass with the entry-derived action scope; out-of-list deny', () => {
    const policy = evaluateDelegatePolicy(['sp/ag#go', 'other/agent'], 'agent');
    expect(isDelegateAllowed(policy, 'sp', 'ag')).toEqual({ allowed: true, allowedActions: ['go'] });
    expect(isDelegateAllowed(policy, 'other', 'agent')).toEqual({ allowed: true, allowedActions: undefined });
    expect(isDelegateAllowed(policy, 'evil', 'ag')).toEqual({ allowed: false });
  });

  it('registered:* allows a dynamicSpaces-registered target (any action); unregistered still denies', () => {
    const policy = evaluateDelegatePolicy(['sp/ag', REGISTERED_WILDCARD], 'agent');
    expect(isDelegateAllowed(policy, '/dyn/regspace', 'helper', dyn)).toEqual({ allowed: true });
    expect(isDelegateAllowed(policy, '/dyn/unregistered', 'helper', dyn)).toEqual({ allowed: false });
    // same registered target WITHOUT registered:* in the list denies
    const noReg = evaluateDelegatePolicy(['sp/ag'], 'agent');
    expect(isDelegateAllowed(noReg, '/dyn/regspace', 'helper', dyn)).toEqual({ allowed: false });
  });
});

describe('formatDelegateDenial', () => {
  it('names the allowed targets (incl. the registered:* grant) and the level', () => {
    const policy = evaluateDelegatePolicy(['sp/ag#go', REGISTERED_WILDCARD], 'agent');
    const msg = formatDelegateDenial(policy, 'evil', 'agent', 'agent');
    expect(msg).toContain('delegate("evil", "agent")');
    expect(msg).toContain('this agent');
    expect(msg).toContain('sp/ag#go');
    expect(msg).toContain('registerSpace()');
  });

  it('explains an empty policy at task level', () => {
    const msg = formatDelegateDenial(evaluateDelegatePolicy([], 'task'), 'sp', 'ag', 'task');
    expect(msg).toContain('this task');
    expect(msg).toContain('canDelegateTo: []');
  });
});
