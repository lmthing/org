import { describe, expect, it } from 'vitest';
import {
  appState,
  bindingCoverage,
  bricking,
  forks,
  gateBuild,
  gateRenderSmoke,
  gateValidateViews,
  judgeInvariants,
  layoutOverride,
  modelPin,
  procrustean,
  retriesPerWrite,
  shellOverride,
  tokens,
  visualGate,
  vocabularyGap,
  wallClock,
} from '../lib/metrics.mjs';

// ── minimal synthetic fixtures — no full run needed, just the shapes each function reads ──────────

/** A `views` object shaped like `artifacts.mjs#loadProjectViews`'s return. */
function views({ found = true, pages = [], components = [], shell = null } = {}) {
  return { found, pages, components, shell, projectDir: '/fake', pagesDir: '/fake/pages', malformed: [] };
}

/** A page entry as `loadProjectViews` produces it. */
function page(route, spec = {}) {
  return { route, file: `/fake/pages/${route}.view.json`, spec };
}

/** A digest shaped like `scope.mjs#digestTrace`'s return, defaults are the "nothing happened" state. */
function digest(overrides = {}) {
  return {
    events: 0,
    llmCalls: 0,
    tokens: { in: 0, out: 0 },
    models: {},
    forks: 0,
    tasks: {},
    writerCalls: [],
    writerErrors: [],
    writerTypecheckErrors: [],
    errorCounts: { eval_error: 0, typecheck_error: 0 },
    unrecoveredErrors: 0,
    scopeValues: {},
    scopeUnparsed: [],
    cannotExpressStatements: [],
    lastText: null,
    durationMs: null,
    ...overrides,
  };
}

// ── the contract every metric obeys: null-with-reason beats a misleading 0 ─────────────────────────

