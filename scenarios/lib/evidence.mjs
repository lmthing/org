/**
 * evidence.mjs — the pure evidence transforms the scenario runner writes for the JUDGE.
 *
 * These were inlined in the runner; extracted here verbatim so they can be unit-tested (golden
 * fixtures) and reused. FIELD INSERTION ORDER is the byte-compat contract: the runner writes every
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

// A step whose every turn ran NOTHING — no reply, no yields, no delegate, no error, and no ask —
// is a DEAD step, not a played one: a resumed/hung session can absorb the message and stream zero
// work, which previously recorded as a silently-"completed" step (06-tanzania run 28's empty
// step-04, where the restored session never streamed a statement and was later reaped idle).
// Returns the error string to record, or null when the step shows any sign of life.
export function deadTurnError(rec) {
  if (rec.error || !rec.turns?.length || rec.asks?.length) return null;
  const dead = rec.turns.every(
    (t) => t && (t.empty === true || (!t.lastText && !t.yields?.length && !t.delegates?.length && !t.errors?.length)),
  );
  return dead
    ? 'DEAD TURN: the session accepted the message but streamed no work, no reply, and no ask'
    : null;
}

// Defense-in-depth secrets hygiene: never persist a credential into step evidence. Three passes,
// applied to a yield's args (and any other compacted body) BEFORE it is written — (1) exact-match any
// secret VALUE the runner can see in its own env (best-effort; a no-op when the runner env lacks the
// keys), (2) mask the value of any object field whose KEY looks like a credential, (3) mask obvious
// Bearer / `sk-` / `tvly-` tokens embedded in a string. The model surface no longer declares
// fetch/process.env, so a model can't hand-roll a keyed request — this also guards the system-function
// BODIES' own yield args (06-tanzania run 26 leaked the Tavily key through a fetch-yield's args).
const SECRET_KEY_RE = /(api[_-]?key|apikey|secret|token|authorization|auth|password|passwd|bearer|access[_-]?key)/i;
const SECRET_ENV_RE = /(_KEY|_SECRET|_TOKEN|_PASSWORD|API_KEY)$/i;
const secretEnvValues = () =>
  Object.entries(typeof process !== 'undefined' ? process.env : {})
    .filter(([k, v]) => SECRET_ENV_RE.test(k) && typeof v === 'string' && v.length >= 12)
    .map(([, v]) => v);

export function redactSecrets(value) {
  const secrets = secretEnvValues();
  const maskField = (s) => (s.length > 6 ? s.slice(0, 3) + '…«REDACTED»' : '«REDACTED»');
  const scrubString = (s) => {
    let out = s;
    for (const sec of secrets) if (out.includes(sec)) out = out.split(sec).join('«REDACTED»');
    return out.replace(/\b(Bearer\s+|sk-|tvly-)[A-Za-z0-9._-]{6,}/g, (_m, p) => p + '«REDACTED»');
  };
  const walk = (v) => {
    if (v == null) return v;
    if (typeof v === 'string') return scrubString(v);
    if (Array.isArray(v)) return v.map(walk);
    if (typeof v === 'object') {
      const out = {};
      for (const [k, val] of Object.entries(v)) {
        out[k] = SECRET_KEY_RE.test(k) && typeof val === 'string' ? maskField(val) : walk(val);
      }
      return out;
    }
    return v;
  };
  return walk(value);
}

export function compact(args) {
  const safe = redactSecrets(args);
  try {
    const s = JSON.stringify(safe);
    return s && s.length > 400 ? s.slice(0, 400) + '…' : safe;
  } catch {
    return String(safe);
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
    createdProject: rec.createdProject,
    userProjectClean: rec.userProjectClean,
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
  if (rec.asks?.length) L.push(`- asks: ${rec.asks.map((a) => `${a.kind}${a.cancelled ? '(cancelled)' : a.matched ? '(matched)' : a.kind === 'question' && !a.answer ? '(UNANSWERED)' : ''}`).join(', ')}`);
  if (rec.appBuild) L.push(`- app: built=${rec.appBuild.built} pageStatus=${rec.appPageStatus}`);
  if (rec.state) {
    L.push(`- spaces: ${(rec.state.spaces ?? []).join(', ') || '(none)'}`);
    const tables = Object.keys(rec.state.appTables ?? {});
    if (tables.length) L.push(`- app tables: ${tables.map((t) => `${t}(${(rec.state.appTables[t] ?? []).length})`).join(', ')}`);
  }
  // ── direct-pod-probe verbs (0 LLM calls) — surfaced only when the step actually used them, so a
  // step without them reproduces the exact trace this file always produced. ───────────────────────
  if (rec.spaceSession) L.push(`- space_session: ${rec.spaceSession}`);
  if (rec.callAppApi) L.push(`- call_app_api: ${rec.callAppApi.method} ${rec.callAppApi.path} → ${rec.callAppApi.status}`);
  if (rec.runEmitter) L.push(`- run_emitter: ${rec.runEmitter.slug ?? `${rec.runEmitter.scope}:${rec.runEmitter.name}`}`);
  if (rec.inbound) L.push(`- inbound: ${rec.inbound.map((d) => `${d.path}→${d.status}`).join(', ')}`);
  if (rec.integrations) L.push(`- integrations: ${JSON.stringify(rec.integrations).slice(0, 200)}`);
  if (rec.setEnv) L.push(`- set_env: ${rec.setEnv.keys.join(', ')}`);
  if (rec.blankEnv) L.push(`- blank_env: ${rec.blankEnv.keys.join(', ')}`);
  if (rec.restoreEnv) L.push('- restore_env: true');
  if (rec.mutateSchema) L.push(`- mutate_schema: ${rec.mutateSchema.table}`);
  if (rec.notes?.length) L.push(`- notes: ${rec.notes.join(' · ')}`);
  if (rec.error) L.push(`- ⚠️ ERROR: ${rec.error.split('\n')[0]}`);
  L.push(`\n**expect (judge verifies):**`);
  for (const e of rec.expect) L.push(`  - [ ] ${e}`);
  return L;
}
