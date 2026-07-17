/**
 * evidence.mjs — the pure evidence transforms the scenario runner writes for the JUDGE.
 *
 * These were inlined in run-yaml.mjs; extracted here verbatim so they can be unit-tested (golden
 * fixtures) and reused. FIELD INSERTION ORDER is the byte-compat contract: `run-yaml` writes every
 * file with `JSON.stringify(obj, null, 2)`, and the judge parses the result, so never reorder the
 * keys in `summarizeTurn`/`compactStep` — move the object literals as-is.
 *
 * The two shape changes versus the old inline versions:
 *   - `snapshot(pod, projectId)` takes projectId as a PARAM (was a module global).
 *   - `traceLines(rec)` RETURNS the lines (was `appendTrace(rec)` pushing to a module-global array);
 *     the caller does `traceMd.push(...traceLines(rec))` and joins once at the end.
 */

// ── state capture: what the judge verifies token-in-state against ──────────────────────────────
export async function snapshot(pod, projectId) {
  const snap = { spaces: [], appTables: {}, appManifest: null, error: null };
  try {
    const sp = await pod.listSpaces(projectId).catch(() => null);
    snap.spaces = (sp?.spaces ?? sp ?? []).map((s) => s.slug ?? s.name ?? s.id ?? s);
  } catch (e) {
    snap.error = String(e?.message ?? e);
  }
  try {
    const man = await pod.appManifest(projectId).catch(() => null);
    if (man) {
      snap.appManifest = { tables: man.tables ?? man.database ?? [], pages: man.pages ?? [], built: man.build?.built ?? null };
      const tableNames = (snap.appManifest.tables ?? []).map((t) => t.name ?? t.slug ?? t).filter(Boolean);
      for (const t of tableNames) {
        const rows = await pod.appData(projectId, t).catch(() => null);
        if (rows) snap.appTables[t] = rows.rows ?? rows.data ?? rows;
      }
    }
  } catch (e) {
    snap.appError = String(e?.message ?? e);
  }
  return snap;
}

// ── turn → raw evidence ─────────────────────────────────────────────────────────────────────────
export function summarizeTurn(turn, sent) {
  if (!turn) return { sent, empty: true };
  return {
    sent,
    lastText: turn.lastText,
    delegates: turn.delegates,
    yieldKinds: [...new Set((turn.yields ?? []).map((y) => y.kind))],
    yields: (turn.yields ?? []).map((y) => ({ kind: y.kind, args: compact(y.args) })),
    errors: turn.errors ?? [],
    nodes: turn.nodes ?? [],
    tokens: turn.tokens,
    durationMs: turn.durationMs,
    interrupted: turn.interrupted ?? false,
  };
}

export function compact(args) {
  try {
    const s = JSON.stringify(args);
    return s && s.length > 400 ? s.slice(0, 400) + '…' : args;
  } catch {
    return String(args);
  }
}

// The observables a step is JUDGED on — space names, table names + ROW COUNTS (not the rows),
// delegate names + outcomes, yield KINDS + count (not full args), errors, the reply, the asks.
// Everything a full dump carries for drill-down (every row, every yield's args, node bodies) stays
// in step-NN.full.json. Keeps the judge's per-poll read ~10× smaller so a heavy build step (or a
// rerun of one) doesn't blow its context window.
export function compactStep(rec) {
  const s = rec.state ?? {};
  const turns = (rec.turns ?? []).map((t) =>
    t.empty
      ? { sent: t.sent, empty: true }
      : {
          sent: t.sent,
          lastText: typeof t.lastText === 'string' && t.lastText.length > 1200 ? t.lastText.slice(0, 1200) + '…' : t.lastText,
          delegates: t.delegates,
          yieldKinds: t.yieldKinds,
          yieldCount: (t.yields ?? []).length,
          errors: t.errors,
          nodeCount: (t.nodes ?? []).length,
          tokens: t.tokens,
          durationMs: t.durationMs,
          interrupted: t.interrupted,
        },
  );
  const state = {
    spaces: s.spaces ?? [],
    spaceCount: (s.spaces ?? []).length,
    appTables: Object.fromEntries(Object.entries(s.appTables ?? {}).map(([k, v]) => [k, Array.isArray(v) ? v.length : v])),
    appManifest: s.appManifest
      ? { tableNames: (s.appManifest.tables ?? []).map((t) => t.name ?? t.slug ?? t).filter(Boolean), pageCount: (s.appManifest.pages ?? []).length, built: s.appManifest.built }
      : null,
    error: s.error ?? null,
    appError: s.appError ?? null,
  };
  return {
    step: rec.step,
    verbs: rec.verbs,
    expect: rec.expect,
    attached: rec.attached,
    turns,
    asks: rec.asks,
    appBuild: rec.appBuild,
    appPageStatus: rec.appPageStatus,
    notes: rec.notes,
    error: rec.error,
    state,
    fullEvidence: `step-${String(rec.step).padStart(2, '0')}.full.json`,
  };
}

// The human-readable trace lines for one step. Was `appendTrace(rec)` pushing onto a module-global
// `traceMd` array; now returns the pieces so the runner does `traceMd.push(...traceLines(rec))` and
// joins the whole file once at the end (`traceMd.join('\n')`). Some pieces themselves begin with a
// `\n` — that is intentional and part of the byte-for-byte format.
export function traceLines(rec) {
  const L = [];
  L.push(`\n## Step ${rec.step} — ${rec.verbs.join(', ')}`);
  for (const t of rec.turns) {
    L.push(`\n**sent:** ${String(t.sent).replace(/\n/g, ' ').slice(0, 200)}`);
    if (t.delegates?.length) L.push(`- delegates: ${t.delegates.join(', ')}`);
    if (t.yieldKinds?.length) L.push(`- yields: ${t.yieldKinds.join(', ')}`);
    if (t.errors?.length) L.push(`- errors: ${t.errors.map((e) => `${e.type}@${e.attempt}`).join(', ')}`);
    if (t.lastText) L.push(`- reply: ${String(t.lastText).replace(/\n/g, ' ').slice(0, 240)}`);
  }
  if (rec.asks?.length) L.push(`- asks: ${rec.asks.map((a) => `${a.kind}${a.matched ? `(matched)` : a.kind === 'question' && !a.answer ? '(UNANSWERED)' : ''}`).join(', ')}`);
  if (rec.appBuild) L.push(`- app: built=${rec.appBuild.built} pageStatus=${rec.appPageStatus}`);
  if (rec.state) {
    L.push(`- spaces: ${(rec.state.spaces ?? []).join(', ') || '(none)'}`);
    const tables = Object.keys(rec.state.appTables ?? {});
    if (tables.length) L.push(`- app tables: ${tables.map((t) => `${t}(${(rec.state.appTables[t] ?? []).length})`).join(', ')}`);
  }
  if (rec.notes?.length) L.push(`- notes: ${rec.notes.join(' · ')}`);
  if (rec.error) L.push(`- ⚠️ ERROR: ${rec.error.split('\n')[0]}`);
  L.push(`\n**expect (judge verifies):**`);
  for (const e of rec.expect) L.push(`  - [ ] ${e}`);
  return L;
}