describe('null vs. 0 — the metrics.mjs contract', () => {
  it('layoutOverride: zero pages built ⇒ null, NOT 0 (a vacuous denominator is not a pass)', () => {
    const m = layoutOverride({ views: views({ pages: [] }) });
    expect(m.value).toBeNull();
    expect(m.reason).toMatch(/zero view specs/);
  });

  it('layoutOverride: pages exist and none set an explicit layout ⇒ a genuine 0, not null', () => {
    const m = layoutOverride({ views: views({ pages: [page('a', {}), page('b', {})] }) });
    expect(m.value).toBe(0);
    expect(m.reason).toBeNull();
  });

  it('bricking: app state "not-built" ⇒ null (cannot claim 0-by-construction over nothing built)', () => {
    const app = appState({ views: views({ pages: [] }), openApp: null, verify: null });
    expect(app.state).toBe('not-built');
    const m = bricking({ app, openApp: null, verify: null });
    expect(m.value).toBeNull();
    expect(m.reason).toMatch(/not-built/);
  });

  it('bricking: a usable app with a verify object that ran ⇒ a genuine 0, distinct from the null case', () => {
    const app = appState({ views: views({ pages: [page('a')] }), openApp: null, verify: { built: true } });
    expect(app.state).toBe('usable');
    const m = bricking({ app, openApp: null, verify: { built: true } });
    expect(m.value).toBe(0);
    expect(m.reason).toBeNull();
  });

  it('bricking: a bricked app (appCheck failed) ⇒ 1, not null', () => {
    const openApp = { appCheck: { ok: false, errorCount: 3 }, appBuild: null, appPageStatus: null };
    const app = appState({ views: views({ pages: [page('a')] }), openApp, verify: null });
    expect(app.state).toBe('bricked');
    const m = bricking({ app, openApp, verify: null });
    expect(m.value).toBe(1);
  });

  it('retriesPerWrite: writes attempted but ZERO landed ⇒ null (wiring failure, not a retry rate)', () => {
    const d = digest({ writerCalls: [{ writer: 'writeProjectView' }], writerErrors: [] });
    const m = retriesPerWrite({ digest: d, views: views({ pages: [] }) });
    expect(m.value).toBeNull();
    expect(m.reason).toMatch(/ZERO landed/);
  });

  it('retriesPerWrite: writes landed with zero rejections ⇒ a genuine 0', () => {
    const d = digest({ writerCalls: [{ writer: 'writeProjectView' }], writerErrors: [] });
    const m = retriesPerWrite({ digest: d, views: views({ pages: [page('a')] }) });
    expect(m.value).toBe(0);
    expect(m.reason).toBeNull();
  });

  it('retriesPerWrite: rejections are counted, host faults are not (capability-wiring bugs are a different metric)', () => {
    const d = digest({
      writerCalls: [{ writer: 'writeProjectView' }, { writer: 'writeProjectView' }],
      writerErrors: [
        { classified: 'writer-rejection', writer: 'writeProjectView', message: 'section id must be lowerCamelCase' },
        { classified: 'host-fault', writer: 'writeProjectView', message: "'writeProjectView' is not defined" },
      ],
    });
    const m = retriesPerWrite({ digest: d, views: views({ pages: [page('a'), page('b')] }) });
    // 1 rejection over 2 landed artifacts — the host fault must not inflate the numerator.
    expect(m.value).toBe(0.5);
    expect(m.detail.hostFaults).toBe(1);
  });

  it('vocabularyGap: plan_views never resolved into any trace ⇒ null', () => {
    const m = vocabularyGap({ digest: digest() });
    expect(m.value).toBeNull();
    expect(m.reason).toMatch(/never resolved/);
  });

  it('vocabularyGap: plan_views resolved with zero pages planned ⇒ null (no denominator)', () => {
    const d = digest({ scopeValues: { plan_views: { value: [], ts: 0, fromContext: null } } });
    const m = vocabularyGap({ digest: d });
    expect(m.value).toBeNull();
    expect(m.reason).toMatch(/empty array/);
  });

  it('vocabularyGap: pages planned with no cannotExpress ⇒ a genuine 0', () => {
    const d = digest({
      scopeValues: { plan_views: { value: [{ route: 'a', cannotExpress: [] }, { route: 'b' }], ts: 0, fromContext: null } },
    });
    const m = vocabularyGap({ digest: d });
    expect(m.value).toBe(0);
  });

  it('vocabularyGap: one page out of two declares cannotExpress ⇒ 0.5, not 0 and not null', () => {
    const d = digest({
      scopeValues: {
        plan_views: {
          value: [{ route: 'a', cannotExpress: [{ part: 'week grid', reason: 'no timeline kind' }] }, { route: 'b', cannotExpress: [] }],
          ts: 0,
          fromContext: null,
        },
      },
    });
    const m = vocabularyGap({ digest: d });
    expect(m.value).toBe(0.5);
    expect(m.detail.pagesWithGap).toBe(1);
  });

  it('procrustean: no judge.json ⇒ null (a force-fit passes every gate, so it can only be judged)', () => {
    const m = procrustean({ judge: null, views: views({ pages: [page('a')] }) });
    expect(m.value).toBeNull();
  });

  it('procrustean: judge.json present with an empty findings array ⇒ a genuine 0', () => {
    const m = procrustean({ judge: { procrustean: [] }, views: views({ pages: [page('a'), page('b')] }) });
    expect(m.value).toBe(0);
  });

  it('shellOverride: no shell on disk ⇒ null (15b always writes one — its absence is a pipeline failure)', () => {
    const m = shellOverride({ views: views({ pages: [page('a')], shell: null }) });
    expect(m.value).toBeNull();
    expect(m.reason).toMatch(/no pages\/_shell\.view\.json/);
  });

  it('shellOverride: a derived shell (no groups, auto placement) ⇒ a genuine 0', () => {
    const m = shellOverride({ views: views({ pages: [page('a')], shell: { spec: {} } }) });
    expect(m.value).toBe(0);
  });

  it('shellOverride: an UNFORCED override (few routes, explicit groups) ⇒ 1', () => {
    const m = shellOverride({ views: views({ pages: [page('a')], shell: { spec: { groups: [{ label: 'x' }] } } }) });
    expect(m.value).toBe(1);
    expect(m.detail.verdict).toMatch(/UNFORCED/);
  });

  it('shellOverride: a FORCED override (>5 top-level static routes) scores 0, not 1 — it is the correct answer', () => {
    const routes = ['a', 'b', 'c', 'd', 'e', 'f'].map((r) => page(r));
    const m = shellOverride({ views: views({ pages: routes, shell: { spec: { groups: [{ label: 'x' }] } } }) });
    expect(m.value).toBe(0);
    expect(m.detail.forced).toBe(true);
  });
});

// ── the remaining metrics: at least one null path + one measured path each ─────────────────────────

