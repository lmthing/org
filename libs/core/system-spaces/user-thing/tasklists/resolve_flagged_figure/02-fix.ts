// resolve_flagged_figure — fix node (kind:'code').
//
// The HOST runs `run(ctx, inputs)` in a worker-isolated context with a real
// `ctx.db` (the project's AsyncDbApi). Unlike a model fork, this cannot be
// stochastically skipped — the destructive-write GUARD executes every time.
//
// It is an INTERLOCK, not a diagnostician: `01-diagnose` (a model) still decides
// WHAT is wrong. This node only decides, in code, whether the diagnosed mutation
// is SAFE to apply automatically, on a three-way branch:
//   - verified & unambiguous -> auto-apply (one turn)
//   - already correct (no-op) -> report, delete nothing
//   - cannot verify / ambiguous -> propose + ask (write nothing; the caller relays
//     the question, and on the user's yes re-invokes with a confirmed `decision`)
//
// Nothing here is domain-specific: how the flagged figure is computed arrives as
// DATA in `diagnose.figureSpec` ({op,column,filter}); this module has no notion of
// costs/amounts/currencies.

export const node = {
  id: 'fix',
  dependsOn: ['diagnose'],
  condition: "diagnose.confidence == 'high'",
  output: {
    applied: 'boolean',
    changed: 'number',
    before: 'string',
    after: 'string',
    question: 'string',
    proposedAction: 'string',
    decision: 'object',
    detail: 'string',
  },
};

type Row = Record<string, unknown>;
interface FigureSpec {
  op?: string;
  column?: string;
  filter?: Record<string, unknown>;
}
interface Db {
  query(table: string, opts?: { where?: Record<string, unknown> }): Promise<Row[]>;
  remove(table: string, opts?: { where?: Record<string, unknown> }): Promise<number>;
  update(table: string, opts?: { where?: Record<string, unknown>; set?: Record<string, unknown> }): Promise<number>;
}
interface Ctx {
  db: Db;
}
interface Diagnose {
  cause?: string;
  table?: string;
  targetIds?: unknown[];
  fixAction?: string;
  targetValue?: string;
  figureSpec?: FigureSpec;
  assertedTarget?: string;
  duplicateOf?: unknown[];
  detail?: string;
}
interface Decision {
  approved?: boolean;
  table?: string;
  targetIds?: unknown[];
  fixAction?: string;
  targetValue?: string;
  column?: string;
}
interface Inputs {
  diagnose?: Diagnose;
  decision?: Decision;
}
interface FixResult {
  applied: boolean;
  changed: number;
  before: string;
  after: string;
  question: string;
  proposedAction: string;
  decision: Record<string, unknown>;
  detail: string;
}

const AGG_OPS = ['sum', 'count', 'avg', 'min', 'max'];

// Every return goes through this so the output always carries exactly the declared
// fields — a missing field would fail the node's output validation.
function done(o: Partial<FixResult>): FixResult {
  return {
    applied: false,
    changed: 0,
    before: '',
    after: '',
    question: '',
    proposedAction: '',
    decision: {},
    detail: '',
    ...o,
  };
}

function num(v: unknown): number {
  if (typeof v === 'number') return v;
  if (v === null || v === undefined) return NaN;
  return parseFloat(String(v).replace(/[^0-9.eE+-]/g, ''));
}

function agg(op: string, rows: Row[], column: string): number {
  if (op === 'count') return rows.length;
  const vals = rows.map((r) => num(r[column])).filter((v) => Number.isFinite(v));
  if (!vals.length) return 0;
  if (op === 'sum') return vals.reduce((a, b) => a + b, 0);
  if (op === 'avg') return vals.reduce((a, b) => a + b, 0) / vals.length;
  if (op === 'min') return Math.min(...vals);
  if (op === 'max') return Math.max(...vals);
  return NaN;
}

// Tolerant numeric compare — absorbs cent rounding and float drift, scaled to the
// magnitude of the figure so it works for both small counts and large totals.
function approxEq(a: unknown, b: unknown): boolean {
  const x = num(a);
  const y = num(b);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return false;
  const scale = Math.max(1, Math.abs(x), Math.abs(y));
  return Math.abs(x - y) <= scale * 1e-6 + 0.005;
}

