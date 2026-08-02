/**
 * metrics.mjs — the ratchet metrics, computed from a run's artifacts. Pure functions.
 *
 * The contract every metric here obeys, in order of importance:
 *
 *  1. **Exit status and extracted numbers only.** No metric reads a model's prose. Where the only
 *     available evidence WOULD be prose (`turn.lastText`), the metric is `null`.
 *  2. **A metric that cannot be extracted honestly is `null` WITH A REASON — never 0.** A zero reads
 *     as "perfect", and that inversion is exactly how `renderSmokeViews` once reported a fully-broken
 *     page as 100% covered (PROGRESS.md, Wave 2). `null` is a measurement gap; `0` is a measurement.
 *  3. **A vacuous denominator is not a pass.** Zero pages built means the layout metric is `null`,
 *     not `0 overrides`. Zero writes means retries-per-write is `null`, not `0 retries`.
 *  4. Every metric names its `source` — the exact artifact and field it came from — so a suspicious
 *     number can be re-derived by hand.
 */
import { PLAN_TARGETS } from './targets.mjs';

/** A measured metric. */
function measured(id, value, extra = {}) {
  const t = PLAN_TARGETS[id];
  if (!t) throw new Error(`metric "${id}" has no entry in targets.mjs`);
  return { id, label: t.label, better: t.better, target: t.target, unit: t.unit, value, reason: null, ...extra };
}

/** An honestly-unmeasurable metric. `reason` is mandatory and is shown in the dashboard. */
function unmeasured(id, reason, extra = {}) {
  const t = PLAN_TARGETS[id];
  if (!t) throw new Error(`metric "${id}" has no entry in targets.mjs`);
  if (!reason) throw new Error(`metric "${id}" was left unmeasured with no reason — a reason is the whole point`);
  return { id, label: t.label, better: t.better, target: t.target, unit: t.unit, value: null, reason, ...extra };
}

const ratio = (n, d) => (d > 0 ? n / d : null);
const arr = (v) => (Array.isArray(v) ? v : []);

/** The five tasklist nodes that exist ONLY because the UI is a spec — the A/B "UI forks" number. */
export const UI_TASKS = ['plan_views', 'plan_view_components', 'implement_views', 'implement_view_components', 'implement_shell'];

// ──────────────────────────────────────────────────────────────────────────────
// app state — the denominator guard every build-shaped metric needs
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Classify what the run actually produced. Three states, deliberately, because the two-state version
 * is a lie: `13-plant-care` run 1 reported `appCheck.ok=true errorCount=0` while zero pages existed
 * and the root route 404'd. A typecheck over nothing is clean; the app is still absent.
 */
export function appState({ views, openApp, verify }) {
  const pages = views?.pages?.length ?? 0;
  if (!views?.found) return { state: 'unknown', why: 'no pages/ directory under the run\'s project — the project dir was not found on disk', pages: null };
  if (pages === 0) return { state: 'not-built', why: 'zero view specs on disk (pages/*.view.json) — nothing was built, which is not the same as nothing being broken', pages: 0 };
  const faults = [];
  if (openApp?.appCheck && openApp.appCheck.ok === false) faults.push(`appCheck.ok=false (${openApp.appCheck.errorCount ?? '?'} errors)`);
  if (openApp?.appBuild && openApp.appBuild.built === false) faults.push('appBuild.built=false');
  if (openApp && openApp.appPageStatus != null && openApp.appPageStatus !== 'ok' && openApp.appPageStatus !== 200) faults.push(`root page status ${openApp.appPageStatus}`);
  if (verify && verify.built === false) faults.push('verify.built=false');
  return faults.length > 0
    ? { state: 'bricked', why: faults.join(' · '), pages }
    : { state: 'usable', why: openApp ? 'build + root page both green' : 'no open_app step in this scenario — judged on verify only', pages };
}

// ──────────────────────────────────────────────────────────────────────────────
// the metrics
// ──────────────────────────────────────────────────────────────────────────────

