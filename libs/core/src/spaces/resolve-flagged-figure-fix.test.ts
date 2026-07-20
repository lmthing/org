import { describe, it, expect, beforeAll } from 'vitest';
// The fix node is a kind:'code' module OUTSIDE src/ (system-spaces are not part of
// this package's tsconfig — the worker transpiles them at runtime). We load it via a
// computed dynamic import (so tsc does not resolve it across the src rootDir) and
// drive every interlock branch with an in-memory db. The real worker-transpile path
// is covered separately by the build-parity check.
type Row = Record<string, unknown>;
/* eslint-disable @typescript-eslint/no-explicit-any */
let node: any;
let run: (ctx: { db: unknown }, inputs: Record<string, unknown>) => Promise<any>;
/* eslint-enable @typescript-eslint/no-explicit-any */
beforeAll(async () => {
  const url = new URL('../../system-spaces/user-thing/tasklists/resolve_flagged_figure/02-fix.ts', import.meta.url).href;
  const mod = await import(/* @vite-ignore */ url);
  node = mod.node;
  run = mod.run;
});

function makeDb(tables: Record<string, Row[]>) {
  const match = (row: Row, where: Record<string, unknown>) =>
    Object.entries(where || {}).every(([k, v]) => row[k] === v);
  const calls = { remove: [] as unknown[], update: [] as unknown[] };
  const db = {
    calls,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    async query(table: string, opts: any = {}) {
      return (tables[table] || []).filter((r) => match(r, opts.where || {})).map((r) => ({ ...r }));
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    async remove(table: string, opts: any = {}) {
      const rows = tables[table] || [];
      let n = 0;
      for (let i = rows.length - 1; i >= 0; i--) {
        if (match(rows[i]!, opts.where || {})) { rows.splice(i, 1); n++; }
      }
      calls.remove.push({ table, where: opts.where });
      return n;
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    async update(table: string, opts: any = {}) {
      const rows = tables[table] || [];
      let n = 0;
      for (const r of rows) { if (match(r, opts.where || {})) { Object.assign(r, opts.set || {}); n++; } }
      calls.update.push({ table, where: opts.where, set: opts.set });
      return n;
    },
  };
  return db;
}

const USD = { op: 'sum', column: 'amount', filter: { currency: 'USD' } };

describe('resolve_flagged_figure/02-fix code node — metadata', () => {
  it('declares a high-confidence-gated code node depending on diagnose', () => {
    expect(node.id).toBe('fix');
    expect(node.dependsOn).toEqual(['diagnose']);
    expect(node.condition).toMatch(/diagnose\.confidence\s*==\s*'high'/);
    expect(Object.keys(node.output).sort()).toEqual(
      ['after', 'applied', 'before', 'changed', 'decision', 'detail', 'proposedAction', 'question'].sort(),
    );
  });
});

describe('resolve_flagged_figure/02-fix code node — interlock branches', () => {
  it('NO-OP: refuses to delete a row that is not part of the flagged figure (run-32 data-loss case)', async () => {
    const tables = {
      costs: [
        { id: 'u1', amount: 1000, currency: 'USD', label: 'hotel' },
        { id: 'u2', amount: 2344.2, currency: 'USD', label: 'safari' },
        { id: 'eur1', amount: 2707, currency: 'EUR', label: 'flights' },
      ],
    };
    const db = makeDb(tables);
    const diagnose = { cause: 'eur flights row', table: 'costs', targetIds: ['eur1'], fixAction: 'remove', targetValue: '', figureSpec: USD, assertedTarget: '3344.2', duplicateOf: [], confidence: 'high' };
    const out = await run({ db }, { diagnose });
    expect(out.applied).toBe(false);
    expect(out.question).toBe('');
    expect(db.calls.remove).toHaveLength(0);
    expect(tables.costs).toHaveLength(3); // nothing deleted
    expect(out.detail).toMatch(/already/i);
  });

  it('ALREADY-CORRECT: refuses to delete when the figure already equals the asserted target (wrong figureSpec basis)', async () => {
    // Even if diagnose targets a row whose removal WOULD move a mis-specified figure, the direct
    // "already at target" check stops the delete — the displayed figure is already right.
    const tables = {
      costs: [
        { id: 'u1', amount: 1000, currency: 'USD', label: 'hotel' },
        { id: 'u2', amount: 2344.2, currency: 'USD', label: 'safari' },
      ],
    };
    const db = makeDb(tables);
    const diagnose = { cause: 'guessed', table: 'costs', targetIds: ['u1'], fixAction: 'remove', targetValue: '', figureSpec: USD, assertedTarget: '3344.2', duplicateOf: [], confidence: 'high' };
    const out = await run({ db }, { diagnose });
    expect(out.applied).toBe(false);
    expect(out.question).toBe('');
    expect(db.calls.remove).toHaveLength(0);
    expect(tables.costs).toHaveLength(2);
    expect(out.detail).toMatch(/already/i);
  });

  it('MODE-A REMOVE: asks (never auto-deletes) even when removing the row reaches the asserted target', async () => {
    // "Removing this row makes the total match" is NOT proof the row is wrong — a legitimate row's
    // removal can coincidentally hit the target. Only a verified duplicate (mode-b) auto-deletes.
    const tables = {
      costs: [
        { id: 'u1', amount: 1000, currency: 'USD', label: 'hotel' },
        { id: 'u2', amount: 2344.2, currency: 'USD', label: 'safari' },
        { id: 'x', amount: 66, currency: 'USD', label: 'permit' },
      ],
    };
    const db = makeDb(tables);
    const diagnose = { cause: 'total too high', table: 'costs', targetIds: ['x'], fixAction: 'remove', targetValue: '', figureSpec: USD, assertedTarget: '3344.2', duplicateOf: [], confidence: 'high' };
    const out = await run({ db }, { diagnose });
    expect(out.applied).toBe(false);
    expect(out.question).not.toBe('');
    expect(db.calls.remove).toHaveLength(0);
    expect(tables.costs).toHaveLength(3);
    // the proposal is carried structurally for a confirm re-invoke
    expect(out.decision.targetIds).toEqual(['x']);
    expect(out.decision.fixAction).toBe('remove');
  });

  it('WRONG-BASIS REMOVE (run-32): asks when a legit row\'s removal reaches a hypothesised target', async () => {
    // diagnose hypothesised an all-currency basis (sum includes the EUR row); removing the EUR row
    // "reaches" 3344.2. The interlock refuses to auto-delete a non-duplicate — no data loss.
    const tables = {
      costs: [
        { id: 'u1', amount: 1000, currency: 'USD', label: 'hotel' },
        { id: 'u2', amount: 2344.2, currency: 'USD', label: 'safari' },
        { id: 'eur1', amount: 2707, currency: 'EUR', label: 'flights' },
      ],
    };
    const db = makeDb(tables);
    // figureSpec has NO currency filter (the fabricated all-currency basis: before = 6051.2)
    const diagnose = { cause: 'EUR flights mixed into total', table: 'costs', targetIds: ['eur1'], fixAction: 'remove', targetValue: '', figureSpec: { op: 'sum', column: 'amount', filter: {} }, assertedTarget: '3344.2', duplicateOf: [], confidence: 'high' };
    const out = await run({ db }, { diagnose });
    expect(out.applied).toBe(false);
    expect(out.question).not.toBe('');
    expect(db.calls.remove).toHaveLength(0);
    expect(tables.costs.map((r) => r.id)).toContain('eur1'); // the real row survives
  });

  it('STRUCTURAL DUPLICATE: auto-applies when diagnose points at a genuine identical peer', async () => {
    const tables = {
      costs: [
        { id: 'u1', amount: 1000, currency: 'USD', label: 'hotel' },
        { id: 'orig', amount: 66, currency: 'USD', label: 'permit' },
        { id: 'dup', amount: 66, currency: 'USD', label: 'permit' },
      ],
    };
    const db = makeDb(tables);
    const diagnose = { cause: 'permit recorded twice', table: 'costs', targetIds: ['dup'], fixAction: 'remove', targetValue: '', figureSpec: USD, assertedTarget: '', duplicateOf: ['orig'], confidence: 'high' };
    const out = await run({ db }, { diagnose });
    expect(out.applied).toBe(true);
    expect(db.calls.remove).toHaveLength(1);
    expect(tables.costs.map((r) => r.id)).not.toContain('dup');
    expect(tables.costs.map((r) => r.id)).toContain('orig');
  });

  it('AUTO-DETECT DUPLICATE: removes an exact full-row twin even when diagnose omits duplicateOf', async () => {
    // A genuine double-count where diagnose targets a row for removal but forgot to populate
    // duplicateOf. The code detects the identical twin itself and auto-applies (a copy survives).
    const tables = {
      costs: [
        { id: 'u1', amount: 1000, currency: 'USD', label: 'hotel' },
        { id: 'orig', amount: 295, currency: 'USD', label: 'descent-fee' },
        { id: 'dup', amount: 295, currency: 'USD', label: 'descent-fee' },
      ],
    };
    const db = makeDb(tables);
    const diagnose = { cause: 'descent fee entered twice', table: 'costs', targetIds: ['dup'], fixAction: 'remove', targetValue: '', figureSpec: USD, assertedTarget: '1295', duplicateOf: [], confidence: 'high' };
    const out = await run({ db }, { diagnose });
    expect(out.applied).toBe(true);
    expect(db.calls.remove).toHaveLength(1);
    expect(tables.costs).toHaveLength(2);
    expect(tables.costs.filter((r) => r.amount === 295)).toHaveLength(1); // exactly one copy remains
  });

  it('UNVERIFIABLE: asks (no delete) when there is no recompute spec', async () => {
    const tables = { costs: [{ id: 'x', amount: 5, currency: 'USD' }] };
    const db = makeDb(tables);
    const diagnose = { cause: 'unsure', table: 'costs', targetIds: ['x'], fixAction: 'remove', targetValue: '', figureSpec: {}, assertedTarget: '3344', duplicateOf: [], confidence: 'high' };
    const out = await run({ db }, { diagnose });
    expect(out.applied).toBe(false);
    expect(out.question).not.toBe('');
    expect(db.calls.remove).toHaveLength(0);
  });

  it('CONFIRMED: applies the pre-decided removal on a decision.approved re-invoke, bypassing the verify gate', async () => {
    const tables = { costs: [{ id: 'x', amount: 5, currency: 'USD', label: 'stray' }, { id: 'y', amount: 7, currency: 'USD' }] };
    const db = makeDb(tables);
    const diagnose = { cause: 'user-confirmed', table: 'costs', targetIds: ['x'], fixAction: 'remove', targetValue: '', figureSpec: {}, assertedTarget: '', duplicateOf: [], confidence: 'high' };
    const decision = { approved: true, table: 'costs', targetIds: ['x'], fixAction: 'remove' };
    const out = await run({ db }, { diagnose, decision });
    expect(out.applied).toBe(true);
    expect(db.calls.remove).toHaveLength(1);
    expect(tables.costs.map((r) => r.id)).not.toContain('x');
  });

  it('NONE: does nothing when the diagnosis is fixAction none', async () => {
    const tables = { costs: [{ id: 'x', amount: 5, currency: 'USD' }] };
    const db = makeDb(tables);
    const diagnose = { cause: 'already right', table: '', targetIds: [], fixAction: 'none', targetValue: '', figureSpec: {}, assertedTarget: '', duplicateOf: [], confidence: 'high' };
    const out = await run({ db }, { diagnose });
    expect(out.applied).toBe(false);
    expect(db.calls.remove).toHaveLength(0);
    expect(db.calls.update).toHaveLength(0);
  });

  it('UPDATE VERIFIED: applies a corrective update that recomputes to the asserted target', async () => {
    const tables = { costs: [{ id: 'r', amount: 100, currency: 'USD' }, { id: 's', amount: 200, currency: 'USD' }] };
    const db = makeDb(tables);
    const diagnose = { cause: 'wrong amount', table: 'costs', targetIds: ['r'], fixAction: 'update', targetValue: '50', figureSpec: USD, assertedTarget: '250', duplicateOf: [], confidence: 'high' };
    const out = await run({ db }, { diagnose });
    expect(out.applied).toBe(true);
    expect(db.calls.update).toHaveLength(1);
    expect(tables.costs.find((r) => r.id === 'r')!.amount).toBe('50');
    expect(Number(out.after)).toBeCloseTo(250, 3);
  });

  it('UPDATE UNVERIFIED: asks (no write) when the update would not reach the asserted target', async () => {
    const tables = { costs: [{ id: 'r', amount: 100, currency: 'USD' }, { id: 's', amount: 200, currency: 'USD' }] };
    const db = makeDb(tables);
    const diagnose = { cause: 'wrong amount', table: 'costs', targetIds: ['r'], fixAction: 'update', targetValue: '10', figureSpec: USD, assertedTarget: '250', duplicateOf: [], confidence: 'high' };
    const out = await run({ db }, { diagnose });
    expect(out.applied).toBe(false);
    expect(out.question).not.toBe('');
    expect(db.calls.update).toHaveLength(0);
  });
});
