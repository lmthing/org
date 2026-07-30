/**
 * scope.mjs — reduce a session `trace.json` to the digest the ratchet metrics need.
 *
 * **This is the module that makes the metrics honest.** The pipeline's own verdicts —
 * `verify.{ok,built,viewsValidated,renderSmoked,unavailable}`, `plan_views[].cannotExpress`,
 * `implement_views[].{ok,error}` — are produced by HOST code and by task `currentTask.resolve`
 * calls, and none of them reaches `step-NN.json`. They are, however, serialized VERBATIM by the
 * host into every downstream fork's prompt:
 *
 *     libs/core/src/fork/fork.ts:L398-L407
 *       `\nContext variables (available in scope):\n${…map(([k, v]) => `- ${k}: ${JSON.stringify(v)}`)}`
 *       `\nInputs from upstream tasks (available as variables):\n${…same shape…}`
 *
 * So the `llm_request` event of the `finalize` fork carries the final `verify` object as JSON — a
 * host-serialized number, not a model's account of it. That is the source every gate metric reads.
 * `JSON.stringify` is called with no indent and no truncation, so each value is exactly one line.
 *
 * What the trace does NOT carry, and therefore what no metric may invent:
 *   - a yield's RESULT (`yield_resolved` holds `{ts,type,context,nodeId,kind,yieldId}` only), so the
 *     tasklist's own return value — `18-finalize`'s resolved object — is unavailable;
 *   - `renderSmokeViews`' per-page binding-coverage percentage: `16-verify` reduces its result to a
 *     findings list before resolving, so the number exists only inside the pod, for one instant.
 */
import { readFileSync } from 'node:fs';

/** The two block headers `fork.ts` emits above the `- name: json` lines. Load-bearing strings. */
export const SCOPE_HEADERS = ['Context variables (available in scope):', 'Inputs from upstream tasks (available as variables):'];