/** 1. Bricking — "0 by construction" is a CLAIM; this measures it. */
export function bricking({ app, openApp, verify }) {
  const source = 'step-NN.json{appBuild,appCheck,appPageStatus} (open_app verb) + trace scope value `verify`';
  if (app.state === 'unknown' || app.state === 'not-built') {
    return unmeasured('bricking', `app state is "${app.state}": ${app.why}. A run that built no app cannot demonstrate a bricking rate of 0.`, { source, detail: app });
  }
  if (!openApp && !verify) {
    return unmeasured('bricking', 'no open_app step and no `verify` scope value in any trace — nothing exercised the built app, so "not bricked" would be an assumption', { source, detail: app });
  }
  return measured('bricking', app.state === 'bricked' ? 1 : 0, { source, numerator: app.state === 'bricked' ? 1 : 0, denominator: 1, detail: app });
}

/**
 * 2. Vocabulary-gap rate — how often the PLANNER said it could not express something.
 *
 * The field is `plan_views[].cannotExpress: [{part, reason}]` (`07-plan_views.md:L45,L86`), carried to
 * the user by `18-finalize`. It is read from the host-serialized `plan_views` scope value, so the
 * number is the planner's structured declaration, not its narration.
 */
export function vocabularyGap({ digest }) {
  const source = 'trace llm_request scope value `plan_views[].cannotExpress` (host-serialized by fork.ts:L398-L407)';
  const entry = digest.scopeValues.plan_views;
  if (!entry) {
    const hint = digest.cannotExpressStatements.length > 0
      ? ` ${digest.cannotExpressStatements.length} plan_views statement(s) mention cannotExpress, so the node ran but its output never reached a downstream fork's prompt.`
      : ' plan_views never resolved into any downstream fork — the pipeline did not reach it.';
    return unmeasured('vocabulary-gap', `no host-serialized \`plan_views\` value in any trace.${hint}`, { source, detail: { cannotExpressStatements: digest.cannotExpressStatements.length } });
  }
  const pages = arr(entry.value);
  if (pages.length === 0) return unmeasured('vocabulary-gap', '`plan_views` resolved to an empty array — no pages were planned, so there is no denominator', { source });
  const entries = [];
  for (const p of pages) for (const c of arr(p?.cannotExpress)) entries.push({ route: p?.route ?? null, part: c?.part ?? null, reason: c?.reason ?? null });
  const gapPages = pages.filter((p) => arr(p?.cannotExpress).length > 0).length;
  return measured('vocabulary-gap', ratio(gapPages, pages.length), {
    source,
    numerator: gapPages,
    denominator: pages.length,
    detail: { pagesPlanned: pages.length, pagesWithGap: gapPages, entries },
  });
}

/**
 * 3. Procrustean rate — wrong-section force-fits. **Judged, never extracted.**
 *
 * A force-fit is by definition a spec that VALIDATES: the writer accepted it, the gates are clean, and
 * the only thing wrong is that a `list` is standing in for the `timeline` the story asked for. No
 * exit status anywhere in the run disagrees with it, which is precisely why the plan makes it a judged
 * metric. So this reads the judge's own verdict file and reports `null` when there isn't one —
 * reporting 0 for "no judge has looked yet" would silently satisfy the plan's `procrustean = 0` bar.
 */
export function procrustean({ judge, views }) {
  const source = '<runDir>/judge.json `procrustean[]` — see metrics/judge-contract.md';
  if (!judge) return unmeasured('procrustean', 'no judge.json in the run dir. A force-fit passes every gate by definition, so it can only be judged; 0 here would mean "nobody looked", which is not the same as "none found"', { source });
  if (!Array.isArray(judge.procrustean)) return unmeasured('procrustean', 'judge.json exists but has no `procrustean` array — the judge did not answer this question (see metrics/judge-contract.md)', { source });
  const pages = views?.pages?.length ?? 0;
  if (pages === 0) return unmeasured('procrustean', 'judge.json declares procrustean findings but zero view specs are on disk — the denominator (pages judged) is missing', { source });
  const findings = judge.procrustean;
  const routes = new Set(findings.map((f) => f?.route).filter(Boolean));
  return measured('procrustean', ratio(routes.size, pages), { source, numerator: routes.size, denominator: pages, detail: { findings } });
}