function rid(r: Row): string {
  return String(r && r.id !== undefined ? r.id : '');
}

function idList(v: unknown[]): string[] {
  return (v || []).map(String);
}

function summarize(d: Diagnose): string {
  const ids = idList(d.targetIds ?? []);
  const what = ids.length === 1 ? 'row' : 'rows';
  return `${d.fixAction} ${ids.length} ${what} in ${d.table} (${ids.join(', ')})`;
}

// The proposal handed back to the caller when we will NOT auto-apply. `decision`
// carries the structured action so a confirming re-invoke can echo it back verbatim
// (avoiding a destructive re-diagnosis from the raw complaint).
function ask(d: Diagnose, why: string): FixResult {
  return done({
    question:
      `I looked into "${d.cause || 'the flagged figure'}" and a fix would ${summarize(d)}, ` +
      `but I'm not certain it's the right change (${why}). Should I go ahead?`,
    proposedAction: summarize(d),
    decision: {
      table: d.table,
      targetIds: idList(d.targetIds ?? []),
      fixAction: d.fixAction,
      targetValue: d.targetValue || '',
      column: d.figureSpec && d.figureSpec.column ? d.figureSpec.column : '',
      figureSpec: d.figureSpec || {},
      assertedTarget: d.assertedTarget || '',
    },
    detail: why,
  });
}

async function applyRemove(ctx: Ctx, table: string, ids: string[], spec: FigureSpec | null, detail: string, before?: number): Promise<FixResult> {
  let changed = 0;
  for (const id of ids) changed += (await ctx.db.remove(table, { where: { id } })) || 0;
  const after = spec && spec.op ? String(agg(spec.op, await ctx.db.query(table, { where: spec.filter || {} }), spec.column ?? '')) : '';
  return done({ applied: changed > 0, changed, before: before !== undefined ? String(before) : '', after, detail });
}