/** The three view writers. A statement calling one of these is a WRITE ATTEMPT. */
export const VIEW_WRITER_RE = /\bwriteProjectView(Component|Shell)?\s*\(/;
/** Which writer a statement called (first match wins — a statement rarely calls two). */
export function writerOf(code) {
  if (/\bwriteProjectViewComponent\s*\(/.test(code)) return 'writeProjectViewComponent';
  if (/\bwriteProjectViewShell\s*\(/.test(code)) return 'writeProjectViewShell';
  if (/\bwriteProjectView\s*\(/.test(code)) return 'writeProjectView';
  return null;
}

/**
 * A JS engine fault, NOT a writer rejection.
 *
 * The distinction is the whole point of the retries-per-write metric: a `writeProjectView` that the
 * validator rejected throws a `LintError` whose message is the menu-shaped finding text
 * (`libs/cli/src/app/authoring/globals.ts#writeProjectView` → `throwLint` → `formatViewErrors`), and
 * that arrives in the trace as an `eval_error` — indistinguishable BY EVENT TYPE from
 * `'writeProjectView' is not defined`, which is a capability-wiring fault and says nothing about the
 * error text's quality. Counting the second as a "retry" would blame the prompt for a host bug (the
 * live 13-plant-care run 1 produced 38 of them and zero real rejections).
 *
 * Matched on the bare shapes QuickJS produces for ReferenceError/TypeError, anchored at the start so
 * a finding message that merely CONTAINS "is not a…" ("…is not an endpoint") never matches.
 */
const HOST_FAULT_RES = [
  /^'[^']*' is not (defined|a function)/,
  /^[A-Za-z_$][\w$]* is not (defined|a function)/,
  /^Cannot read propert/,
  /^Cannot access /,
  /^Maximum call stack/,
  /^out of memory/i,
];
export function isHostFault(message) {
  const m = String(message ?? '');
  return HOST_FAULT_RES.some((re) => re.test(m));
}

/**
 * Parse the `- name: json` scope lines out of one rendered fork prompt.
 *
 * Anchored on the block headers and stopped at the first line that is not a parseable
 * `- name: json`, because the task INSTRUCTION above them is markdown full of `- ` bullets.
 * Returns `{ values, unparsed }` — a line that looked like a scope line but did not parse is
 * REPORTED, never dropped, so a host change to the format shows up as a coverage gap.
 */
export function parseScopeBlocks(text) {
  const values = {};
  const unparsed = [];
  const lines = String(text ?? '').split('\n');
  for (let i = 0; i < lines.length; i += 1) {
    if (!SCOPE_HEADERS.includes(lines[i].trim())) continue;
    for (let j = i + 1; j < lines.length; j += 1) {
      const m = /^- ([A-Za-z_$][\w$]*): (.*)$/.exec(lines[j]);
      if (!m) break;
      try {
        values[m[1]] = JSON.parse(m[2]);
      } catch {
        unparsed.push({ name: m[1], head: m[2].slice(0, 160) });
      }
      i = j;
    }
  }
  return { values, unparsed };
}

/** A `fork:<taskId>` / `fork:<taskId>:prelude` context → the task id. Anything else → null. */
export function taskOf(context) {
  const m = /^fork:([A-Za-z_][\w]*)/.exec(String(context ?? ''));
  return m ? m[1] : null;
}

/**
 * Reduce a full trace to a bounded digest.
 *
 * Everything unbounded (llm prompts, every statement body) is consumed and dropped here; what
 * survives is O(writes + errors + tasks), so a caller can hold the digests of every session in a run
 * at once even though the traces themselves are tens of megabytes.
 */
export function digestTrace(records, { tracePath = null, sessionId = null, scope = null } = {}) {
  const digest = {
    tracePath,
    sessionId,
    scope,
    events: records.length,
    firstTs: null,
    lastTs: null,
    llmCalls: 0,
    tokens: { in: 0, out: 0 },
    models: {},
    forks: 0,
    /** taskId → { taskStarts, forkStarts, statements, writerCalls, rejections, hostFaults, typecheckErrors } */
    tasks: {},
    /** Every statement that called a view writer, in order. */
    writerCalls: [],
    /** eval_errors on a writer statement, classified. */
    writerErrors: [],
    /** typecheck_errors on a writer statement — never reached the writer at all. */
    writerTypecheckErrors: [],
    /** All eval/typecheck errors, per task, counted (not stored) so nothing here grows with the run. */
    errorCounts: { eval_error: 0, typecheck_error: 0 },
    unrecoveredErrors: 0,
    /** taskId → { value, ts, fromContext } — the LAST host-serialized value seen for that task. */
    scopeValues: {},
    scopeUnparsed: [],
    /** Statements from `plan_views` that mention cannotExpress — the planner's own declaration. */
    cannotExpressStatements: [],
    lastText: null,
  };

  const bump = (taskId) => {
    if (!taskId) return null;
    digest.tasks[taskId] ??= { taskStarts: 0, forkStarts: 0, statements: 0, writerCalls: 0, rejections: 0, hostFaults: 0, typecheckErrors: 0 };
    return digest.tasks[taskId];
  };

  for (const rec of records) {
    const e = rec?.event ?? rec;
    if (!e || typeof e !== 'object') continue;
    if (typeof e.ts === 'number') {
      digest.firstTs = digest.firstTs == null ? e.ts : Math.min(digest.firstTs, e.ts);
      digest.lastTs = digest.lastTs == null ? e.ts : Math.max(digest.lastTs, e.ts);
    }
    const task = taskOf(e.context);

    switch (e.type) {
      case 'node_start': {
        // `label` is `fork:<taskId>` / `task:<taskId>` / `tasklist:<name>`; `kind` is the node type.
        const labelTask = taskOf(e.label) ?? taskOf(e.context);
        const t = bump(labelTask);
        if (e.kind === 'fork') {
          digest.forks += 1;
          if (t) t.forkStarts += 1;
        } else if (e.kind === 'task' && t) t.taskStarts += 1;
        break;
      }
      case 'llm_response': {
        digest.llmCalls += 1;
        digest.tokens.in += e.inputTokens ?? 0;
        digest.tokens.out += e.outputTokens ?? 0;
        break;
      }
      case 'llm_request': {
        if (e.model) digest.models[e.model] = (digest.models[e.model] ?? 0) + 1;
        const text = Array.isArray(e.messages) ? e.messages.map((m) => m?.content ?? '').join('\n') : '';
        const { values, unparsed } = parseScopeBlocks(text);
        for (const [name, value] of Object.entries(values)) {
          const prev = digest.scopeValues[name];
          if (!prev || (e.ts ?? 0) >= prev.ts) digest.scopeValues[name] = { value, ts: e.ts ?? 0, fromContext: e.context ?? null };
        }
        for (const u of unparsed) digest.scopeUnparsed.push({ ...u, context: e.context ?? null });
        break;
      }
      case 'statement': {
        const t = bump(task);
        if (t) t.statements += 1;
        const code = String(e.code ?? '');
        const writer = writerOf(code);
        if (writer) {
          digest.writerCalls.push({ writer, task, context: e.context ?? null, ts: e.ts ?? null, code: code.slice(0, 400) });
          if (t) t.writerCalls += 1;
        }
        if (task === 'plan_views' && code.includes('cannotExpress')) {
          digest.cannotExpressStatements.push({ ts: e.ts ?? null, code: code.slice(0, 2000) });
        }
        break;
      }
      case 'eval_error':
      case 'typecheck_error': {
        digest.errorCounts[e.type] += 1;
        if ((e.attempt ?? 1) >= 3) digest.unrecoveredErrors += 1;
        const t = bump(task);
        const stmt = String(e.statement ?? '');
        if (!VIEW_WRITER_RE.test(stmt)) break;
        const entry = {
          task,
          context: e.context ?? null,
          writer: writerOf(stmt),
          attempt: e.attempt ?? null,
          message: String(e.message ?? '').slice(0, 600),
        };
        if (e.type === 'typecheck_error') {
          digest.writerTypecheckErrors.push(entry);
          if (t) t.typecheckErrors += 1;
        } else if (isHostFault(e.message)) {
          digest.writerErrors.push({ ...entry, classified: 'host-fault' });
          if (t) t.hostFaults += 1;
        } else {
          digest.writerErrors.push({ ...entry, classified: 'writer-rejection' });
          if (t) t.rejections += 1;
        }
        break;
      }
      case 'display': {
        if (typeof e.content === 'string') digest.lastText = e.content;
        break;
      }
      default:
        break;
    }
  }
  digest.durationMs = digest.firstTs != null && digest.lastTs != null ? digest.lastTs - digest.firstTs : null;
  return digest;
}

/** Read + digest one trace file. Throws only on unreadable/unparseable JSON. */
export function readTraceDigest({ tracePath, sessionId = null, scope = null }) {
  const records = JSON.parse(readFileSync(tracePath, 'utf8'));
  if (!Array.isArray(records)) throw new Error(`trace ${tracePath} is not an array of {seq,event}`);
  return digestTrace(records, { tracePath, sessionId, scope });
}

/**
 * Merge several session digests into one run-level digest.
 *
 * A run can hold several sessions (`space_session` opens its own; `fresh_session` opens another).
 * Counts add; `scopeValues` takes the latest by timestamp, which is the last `verify` after the last
 * `fix` — the value `18-finalize` itself reads.
 */
export function mergeDigests(digests) {
  const out = digestTrace([], {});
  out.sessions = digests.map((d) => ({ sessionId: d.sessionId, scope: d.scope, events: d.events, tracePath: d.tracePath }));
  for (const d of digests) {
    out.events += d.events;
    out.llmCalls += d.llmCalls;
    out.tokens.in += d.tokens.in;
    out.tokens.out += d.tokens.out;
    out.forks += d.forks;
    out.unrecoveredErrors += d.unrecoveredErrors;
    out.errorCounts.eval_error += d.errorCounts.eval_error;
    out.errorCounts.typecheck_error += d.errorCounts.typecheck_error;
    out.firstTs = out.firstTs == null ? d.firstTs : Math.min(out.firstTs, d.firstTs ?? out.firstTs);
    out.lastTs = out.lastTs == null ? d.lastTs : Math.max(out.lastTs, d.lastTs ?? out.lastTs);
    for (const [m, n] of Object.entries(d.models)) out.models[m] = (out.models[m] ?? 0) + n;
    for (const [id, t] of Object.entries(d.tasks)) {
      out.tasks[id] ??= { taskStarts: 0, forkStarts: 0, statements: 0, writerCalls: 0, rejections: 0, hostFaults: 0, typecheckErrors: 0 };
      for (const k of Object.keys(out.tasks[id])) out.tasks[id][k] += t[k] ?? 0;
    }
    out.writerCalls.push(...d.writerCalls);
    out.writerErrors.push(...d.writerErrors);
    out.writerTypecheckErrors.push(...d.writerTypecheckErrors);
    out.cannotExpressStatements.push(...d.cannotExpressStatements);
    out.scopeUnparsed.push(...d.scopeUnparsed);
    for (const [name, v] of Object.entries(d.scopeValues)) {
      const prev = out.scopeValues[name];
      if (!prev || v.ts >= prev.ts) out.scopeValues[name] = v;
    }
    if (d.lastText) out.lastText = d.lastText;
  }
  out.durationMs = out.firstTs != null && out.lastTs != null ? out.lastTs - out.firstTs : null;
  return out;
}