/**
 * 4. Retries per write — writer REJECTIONS per landed artifact. Target ≤ 1.
 *
 * A rejected `writeProjectView` throws a `LintError` carrying the menu-shaped text, so it lands in the
 * trace as an `eval_error` on the writer statement. `scope.mjs#isHostFault` separates those from
 * `'writeProjectView' is not defined`, which measures a capability-wiring bug and nothing about the
 * error text — both are reported, and only the first is the metric.
 *
 * The denominator is the artifacts ON DISK, not `implement_views[].ok`: the disk is the exit status.
 */
export function retriesPerWrite({ digest, views }) {
  const source = 'trace statement/eval_error events matching /writeProjectView(Component|Shell)?\\(/ · denominator = pages/*.view.json on disk';
  const rejections = digest.writerErrors.filter((e) => e.classified === 'writer-rejection');
  const hostFaults = digest.writerErrors.filter((e) => e.classified === 'host-fault');
  const landed = (views?.pages?.length ?? 0) + (views?.components?.length ?? 0) + (views?.shell ? 1 : 0);
  const detail = {
    writerCalls: digest.writerCalls.length,
    rejections: rejections.length,
    hostFaults: hostFaults.length,
    typecheckErrorsOnWriteStatements: digest.writerTypecheckErrors.length,
    landedArtifacts: landed,
    landedBreakdown: { pages: views?.pages?.length ?? 0, components: views?.components?.length ?? 0, shell: views?.shell ? 1 : 0 },
    rejectionMessages: rejections.slice(0, 20).map((r) => ({ writer: r.writer, task: r.task, attempt: r.attempt, message: r.message })),
    hostFaultMessages: [...new Set(hostFaults.map((h) => h.message))].slice(0, 5),
  };
  if (digest.writerCalls.length === 0) {
    return unmeasured('retries-per-write', 'no statement in any trace called a view writer — the pipeline never attempted a write', { source, detail });
  }
  if (landed === 0) {
    return unmeasured('retries-per-write', `${digest.writerCalls.length} write attempt(s) and ZERO landed artifacts${hostFaults.length ? ` (${hostFaults.length} host faults, e.g. ${detail.hostFaultMessages[0]})` : ''}. With no successful write there is no per-write denominator — this is a wiring failure, not a retry rate`, { source, detail });
  }
  return measured('retries-per-write', ratio(rejections.length, landed), { source, numerator: rejections.length, denominator: landed, detail });
}

/**
 * 5. Layout-override rate — how often the model set the PAGE-LEVEL `layout`.
 *
 * Deliberately not `section.layout`: a list section's `layout: 'rows'|'cards'|'table'|'grid'` is how
 * that list presents its rows, a different field with a different meaning
 * (`schema.ts#LIST_LAYOUTS` vs `schema.ts#PAGE_ARCHETYPES`). Conflating them would have scored T1's
 * kitchen — whose `index.view.json` sets `layout: 'rows'` on a section and no page layout anywhere —
 * as an override, contradicting the measured baseline of 0 in 13 pages.
 */
export function layoutOverride({ views }) {
  const source = 'the run\'s project on disk: top-level `layout` in pages/**/*.view.json (page archetype), excluding section-level list layouts';
  if (!views?.found) return unmeasured('layout-override', 'no pages/ directory under the run\'s project on disk', { source });
  const pages = views.pages;
  if (pages.length === 0) return unmeasured('layout-override', 'zero view specs on disk — a 0% override rate over zero pages says nothing about the archetype predictor', { source });
  const overrides = pages.filter((p) => typeof p.spec?.layout === 'string');
  const sectionLayouts = pages.reduce((n, p) => n + arr(p.spec?.sections).filter((s) => typeof s?.layout === 'string').length, 0);
  return measured('layout-override', ratio(overrides.length, pages.length), {
    source,
    numerator: overrides.length,
    denominator: pages.length,
    detail: {
      pages: pages.length,
      overrides: overrides.map((p) => ({ route: p.route, layout: p.spec.layout })),
      sectionLevelListLayouts: sectionLayouts,
      note: 'sectionLevelListLayouts is reported for audit only and is NOT part of the rate',
    },
  });
}