describe('gate metrics', () => {
  it('gateBuild: no verify and no open_app evidence ⇒ null', () => {
    const m = gateBuild({ verify: null, openApp: null });
    expect(m.value).toBeNull();
  });

  it('gateBuild: falls back to step evidence appCheck when verify is unavailable', () => {
    const m = gateBuild({ verify: null, openApp: { appCheck: { ok: false, errorCount: 4 } } });
    expect(m.value).toBe(4);
  });

  it('gateBuild: verify present, findings counted from typecheck+bundle phases only', () => {
    const verify = { offending: [{ path: 'a.ts', errors: [{ phase: 'typecheck', message: 'x' }, { phase: 'views', message: 'y' }] }] };
    const m = gateBuild({ verify, openApp: null });
    expect(m.value).toBe(1);
  });

  it('gateValidateViews: viewsValidated:false ⇒ null, the gate DID NOT RUN, never a 0', () => {
    const m = gateValidateViews({ verify: { viewsValidated: false } });
    expect(m.value).toBeNull();
    expect(m.reason).toMatch(/DID NOT RUN/);
  });

  it('gateValidateViews: viewsValidated:true with no findings ⇒ a genuine 0', () => {
    const m = gateValidateViews({ verify: { viewsValidated: true, offending: [] } });
    expect(m.value).toBe(0);
  });

  it('gateRenderSmoke: renderSmoked:false ⇒ null, never a misleading 0', () => {
    const m = gateRenderSmoke({ verify: { renderSmoked: false } });
    expect(m.value).toBeNull();
  });

  it('bindingCoverage: judge-supplied number wins over everything else', () => {
    const m = bindingCoverage({ verify: null, judge: { bindingCoverage: 0.77 } });
    expect(m.value).toBe(0.77);
  });

  it('bindingCoverage: renderSmokeViews ran but the percentage never reached any artifact ⇒ "not-measured", not 100%', () => {
    const m = bindingCoverage({ verify: { renderSmoked: true, offending: [] }, judge: null });
    expect(m.value).toBeNull();
    expect(m.detail.state).toBe('not-measured');
  });
});

describe('accounting metrics (forks/tokens/wall-clock/model-pin)', () => {
  it('forks: no fork node_start events anywhere ⇒ null', () => {
    expect(forks({ digest: digest({ forks: 0 }) }).value).toBeNull();
  });

  it('forks: a real fork count is a genuine number', () => {
    expect(forks({ digest: digest({ forks: 12, tasks: { plan_views: { forkStarts: 3, taskStarts: 0, statements: 0, writerCalls: 0, rejections: 0, hostFaults: 0, typecheckErrors: 0 } } }) }).value).toBe(12);
  });

  it('tokens: zero llm_response events ⇒ null', () => {
    expect(tokens({ digest: digest(), ledger: null }).value).toBeNull();
  });

  it('tokens: sums input+output from llm_response accounting', () => {
    const m = tokens({ digest: digest({ llmCalls: 2, tokens: { in: 100, out: 40 } }), ledger: null });
    expect(m.value).toBe(140);
  });

  it('wallClock: no turn durations and no trace span ⇒ null', () => {
    expect(wallClock({ digest: digest(), steps: [] }).value).toBeNull();
  });

  it('wallClock: sums turn durationMs across steps', () => {
    const steps = [{ compact: { turns: [{ durationMs: 100 }, { durationMs: 50 }] } }];
    expect(wallClock({ digest: digest(), steps }).value).toBe(150);
  });

  it('modelPin: no llm_request carried a model field ⇒ null', () => {
    expect(modelPin({ digest: digest() }).value).toBeNull();
  });

  it('modelPin: names the dominant model actually used', () => {
    const m = modelPin({ digest: digest({ models: { 'azure:DeepSeek-V4-Pro': 10, 'azure:gpt-5.5': 1 } }) });
    expect(m.value).toBe(2);
    expect(m.detail.dominant).toBe('azure:DeepSeek-V4-Pro');
  });
});

describe('judge-supplied metrics', () => {
  it('judgeInvariants: no judge.json ⇒ null', () => {
    expect(judgeInvariants({ judge: null }).value).toBeNull();
  });

  it('judgeInvariants: PASS ratio over judged steps', () => {
    const m = judgeInvariants({ judge: { steps: [{ step: 1, verdict: 'PASS' }, { step: 2, verdict: 'FAIL' }] } });
    expect(m.value).toBe(0.5);
  });

  it('visualGate: no judge.json visualGate ⇒ null', () => {
    expect(visualGate({ judge: null }).value).toBeNull();
  });

  it('visualGate: web pass + native fail ⇒ 0.5', () => {
    const m = visualGate({ judge: { visualGate: { web: 'pass', native: 'fail' } } });
    expect(m.value).toBe(0.5);
  });
});