export async function run(ctx: Ctx, inputs: Inputs): Promise<FixResult> {
  const d: Diagnose = (inputs && inputs.diagnose) || {};
  const decision = inputs && inputs.decision;
  const targetIds = idList(d.targetIds ?? []);
  const spec = d.figureSpec && d.figureSpec.op && AGG_OPS.includes(d.figureSpec.op) ? d.figureSpec : null;
  const target = d.assertedTarget !== undefined && String(d.assertedTarget).trim() !== '' ? d.assertedTarget : null;

  // (0) Human-confirmed re-invoke: the caller already proposed this and the user
  // approved it. Apply the pre-decided action — the confirmation IS the authority,
  // so no re-verification gate (the human overrides an "unverifiable" case).
  if (decision && decision.approved) {
    const ids = idList(decision.targetIds ?? targetIds);
    const act = decision.fixAction || d.fixAction;
    const table = decision.table || d.table || '';
    if (act === 'remove') {
      return await applyRemove(ctx, table, ids, spec, 'applied the user-confirmed removal');
    }
    if (act === 'update' && decision.column) {
      let changed = 0;
      for (const id of ids) changed += (await ctx.db.update(table, { where: { id }, set: { [decision.column]: decision.targetValue } })) || 0;
      return done({ applied: changed > 0, changed, detail: 'applied the user-confirmed update' });
    }
  }

  const fixAction = d.fixAction || 'none';
  const table = d.table || '';
  if (fixAction === 'none') {
    return done({ detail: d.detail || 'the figure is already correct — nothing to change' });
  }

  if (fixAction === 'remove') {
    if (!targetIds.length) return ask(d, 'no target row was identified');

    // Mode (b) — structural duplicate. Diagnose asserts each target duplicates a
    // named peer; verify the peer exists, is a different row, and carries the same
    // aggregated value (so removing the target genuinely drops a double-count).
    const dupOf = idList(d.duplicateOf ?? []);
    if (dupOf.length === targetIds.length && dupOf.every((p) => p !== '')) {
      const rows = await ctx.db.query(table, {});
      const byId = new Map(rows.map((r) => [rid(r), r]));
      const col = spec ? spec.column : undefined;
      let verified = true;
      for (let i = 0; i < targetIds.length; i++) {
        const t = byId.get(targetIds[i]!);
        const p = byId.get(dupOf[i]!);
        if (!t || !p || targetIds[i] === dupOf[i]) { verified = false; break; }
        if (col && num(t[col]) !== num(p[col])) { verified = false; break; }
      }
      if (verified) {
        const before = spec ? agg(spec.op ?? 'sum', await ctx.db.query(table, { where: spec.filter || {} }), spec.column ?? '') : undefined;
        return await applyRemove(ctx, table, targetIds, spec, `removed ${targetIds.length} duplicate row(s) from ${table}`, before);
      }
      return ask(d, 'the target does not match its claimed duplicate');
    }

    // Mode (a) — target-selected. Recompute the figure with and without the target
    // rows and only auto-delete when it (i) actually moves and (ii) lands on the
    // value the user asserted, with no distinct equal-value twin to confuse it.
    if (spec && spec.op && target !== null) {
      const col = spec.column ?? '';
      const rows = await ctx.db.query(table, { where: spec.filter || {} });
      const before = agg(spec.op, rows, col);

      if (approxEq(before, target)) {
        // The figure the user says is wrong already equals the value they expect —
        // there is nothing to fix. Never delete a row to "correct" a correct figure.
        return done({
          before: String(before),
          after: String(before),
          detail: `the figure is already ${before}, matching the ${target} you expected — nothing removed`,
        });
      }

      const kept = rows.filter((r) => !targetIds.includes(rid(r)));
      const after = agg(spec.op, kept, col);

      if (before === after) {
        // Removing the target does not change the figure -> it is not part of it ->
        // there is nothing to fix. Never delete a row that doesn't move the number.
        return done({
          before: String(before),
          after: String(before),
          detail: `${table} row(s) ${targetIds.join(', ')} are not part of the flagged figure — it is already ${before}; nothing removed`,
        });
      }
      // We do NOT auto-apply a mode-(a) DELETE, even when removing the target reaches the
      // asserted figure. "Removing this row makes the total match" is not proof the row is
      // wrong: a LEGITIMATE row's removal can coincidentally hit the target (deleting real
      // data to "fix" a figure the app may already be showing correctly — the run-32
      // data-loss case, where diagnose hypothesised an all-currency basis so the flights row
      // "reached" the target). Only a proven structural DUPLICATE (mode (b), which names and
      // verifies a redundant peer) is auto-removed; every other deletion is confirmed first.
      if (!approxEq(after, target)) {
        return ask(d, `removing it would give ${after}, not the ${target} you said it should be`);
      }
      return ask(d, `removing this row would reach ${target}, but it isn't a verified duplicate — deleting a real row to make a total match needs your confirmation`);
    }

    // A destructive delete we cannot verify in code — never auto-apply it.
    return ask(d, 'I cannot verify in the data that removing it is correct');
  }

  if (fixAction === 'update') {
    if (!targetIds.length) return ask(d, 'no target row was identified');
    // Verify the correction against the same recompute the total uses. The updated
    // column is the aggregated column (the value that feeds the figure).
    if (spec && spec.op && target !== null) {
      const col = spec.column ?? '';
      const rows = await ctx.db.query(table, { where: spec.filter || {} });
      const before = agg(spec.op, rows, col);
      const simulated = rows.map((r) => (targetIds.includes(rid(r)) ? { ...r, [col]: num(d.targetValue) } : r));
      const after = agg(spec.op, simulated, col);
      if (approxEq(after, target)) {
        let changed = 0;
        for (const id of targetIds) changed += (await ctx.db.update(table, { where: { id }, set: { [col]: d.targetValue } })) || 0;
        const afterActual = String(agg(spec.op, await ctx.db.query(table, { where: spec.filter || {} }), col));
        return done({ applied: changed > 0, changed, before: String(before), after: afterActual, detail: `updated ${table}.${col} on ${changed} row(s)` });
      }
      return ask(d, `setting it to ${d.targetValue} would give ${after}, not the ${target} you said it should be`);
    }
    return ask(d, 'I cannot verify in the data that this correction is right');
  }

  return ask(d, 'the diagnosed action was not recognized');
}