/**
 * 5b. Shell override — and whether it was FORCED.
 *
 * The shell derives from the route list only up to `SHELL_DERIVE_MAX_ROUTES = 5` top-level static
 * routes (`schema.ts:L346-357`); above it, declaring `groups` is the correct answer, not a prediction
 * failure. T1's kitchen is that case: 10 top-level static routes, 1 grouped shell, correct. So the
 * ratchet number is the UNFORCED override — a grouped or explicitly-placed shell on an app small
 * enough to derive.
 */
export const SHELL_DERIVE_MAX_ROUTES = 5;
export function shellOverride({ views }) {
  const source = 'the run\'s project on disk: pages/_shell.view.json vs the route list (SHELL_DERIVE_MAX_ROUTES = 5)';
  if (!views?.found) return unmeasured('shell-override', 'no pages/ directory under the run\'s project on disk', { source });
  const routes = views.pages.map((p) => p.route);
  if (routes.length === 0) return unmeasured('shell-override', 'zero view specs on disk — there is no route list for the shell to have been derived from', { source });
  const topLevelStatic = routes.filter((r) => !r.includes('/') && !r.includes('['));
  const forced = topLevelStatic.length > SHELL_DERIVE_MAX_ROUTES;
  const shell = views.shell?.spec ?? null;
  const declaresGroups = arr(shell?.groups).length > 0;
  const explicitPlacement = typeof shell?.placement === 'string' && shell.placement !== 'auto';
  const overrode = declaresGroups || explicitPlacement;
  const detail = {
    shellPresent: Boolean(shell),
    totalRoutes: routes.length,
    topLevelStaticRoutes: topLevelStatic.length,
    deriveLimit: SHELL_DERIVE_MAX_ROUTES,
    forced,
    declaresGroups,
    explicitPlacement: explicitPlacement ? shell.placement : null,
    groupCount: arr(shell?.groups).length,
    flatNavCount: arr(shell?.nav).length,
    subnavCount: arr(shell?.subnav).length,
  };
  if (!shell) {
    return unmeasured('shell-override', 'no pages/_shell.view.json on disk. `15b-implement_shell` always writes one, so its absence is a pipeline failure, not a derived shell', { source, detail });
  }
  return measured('shell-override', overrode && !forced ? 1 : 0, {
    source,
    numerator: overrode && !forced ? 1 : 0,
    denominator: 1,
    detail: { ...detail, verdict: !overrode ? 'derived' : forced ? 'forced-override (correct)' : 'UNFORCED override — the predictor was overridden on an app it could have derived' },
  });
}

/** 6. Forks — total, and the UI-only subset the A/B comparison is about. */
export function forks({ digest }) {
  const source = 'trace node_start events with kind="fork" (label `fork:<taskId>`)';
  if (digest.forks === 0) return unmeasured('forks', 'no fork node_start events in any trace — the tasklist never ran', { source });
  const byTask = Object.fromEntries(Object.entries(digest.tasks).map(([id, t]) => [id, t.forkStarts]).filter(([, n]) => n > 0));
  const uiForks = UI_TASKS.reduce((n, id) => n + (digest.tasks[id]?.forkStarts ?? 0), 0);
  return measured('forks', digest.forks, { source, detail: { total: digest.forks, uiForks, uiTasks: UI_TASKS, byTask } });
}

