import { describe, it, expect, beforeAll } from 'vitest';
// retract_fact's apply node is a kind:'code' module OUTSIDE src/ (system-spaces are not in this
// package's tsconfig — the worker transpiles them at runtime). Load it via a computed dynamic import
// (so tsc does not resolve it across the src rootDir) and drive each branch with an in-memory db.
type Row = Record<string, unknown>;
/* eslint-disable @typescript-eslint/no-explicit-any */
let node: any;
let run: (ctx: { db: unknown }, inputs: Record<string, unknown>) => Promise<any>;
/* eslint-enable @typescript-eslint/no-explicit-any */
beforeAll(async () => {
  const url = new URL('../../system-spaces/user-thing/tasklists/retract_fact/02-apply.ts', import.meta.url).href;
  const mod = await import(/* @vite-ignore */ url);
  node = mod.node;
  run = mod.run;
});

function makeDb(tables: Record<string, Row[]>) {
  const match = (row: Row, where: Record<string, unknown>) => Object.entries(where || {}).every(([k, v]) => row[k] === v);
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
      for (let i = rows.length - 1; i >= 0; i--) if (match(rows[i]!, opts.where || {})) { rows.splice(i, 1); n++; }
      calls.remove.push({ table, where: opts.where });
      return n;
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    async update(table: string, opts: any = {}) {
      const rows = tables[table] || [];
      let n = 0;
      for (const r of rows) if (match(r, opts.where || {})) { Object.assign(r, opts.set || {}); n++; }
      calls.update.push({ table, where: opts.where, set: opts.set });
      return n;
    },
  };
  return db;
}

describe('retract_fact/02-apply code node', () => {
  it('declares a host-run goal code node depending on locate', () => {
    expect(node.id).toBe('apply');
    expect(node.dependsOn).toEqual(['locate']);
    expect(node.goal).toBe(true);
  });

  it('CONFIRMED row: hard-deletes exactly the one row', async () => {
    const tables = { costs: [{ id: 'a', amount: 30 }, { id: 'b', amount: 50 }] };
    const db = makeDb(tables);
    const locate = { status: 'confirmed', grain: 'row', table: 'costs', rowId: 'a', field: '', clearedValue: '' };
    const out = await run({ db }, { locate });
    expect(out.ok).toBe(true);
    expect(out.removed).toBe(1);
    expect(tables.costs.map((r) => r.id)).toEqual(['b']);
  });

  it('CONFIRMED row that matches nothing: refuses (removed 0 is not success)', async () => {
    const tables = { costs: [{ id: 'b', amount: 50 }] };
    const db = makeDb(tables);
    const locate = { status: 'confirmed', grain: 'row', table: 'costs', rowId: 'gone', field: '', clearedValue: '' };
    const out = await run({ db }, { locate });
    expect(out.ok).toBe(false);
    expect(out.removed).toBe(0);
  });

  it('CONFIRMED field: clears only the field with locate\'s value; the row survives', async () => {
    const tables = { receipts: [{ id: 'r1', total: 120, notes: 'lunch; tip retracted' }] };
    const db = makeDb(tables);
    const locate = { status: 'confirmed', grain: 'field', table: 'receipts', rowId: 'r1', field: 'notes', clearedValue: 'lunch' };
    const out = await run({ db }, { locate });
    expect(out.ok).toBe(true);
    expect(out.removed).toBe(0);
    expect(db.calls.remove).toHaveLength(0); // NOT a delete
    expect(tables.receipts[0]!.notes).toBe('lunch');
    expect(tables.receipts[0]!.total).toBe(120); // record intact
  });

  it('AMBIGUOUS: removes nothing and relays the candidates', async () => {
    const tables = { costs: [{ id: 'a' }, { id: 'b' }] };
    const db = makeDb(tables);
    const locate = { status: 'ambiguous', candidates: 'a ($30), b ($30)', grain: 'row', table: 'costs' };
    const out = await run({ db }, { locate });
    expect(out.ok).toBe(false);
    expect(db.calls.remove).toHaveLength(0);
    expect(out.detail).toMatch(/which one/i);
    expect(tables.costs).toHaveLength(2);
  });

  it('NONE: removes nothing', async () => {
    const tables = { costs: [{ id: 'a' }] };
    const db = makeDb(tables);
    const locate = { status: 'none', detail: 'no matching charge found', grain: '', table: '' };
    const out = await run({ db }, { locate });
    expect(out.ok).toBe(false);
    expect(db.calls.remove).toHaveLength(0);
    expect(tables.costs).toHaveLength(1);
  });
});
