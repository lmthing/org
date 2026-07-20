// retract_fact — apply node (kind:'code').
//
// The HOST runs `run(ctx, inputs)` with a real `ctx.db`. A hard delete (`ctx.db.remove`)
// is a host-only primitive — model agents have no `db.remove` on their surface, so a
// retraction's destructive delete happens HERE, in code that cannot be bypassed, and
// never inline in THING's own turn.
//
// It carries out EXACTLY what `01-locate` confirmed — nothing else. It never chooses a
// target itself; it branches on locate's status/grain and applies the mechanical write,
// then proves nothing beyond the target went.

export const node = {
  id: 'apply',
  dependsOn: ['locate'],
  goal: true,
  output: {
    ok: 'boolean',
    removed: 'number',
    detail: 'string',
  },
};

type Row = Record<string, unknown>;
interface Db {
  query(table: string, opts?: { where?: Record<string, unknown> }): Promise<Row[]>;
  update(table: string, opts: { where?: Record<string, unknown>; set?: Record<string, unknown> }): Promise<number>;
  remove(table: string, opts: { where?: Record<string, unknown> }): Promise<number>;
}
interface Ctx {
  db: Db;
}
interface Locate {
  table?: string;
  rowId?: string;
  grain?: string;
  field?: string;
  clearedValue?: string;
  status?: string;
  candidates?: string;
  detail?: string;
}
interface Inputs {
  locate?: Locate;
}
interface ApplyResult {
  ok: boolean;
  removed: number;
  detail: string;
}

export async function run(ctx: Ctx, inputs: Inputs): Promise<ApplyResult> {
  const l: Locate = (inputs && inputs.locate) || {};

  // Nothing is confirmed → remove NOTHING; relay so the caller can ask or report.
  if (l.status !== 'confirmed') {
    const detail = l.status === 'ambiguous' ? `Which one did you mean? ${l.candidates || ''}` : l.detail || 'nothing matched — nothing removed';
    return { ok: false, removed: 0, detail };
  }

  const table = l.table || '';
  const rowId = l.rowId || '';
  if (!table || !rowId) {
    return { ok: false, removed: 0, detail: 'refused: a confirmed retraction with no table/row to act on' };
  }

  if (l.grain === 'row') {
    // Hard-delete the ONE confirmed row, then prove exactly one went (a broader match
    // than the confirmed target is a failure, never a success).
    const removed = (await ctx.db.remove(table, { where: { id: rowId } })) || 0;
    if (removed !== 1) {
      return { ok: false, removed, detail: `refused: expected to remove exactly the one confirmed row but ${removed} matched in ${table}` };
    }
    return { ok: true, removed: 1, detail: `${table}: removed the row for the retracted item` };
  }

  if (l.grain === 'field') {
    // The record STAYS; only the retracted piece goes. Write locate's pre-computed
    // cleared value, then confirm the row still exists (an update must never delete it).
    const field = l.field || '';
    if (!field) {
      return { ok: false, removed: 0, detail: 'refused: a field-grain retraction with no field named' };
    }
    await ctx.db.update(table, { where: { id: rowId }, set: { [field]: l.clearedValue ?? '' } });
    const rows = await ctx.db.query(table, { where: { id: rowId } });
    if (!rows.length) {
      return { ok: false, removed: 0, detail: `refused: the ${table} row disappeared while clearing "${field}"` };
    }
    return { ok: true, removed: 0, detail: `${table} row: cleared the retracted piece from "${field}"; the record itself is unchanged` };
  }

  return { ok: false, removed: 0, detail: `refused: unrecognized retraction grain "${l.grain || ''}"` };
}