/** 6b. Tokens — from `llm_response` events, the host's own accounting. */
export function tokens({ digest, ledger }) {
  const source = 'trace llm_response events (inputTokens/outputTokens) · cross-check sessions-ledger.jsonl';
  if (digest.llmCalls === 0) return unmeasured('tokens', 'zero llm_response events in any trace — no model call was made', { source });
  const ledgerTotals = ledger
    ? ledger.reduce((a, r) => ({ in: a.in + (r.totalInputTokens ?? 0), out: a.out + (r.totalOutputTokens ?? 0), cost: a.cost + (r.totalCostUsd ?? 0) }), { in: 0, out: 0, cost: 0 })
    : null;
  return measured('tokens', digest.tokens.in + digest.tokens.out, {
    source,
    detail: {
      in: digest.tokens.in,
      out: digest.tokens.out,
      llmCalls: digest.llmCalls,
      ledger: ledgerTotals,
      // Local runs use the budget-free Azure keys from sdk/org/.env, which report no price, so a 0
      // here is an absent price feed and not a free run.
      costUsd: ledgerTotals && ledgerTotals.cost > 0 ? ledgerTotals.cost : null,
      costNote: ledgerTotals && ledgerTotals.cost === 0 ? 'sessions-ledger reports totalCostUsd=0 for local runs (no price feed) — cost is unmeasured, not zero' : null,
    },
  });
}

/** 6c. Wall clock — the summed turn durations, and the trace span. */
export function wallClock({ digest, steps }) {
  const source = 'step-NN.json turns[].durationMs · trace first→last event ts';
  const turnMs = steps.reduce((n, s) => n + arr(s.compact?.turns).reduce((m, t) => m + (t?.durationMs ?? 0), 0), 0);
  if (turnMs === 0 && digest.durationMs == null) return unmeasured('wall-clock', 'no turn durations in the step evidence and no timestamps in any trace', { source });
  return measured('wall-clock', turnMs > 0 ? turnMs : digest.durationMs, { source, detail: { turnMs, traceSpanMs: digest.durationMs } });
}

// ──────────────────────────────────────────────────────────────────────────────
// gates — the three exit-status ground truths
// ──────────────────────────────────────────────────────────────────────────────

/** Split `verify.offending[].errors[]` by `phase` so each gate's findings are attributable. */
export function verifyFindings(verify) {
  const byPhase = {};
  for (const f of arr(verify?.offending)) {
    for (const e of arr(f?.errors)) {
      const phase = e?.phase ?? 'unknown';
      byPhase[phase] ??= [];
      byPhase[phase].push({ file: f?.path ?? null, message: String(e?.message ?? '').slice(0, 400) });
    }
  }
  return byPhase;
}

/** 7. the build gate — the pod's real typecheck + build verdict (esbuild bundle for a legacy TSX
 *  app; the shared-renderer mount smoke for a spec app). */
export function gateBuild({ verify, openApp }) {
  const source = 'trace scope value `verify.{ok,built,routes}` (host-run 16-verify → buildProjectApp) · cross-check step-NN.json appCheck';
  if (!verify) {
    if (openApp?.appCheck && openApp.appCheck.ok != null) {
      return measured('gate-build', openApp.appCheck.ok ? 0 : (openApp.appCheck.errorCount ?? 1), {
        source: 'step-NN.json appCheck (open_app verb) — the pod\'s own typecheck+bundle verdict; `verify` was unavailable',
        detail: { ran: true, from: 'appCheck', ok: openApp.appCheck.ok, errorCount: openApp.appCheck.errorCount, built: openApp.appBuild?.built ?? null, rootPageStatus: openApp.appPageStatus ?? null },
      });
    }
    return unmeasured('gate-build', 'no `verify` scope value in any trace and no open_app step — the build gate\'s result is not in any artifact', { source });
  }
  const byPhase = verifyFindings(verify);
  const buildFindings = [...(byPhase.typecheck ?? []), ...(byPhase.bundle ?? [])];
  return measured('gate-build', buildFindings.length, {
    source,
    detail: {
      ran: true,
      ok: verify.ok ?? null,
      built: verify.built ?? null,
      routes: arr(verify.routes).length,
      offendingCount: verify.offendingCount ?? null,
      findings: buildFindings.slice(0, 20),
      appCheckCrossCheck: openApp?.appCheck ? { ok: openApp.appCheck.ok, errorCount: openApp.appCheck.errorCount, rootPageStatus: openApp.appPageStatus ?? null } : null,
    },
  });
}

