/**
 * targets.mjs — the plan's ratchet targets, as DATA.
 *
 * Part 3 of `design/appbuilder-viewspec-plan.md` states the ratchet in prose:
 *
 *   "Ratchet dashboard per round: vocabulary-gap ↓, procrustean = 0, DeepSeek pass ↑, tokens/app ↓,
 *    retries/write → 1, bricking = 0."
 *
 * Prose cannot answer "did this round move the right way", so every metric here declares:
 *   - `better`  — which direction is an improvement (`lower` | `higher` | `zero` | `toward`)
 *   - `target`  — the bar the plan sets, as `{op, value}`, or null where the plan sets none
 *
 * `better: 'toward'` is retries-per-write: the plan says "→ 1", meaning ONE retry per write is the
 * healthy resting state (the model reads a menu-shaped error and fixes one field), and both 5 and a
 * suspicious 0 over many writes are worth a look. It is scored as distance to `target.value`.
 */

/** @typedef {{op: '<='|'<'|'=='|'>='|'>', value: number}} Target */

export const PLAN_TARGETS = {
  'bricking': {
    label: 'Bricking rate',
    unit: 'bricked/run',
    better: 'zero',
    target: { op: '==', value: 0 },
    plan: 'Part 2 “Metrics per run”: bricking rate (0 by construction) — measured anyway, because “by construction” is a claim.',
  },
  'vocabulary-gap': {
    label: 'Vocabulary-gap rate',
    unit: 'pages with a gap / pages planned',
    better: 'lower',
    target: { op: '<', value: 0.1 },
    plan: 'Part 2: planner reports “cannot express”, target <10%. Bucket 1 promotions must move it DOWN or be reverted.',
  },
  'procrustean': {
    label: 'Procrustean rate (judged)',
    unit: 'pages force-fitted / pages',
    better: 'zero',
    target: { op: '==', value: 0 },
    plan: 'Part 2 + Part 3 bucket 1: wrong-section force-fits, target 0. Judged — a force-fit passes every gate.',
  },
  'retries-per-write': {
    label: 'Retries per write',
    unit: 'writer rejections / landed artifact',
    better: 'toward',
    target: { op: '<=', value: 1 },
    plan: 'Part 2: retry convergence (menu-errors working ⇒ ≤1 retry per write). Bucket 2 fires at >1.',
  },
  'layout-override': {
    label: 'Layout-override rate',
    unit: 'pages with an explicit `layout` / pages',
    better: 'lower',
    target: { op: '<=', value: 0.1 },
    plan: 'Part 1/2: low = the archetype predictions are right. T1 baseline: 0 overrides in 13 pages.',
  },
  'shell-override': {
    label: 'Shell override (unforced)',
    unit: 'unforced override (0|1)',
    better: 'zero',
    target: { op: '==', value: 0 },
    plan: 'Part 1: a grouped/placed shell above SHELL_DERIVE_MAX_ROUTES is FORCED and correct. T1: 1 forced override, 0 unforced.',
  },
  'forks': {
    label: 'Forks',
    unit: 'fork nodes',
    better: 'lower',
    target: null,
    plan: 'Part 2 T2 A/B: forks vs the frozen-appbuilder baseline (expect ~10× fewer UI forks). `detail.uiForks` is the comparison number.',
  },
  'tokens': {
    label: 'Tokens (in+out)',
    unit: 'tokens',
    better: 'lower',
    target: null,
    plan: 'Part 2 T2 A/B + Part 3 ratchet: tokens/app ↓.',
  },
  'wall-clock': {
    label: 'Wall clock',
    unit: 'ms',
    better: 'lower',
    target: null,
    plan: 'Part 2 T2 A/B: wall-clock vs the baseline.',
  },
  'gate-build': {
    label: 'Gate · buildApp findings',
    unit: 'typecheck+bundle findings',
    better: 'zero',
    target: { op: '==', value: 0 },
    plan: 'Part 1 B4b/16-verify: buildProjectApp — the real typecheck then the esbuild bundle.',
  },
  'gate-validate-views': {
    label: 'Gate · validateAppViews findings',
    unit: 'findings',
    better: 'zero',
    target: { op: '==', value: 0 },
    plan: 'Part 1 B4b(2). `viewsValidated:false` is a FAILURE to report, never a pass — it comes back null, not 0.',
  },
  'gate-render-smoke': {
    label: 'Gate · renderSmokeViews findings',
    unit: 'findings',
    better: 'zero',
    target: { op: '==', value: 0 },
    plan: 'Part 1 B4b(3). `renderSmoked:false` comes back null, not 0.',
  },
  'binding-coverage': {
    label: 'Binding coverage',
    unit: 'fraction of bound fields non-null on real data',
    better: 'higher',
    target: { op: '>=', value: 1 },
    plan: 'Part 1 B4b(3). Three states: a number, `not-run`, or `not-measured`. NEVER 0% and NEVER 100% by default.',
  },
  'model-pin': {
    label: 'Distinct models used',
    unit: 'models',
    better: 'lower',
    target: null,
    plan: 'Part 2 T4: proves a DeepSeek-pinned run was actually pinned. `detail.dominant` names the slot that ran.',
  },
  'judge-invariants': {
    label: 'Judge step pass rate',
    unit: 'PASS steps / steps judged',
    better: 'higher',
    target: { op: '>=', value: 1 },
    plan: 'Part 2: judge invariant scores. Judge-supplied.',
  },
  'visual-gate': {
    label: 'Visual gate (web+native)',
    unit: 'passing targets / targets scored',
    better: 'higher',
    target: { op: '>=', value: 1 },
    plan: 'Workstream D + T6 tier 3: one set of user stories, two targets.',
  },
};

/** Does `value` satisfy the plan's bar? `null` when there is no bar or no value. */
export function meetsTarget(id, value) {
  const t = PLAN_TARGETS[id]?.target;
  if (!t || value == null) return null;
  switch (t.op) {
    case '<=': return value <= t.value;
    case '<': return value < t.value;
    case '==': return value === t.value;
    case '>=': return value >= t.value;
    case '>': return value > t.value;
    default: return null;
  }
}

/**
 * Did the metric move the RIGHT WAY between two rounds?
 *
 * Returns `{direction, good}` where `direction` is `'up'|'down'|'flat'|'appeared'|'disappeared'|'unknown'`
 * and `good` is `true|false|null`. `null` is used liberally and on purpose: a metric that went from
 * `null` to a number has no direction, and calling that an improvement would let a measurement gap
 * masquerade as progress.
 */
export function movement(id, prev, now) {
  if (prev == null && now == null) return { direction: 'unknown', good: null, delta: null };
  if (prev == null) return { direction: 'appeared', good: null, delta: null };
  if (now == null) return { direction: 'disappeared', good: false, delta: null };
  const delta = now - prev;
  const eps = 1e-9;
  const direction = Math.abs(delta) < eps ? 'flat' : delta > 0 ? 'up' : 'down';
  const better = PLAN_TARGETS[id]?.better;
  let good = null;
  if (direction === 'flat') good = meetsTarget(id, now) ?? null;
  else if (better === 'lower' || better === 'zero') good = direction === 'down';
  else if (better === 'higher') good = direction === 'up';
  else if (better === 'toward') {
    const t = PLAN_TARGETS[id]?.target?.value ?? 1;
    good = Math.abs(now - t) < Math.abs(prev - t);
  }
  return { direction, good, delta };
}