/** 8. `validateAppViews` — the whole-app static gate. `viewsValidated:false` is a FAILURE to report. */
export function gateValidateViews({ verify }) {
  const source = 'trace scope value `verify.viewsValidated` + `verify.offending[].errors[phase="views"]`';
  if (!verify) return unmeasured('gate-validate-views', 'no `verify` scope value in any trace — this gate\'s result exists only inside the pod', { source });
  if (verify.viewsValidated !== true) {
    return unmeasured('gate-validate-views', `verify.viewsValidated=${JSON.stringify(verify.viewsValidated)} — the gate DID NOT RUN. A gate that did not run contributes no findings, which reads as clean; unavailable=${JSON.stringify(verify.unavailable ?? null)}`, {
      source,
      detail: { ran: false, unavailable: verify.unavailable ?? null, state: 'not-run' },
    });
  }
  const findings = verifyFindings(verify).views ?? [];
  return measured('gate-validate-views', findings.length, { source, detail: { ran: true, state: findings.length === 0 ? 'clean' : 'findings', findings: findings.slice(0, 20) } });
}

/** 9. `renderSmokeViews` — mounting every spec against live endpoint responses. */
export function gateRenderSmoke({ verify }) {
  const source = 'trace scope value `verify.renderSmoked` + `verify.offending[].errors[phase="render-smoke"]`';
  if (!verify) return unmeasured('gate-render-smoke', 'no `verify` scope value in any trace — this gate\'s result exists only inside the pod', { source });
  if (verify.renderSmoked !== true) {
    return unmeasured('gate-render-smoke', `verify.renderSmoked=${JSON.stringify(verify.renderSmoked)} — the gate DID NOT RUN; unavailable=${JSON.stringify(verify.unavailable ?? null)}. Its findings are unknown, not absent`, {
      source,
      detail: { ran: false, unavailable: verify.unavailable ?? null, state: 'not-run' },
    });
  }
  const findings = verifyFindings(verify)['render-smoke'] ?? [];
  return measured('gate-render-smoke', findings.length, { source, detail: { ran: true, state: findings.length === 0 ? 'clean' : 'findings', findings: findings.slice(0, 20) } });
}

/**
 * 9b. Binding coverage — the plan's "% of bound fields non-null on real data", with its THIRD state.
 *
 * `renderSmokeViews` computes it per page, but `16-verify` reduces its result to
 * `{ok, built, routes, offending, offendingCount, viewsValidated, renderSmoked, unavailable}` before
 * resolving, so the percentage never enters any artifact. Reporting 100% because no null-binding
 * finding fired is the exact inversion Wave 2 fixed (an error body counted as a row). So:
 *   - gate did not run  ⇒ `not-run`
 *   - gate ran, no % in any artifact ⇒ `not-measured`, and `null_binding` findings are reported as
 *     the only coverage signal that IS extractable.
 */
export function bindingCoverage({ verify, judge }) {
  const source = 'unavailable in run artifacts — 16-verify\'s output schema drops renderSmokeViews\' per-page coverage; judge.json `bindingCoverage` overrides';
  if (judge && typeof judge.bindingCoverage === 'number') {
    return measured('binding-coverage', judge.bindingCoverage, { source: '<runDir>/judge.json `bindingCoverage`', detail: { state: 'judge-supplied' } });
  }
  if (!verify) return unmeasured('binding-coverage', 'no `verify` scope value and no judge.json — state is "not-run", which is neither 0% nor 100%', { source, detail: { state: 'not-run' } });
  if (verify.renderSmoked !== true) return unmeasured('binding-coverage', 'renderSmokeViews did not run — state is "not-run", which is neither 0% nor 100%', { source, detail: { state: 'not-run' } });
  const nulls = (verifyFindings(verify)['render-smoke'] ?? []).filter((f) => /never|always null|null on every/i.test(f.message));
  return unmeasured('binding-coverage', 'renderSmokeViews RAN but its per-page coverage percentage is not in any artifact (16-verify resolves findings only). State is "not-measured" — reporting 100% because no finding fired is the inversion Wave 2 fixed', {
    source,
    detail: { state: 'not-measured', nullBindingFindings: nulls.length, findings: nulls.slice(0, 10) },
  });
}

/** 10. Model pin — proves a DeepSeek-pinned run was actually pinned (the T4 acceptance bar). */
export function modelPin({ digest }) {
  const source = 'trace llm_request events, `model` field';
  const models = Object.entries(digest.models).sort((a, b) => b[1] - a[1]);
  if (models.length === 0) return unmeasured('model-pin', 'no llm_request events carried a `model` field', { source });
  return measured('model-pin', models.length, { source, detail: { models: Object.fromEntries(models), dominant: models[0][0] } });
}

/** 11. Judge invariant score — from the judge's verdict file only. */
export function judgeInvariants({ judge }) {
  const source = '<runDir>/judge.json `invariants[]` / `steps[]` — see metrics/judge-contract.md';
  if (!judge) return unmeasured('judge-invariants', 'no judge.json in the run dir — nobody has judged this run', { source });
  const steps = arr(judge.steps);
  if (steps.length === 0) return unmeasured('judge-invariants', 'judge.json has no `steps[]` verdicts', { source });
  const pass = steps.filter((s) => s?.verdict === 'PASS').length;
  return measured('judge-invariants', ratio(pass, steps.length), { source, numerator: pass, denominator: steps.length, detail: { steps: steps.map((s) => ({ step: s?.step, verdict: s?.verdict })) } });
}

/** 12. Visual gate — Workstream D, web + native. Judge-supplied by construction (it is a vision call). */
export function visualGate({ judge }) {
  const source = '<runDir>/judge.json `visualGate.{web,native}` — see metrics/judge-contract.md';
  if (!judge?.visualGate) return unmeasured('visual-gate', 'no judge.json `visualGate` — the screenshot gate is a vision judgement and has no exit status to extract', { source });
  const v = judge.visualGate;
  const states = [v.web, v.native].filter((s) => s != null);
  if (states.length === 0) return unmeasured('visual-gate', 'judge.json `visualGate` names neither web nor native', { source });
  const passed = states.filter((s) => s === 'pass').length;
  return measured('visual-gate', ratio(passed, states.length), { source, numerator: passed, denominator: states.length, detail: { web: v.web ?? 'not-run', native: v.native ?? 'not-run' } });
}

/** The last step that used `open_app` — the only step whose evidence carries appBuild/appCheck. */
export function openAppEvidence(steps) {
  for (let i = steps.length - 1; i >= 0; i -= 1) {
    const c = steps[i]?.compact;
    if (c && (c.appBuild || c.appCheck || c.appPageStatus != null)) {
      return { step: c.step, appBuild: c.appBuild ?? null, appCheck: c.appCheck ?? null, appPageStatus: c.appPageStatus ?? null };
    }
  }
  return null;
}

/** Compute every metric for one run. `run` is `artifacts.loadRun`'s result; `digest` a merged digest. */
export function computeMetrics({ run, digest, views }) {
  const openApp = openAppEvidence(run.steps);
  const verify = digest.scopeValues.verify?.value ?? null;
  const app = appState({ views, openApp, verify });
  const metrics = {};
  const put = (m) => {
    metrics[m.id] = m;
  };
  put(bricking({ app, openApp, verify }));
  put(vocabularyGap({ digest }));
  put(procrustean({ judge: run.judge, views }));
  put(retriesPerWrite({ digest, views }));
  put(layoutOverride({ views }));
  put(shellOverride({ views }));
  put(forks({ digest }));
  put(tokens({ digest, ledger: run.sessionsLedger }));
  put(wallClock({ digest, steps: run.steps }));
  put(gateBuild({ verify, openApp }));
  put(gateValidateViews({ verify }));
  put(gateRenderSmoke({ verify }));
  put(bindingCoverage({ verify, judge: run.judge }));
  put(modelPin({ digest }));
  put(judgeInvariants({ judge: run.judge }));
  put(visualGate({ judge: run.judge }));
  return { metrics, app, openApp, verifyPresent: Boolean(verify) };
}
