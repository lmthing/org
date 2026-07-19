import type { VM } from '../sandbox/quickjs.js';
import type { MessageHistory } from '../context/history.js';
import type { RenderHost } from '../session/types.js';
import type { YieldRequest } from './yield.js';
import type { StreamOpts, StreamSession } from './stream-types.js';
import { NULL_TRACER } from '../sandbox/trace.js';
import type { Tracer, TraceScope } from '../sandbox/trace.js';
import { BoundaryDetector } from '../sandbox/boundary.js';
import { sanitizeModelHabits } from './model-habits.js';
import { runTsc } from '../typecheck/tsc.js';
import { transpileStatement } from '../typecheck/transpile.js';
import { buildErrorBlock } from './error-rewind.js';
import { emitVariables, extractBindingNames, extractBindingPattern, type BindingKind } from '../context/variables.js';
import { formatInspectResult, type InspectQuery } from '../globals/inspect.js';
import { serialize } from '../globals/serialize.js';
import type { ReadDocumentResult } from '../globals/read-document.js';
import { BudgetExceededError, type Budget } from './budget.js';

export type { StreamOpts, StreamSession };

/** Known markdown fence language tags. */
const FENCE_LANGS = ['typescript', 'javascript', 'tsx', 'jsx', 'json', 'ts', 'js'];

/** Max sequential yield batches serviced for one statement (see the servicing loop in
 *  runTurnLoop). A statement normally yields once or one concurrent batch; helpers that
 *  await host calls back-to-back (webFetch's plain→render, webSearch's provider chain)
 *  need a few more. Generous cap purely to bound a pathological await-in-loop; the
 *  tool-call budget is the real limiter. */
const MAX_SEQUENTIAL_YIELDS = 64;

/** Duck-typed check for a successful text {@link ReadDocumentResult}. */
function isReadableDocument(v: unknown): v is ReadDocumentResult & { text: string } {
  return (
    typeof v === 'object' &&
    v !== null &&
    (v as ReadDocumentResult).ok === true &&
    (v as ReadDocumentResult).kind === 'text' &&
    typeof (v as ReadDocumentResult).text === 'string'
  );
}

/**
 * Build a DOCUMENT CONTENTS block from any `readDocument` yields that returned
 * text, so the model reads the FULL document rather than the 200-char VARIABLES
 * preview of the bound result. Returns '' when no document was read. `yields[i]`
 * aligns with `resolvedValues[i]`.
 */
export function formatReadDocuments(yields: YieldRequest[], resolvedValues: unknown[]): string {
  const docs: Array<ReadDocumentResult & { text: string }> = [];
  for (let i = 0; i < yields.length; i++) {
    if (yields[i]?.kind !== 'readDocument') continue;
    const v = resolvedValues[i];
    if (isReadableDocument(v)) docs.push(v);
  }
  if (docs.length === 0) return '';
  const blocks = docs.map((d) => {
    const label = d.filename ?? d.attachmentId;
    const trunc = d.truncated ? ' — truncated (capped); later content was not included' : '';
    return `--- ${label} (${d.mediaType})${trunc} ---\n${d.text}`;
  });
  return (
    'DOCUMENT CONTENTS (full text of the file(s) you just read — answer from THIS, ' +
    'not from the truncated `doc` preview in VARIABLES above):\n\n' +
    blocks.join('\n\n')
  );
}

/** Duck-typed extraction of the text a `loadKnowledge` yield resolved to: either the
 *  raw markdown string (no frontmatter), or the `{ frontmatter, body }` shape's `body`
 *  (`globals/load-knowledge.ts#parseKnowledgeContent`). Anything else (a failed/undefined
 *  resolution) is not knowledge text. */
function knowledgeTextOf(v: unknown): string | undefined {
  if (typeof v === 'string') return v;
  if (typeof v === 'object' && v !== null && typeof (v as { body?: unknown }).body === 'string') {
    return (v as { body: string }).body;
  }
  return undefined;
}

/** Purely defensive — real knowledge files are short, hand/model-authored markdown
 *  (typically well under 2 KB); this only bounds a pathological outlier so it can't
 *  balloon a prompt. */
const LOAD_KNOWLEDGE_MAX_CHARS = 20_000;

/**
 * Build a KNOWLEDGE CONTENTS block from any `loadKnowledge` yields that resolved to
 * text, so the model reads the FULL knowledge file rather than the 200-char VARIABLES
 * preview of the bound result — the same gap {@link formatReadDocuments} already closes
 * for `readDocument`, never extended to `loadKnowledge`. A loaded knowledge file is
 * exactly as much "the thing to ground an answer in" as an uploaded document: past the
 * 200-char cap the model was silently blind to the rest and free-invented it instead of
 * quoting it (confirmed failure modes: a classification guide's decisive exception
 * clause landing past char 200 was never read at all, and a grounded-answer task
 * fabricated facts a longer knowledge file held in full, in both cases citing the file
 * as its "source"). Returns '' when no loadKnowledge yield resolved to text. `yields[i]`
 * aligns with `resolvedValues[i]`.
 */
export function formatLoadKnowledgeContents(yields: YieldRequest[], resolvedValues: unknown[]): string {
  const entries: Array<{ label: string; text: string }> = [];
  for (let i = 0; i < yields.length; i++) {
    if (yields[i]?.kind !== 'loadKnowledge') continue;
    const text = knowledgeTextOf(resolvedValues[i]);
    if (text === undefined) continue;
    const label = (yields[i]?.args?.[0] as string | undefined) ?? `knowledge[${i}]`;
    const truncated = text.length > LOAD_KNOWLEDGE_MAX_CHARS;
    const body = truncated
      ? `${text.slice(0, LOAD_KNOWLEDGE_MAX_CHARS)}\n… truncated (${text.length} chars total)`
      : text;
    entries.push({ label, text: body });
  }
  if (entries.length === 0) return '';
  const blocks = entries.map((e) => `--- ${e.label} ---\n${e.text}`);
  return (
    'KNOWLEDGE CONTENTS (full text of the knowledge file(s) you just loaded — answer from THIS, ' +
    'not from the truncated preview in VARIABLES above):\n\n' +
    blocks.join('\n\n')
  );
}

/** Every suffix (length ≥ 2) of a fence language tag. A bare fence tag is left
 *  behind when the stream splits the opening ``` from its language across chunks,
 *  so the per-chunk fence filter strips the ``` but not the tag. The split can land
 *  ANYWHERE in the word — `` ```typ `` in one chunk (stripped) + `escript` in the
 *  next, or `` ```types `` + `cript` — leaking a partial-tag fragment as a bogus
 *  statement (the "Cannot find name 'cript'" failure). A standalone line that is any
 *  suffix of a fence tag is never valid TS, so dropping it is safe. Single-character
 *  suffixes are excluded so a legitimate one-letter probe (e.g. a bare `x`) survives. */
const FENCE_LANG_SUFFIXES: ReadonlySet<string> = new Set(
  FENCE_LANGS.flatMap((lang) => {
    const suffixes: string[] = [];
    for (let i = 0; i <= lang.length - 2; i++) suffixes.push(lang.slice(i));
    return suffixes;
  }),
);

/** Strip markdown code fence lines (and stray/partial fence language tags) from a
 *  chunk before feeding to the boundary detector. Exported for direct testing.
 *
 *  NOTE: only safe on text whose newlines are FINAL (a complete response, or the
 *  end-of-stream flush). For live streaming chunks use {@link FenceLineFilter} —
 *  applying this per chunk swallowed mid-statement tokens that happened to arrive
 *  as their own chunk and equal a fence-lang suffix (live E5 failure:
 *  `JSON.stringify` streamed as […, "JSON", ".stringify…"] became `.stringify`,
 *  corrupting the architect's statement; a lone " on" chunk dies the same way). */
export function stripMarkdownFences(chunk: string): string {
  return chunk
    .split('\n')
    .filter((line) => !/^\s*```/.test(line) && !FENCE_LANG_SUFFIXES.has(line.trim().toLowerCase()))
    .join('\n');
}

/** Streaming-safe fence stripper: drop decisions are only ever made on COMPLETE
 *  lines (chunk boundaries are token boundaries, not line boundaries), so a
 *  mid-statement token that streams as its own chunk and equals a fence-lang
 *  suffix (`JSON`, ` on`, `ts`, …) is never swallowed. A partial line is held
 *  back ONLY while it could still grow into a droppable line — a short
 *  all-letter run (potential bare fence tag) or a backtick opening; anything
 *  else is released immediately so ordinary statements keep flowing through the
 *  live streaming pipeline (with its tracer events) instead of piling into the
 *  end-of-stream flush. Once a line's head has been released, its remainder is
 *  exempt from drop checks (it is provably part of a real code line). A fence
 *  tag split across chunks (```typ + escript) reassembles here and drops via
 *  the ^``` rule. */
export class FenceLineFilter {
  private buf = '';
  /** Part of the current (still-open) line was already released downstream. */
  private headEmitted = false;

  private static droppable(line: string): boolean {
    return /^\s*```/.test(line) || FENCE_LANG_SUFFIXES.has(line.trim().toLowerCase());
  }

  /** Could this partial line still become droppable with more text appended? */
  private static ambiguous(tail: string): boolean {
    return /^\s*(?:`{1,3}.*|[A-Za-z]{0,10})$/.test(tail);
  }

  feed(chunk: string): string {
    this.buf += chunk;
    let out = '';
    const lines = this.buf.split('\n');
    this.buf = lines.pop()!;
    for (const line of lines) {
      const exempt = this.headEmitted; // remainder of a line whose head already shipped
      this.headEmitted = false;
      if (exempt || !FenceLineFilter.droppable(line)) out += line + '\n';
    }
    if (this.buf && (this.headEmitted || !FenceLineFilter.ambiguous(this.buf))) {
      out += this.buf;
      this.buf = '';
      this.headEmitted = true;
    }
    return out;
  }

  flush(): string {
    const tail = this.buf;
    this.buf = '';
    const exempt = this.headEmitted;
    this.headEmitted = false;
    return tail && (exempt || !FenceLineFilter.droppable(tail)) ? tail : '';
  }
}

/** Statements that begin with one of these never parse as the start of a prose
 *  sentence — they are real TS, so they are never treated as droppable prose. */
const TS_KEYWORD_START =
  /^(const|let|var|await|async|return|if|else|for|while|do|switch|case|break|continue|function|class|import|export|default|throw|new|typeof|delete|void|yield|try|catch|finally|this|super|null|true|false|undefined|debugger)\b/;

/** Lowercase English function words. A bare one of these as a standalone token is a
 *  strong signal the "statement" is natural-language prose, not code. */
const ENGLISH_FUNCTION_WORDS = new Set([
  'the', 'on', 'a', 'an', 'to', 'from', 'with', 'and', 'or', 'but', 'here', 'this',
  'that', 'these', 'those', 'we', 'now', 'then', 'of', 'for', 'in', 'as', 'it', 'its',
  'your', 'you', 'based', 'will', 'because', 'since', 'so', 'about', 'into', 'after',
  'by', 'at', 'let', 'sure', 'first', 'next', 'please', 'using', 'i', 'my', 'me',
]);

/** Detect when a model "statement" is actually a natural-language sentence (e.g. the
 *  model narrated "Based on the query, I will search…" instead of emitting code). Such
 *  text never parses as TS, so — like a stray fence tag — dropping it is safe and avoids
 *  burning a retry on a guaranteed typecheck error. Conservative by design: requires a
 *  sentence shape AND an English function word, and bails on anything with code syntax.
 *  Exported for direct testing. */
export function looksLikeProse(stmt: string): boolean {
  const s = stmt.trim();
  if (!s) return false;
  // Any code punctuation → treat as code, keep it.
  if (/[=(){}\[\];`<>]/.test(s)) return false;
  if (/=>|\.\w|\bawait\b/.test(s)) return false;
  // Real statement keywords are never prose.
  if (TS_KEYWORD_START.test(s)) return false;
  const words = s.split(/\s+/);
  if (words.length < 3) return false; // single identifiers are valid probes (e.g. `inspect`)
  if (!/^[A-Za-z]/.test(s)) return false;
  // An apostrophe contraction (I'll, don't, let's, we're, it's) in text that already
  // cleared the code-punctuation guards above is unambiguously prose — real code with an
  // apostrophe is a string literal, which carries a quote and a code operator and is gone.
  if (/^[A-Za-z][\w]*'[A-Za-z]/.test(s) || /\b[A-Za-z]+'[a-z]{1,3}\b/.test(s)) return true;
  // Every token must be word-like (letters/digits/underscore + sentence punctuation) — prose
  // can reference identifiers like `search_broad`. The code-punctuation guard above plus the
  // required English function word below keep this from matching real statements.
  const allWordLike = words.every((w) => /^[A-Za-z][\w,'".:!?-]*$/.test(w));
  if (!allWordLike) return false;
  return words.some((w) => ENGLISH_FUNCTION_WORDS.has(w.toLowerCase().replace(/[,'".:!?_-]+$/, '')));
}

export interface TurnLoopDeps {
  vm: VM;
  history: MessageHistory;
  systemBlock: string;
  ambientDts: string;
  renderHost: RenderHost;
  streamFn: (opts: StreamOpts) => Promise<StreamSession>;
  processYield: (req: YieldRequest) => Promise<unknown>;
  maxRetries?: number;
  tracer?: Tracer;
  /** Label for trace events — e.g. 'session', 'fork:analyze_dish', 'delegate:pairing' */
  traceContext?: string;
  /** Structured execution scope (superset of traceContext). When present, every
   *  trace event carries nodeId for full observability. */
  scope?: TraceScope;
  /** Host-set budget. tickEpisode() per turn, tickToolCalls() per resolved yield.
   *  Exceeding a limit throws BudgetExceededError, which the caller disposes the VM on. */
  budget?: Budget;
  /** Optional model spec/alias for every request in this loop (e.g. a fork's
   *  role model). Passed through to streamFn; the provider resolves it. */
  model?: string;
  /** Seed for accumulatedContext: prior-turn statements so the typechecker knows
   *  variables bound in earlier turns (the VM still holds their values across
   *  continue()/resume()). Empty on a fresh start(); the Session carries it
   *  forward between turns via onContextSnapshot. */
  initialContext?: string;
  /** Called whenever accumulatedContext grows, with its latest value, so the
   *  Session can persist typecheck scope into the next turn. */
  onContextSnapshot?: (ctx: string) => void;
  /** Max times a single turn loop will re-prompt a model that stopped generating
   *  right after a non-yielding `await`-binding (a space-function result that the
   *  runtime does not auto-surface) — see CONTINUATION_NUDGE. Default 4. */
  maxContinueNudges?: number;
  /** Optional per-turn reminder hook (top-level session only). Returns a transient
   *  user message appended to THIS request only (never persisted) — used to re-surface
   *  open todos each turn so they are "not forgotten". Forks/delegates don't set it. */
  beforeTurn?: () => string | undefined;
  /** Inactivity watchdog: if the model stream emits no token for this many ms, the
   *  read is treated as a transient failure and retried (a silent no-token stall would
   *  otherwise hang the turn forever). Default 60000. */
  streamIdleMs?: number;
  /** Mid-turn history compaction hook (top-level session only). Called ONCE at the top of
   *  every cycle — before the prompt is built — so it covers error-retry, yield-resume AND
   *  nudge cycles alike. A long SINGLE turn (many yield-resume cycles) never crosses the
   *  turn boundary where the Session's per-turn summarizer runs, so without this its history
   *  can grow until the concatenated prompt overflows V8's max string length (the
   *  runaway-turn "Invalid string length" crash). Safe to call between cycles: no yield is
   *  pending, and the Session's implementation rewrites ONLY history (the in-flight binding
   *  lives in the VM + accumulatedContext, and keepLast preserves the recent VARIABLES
   *  block). See Session.maybeCompactHistoryBySize. Forks/delegates don't set it. */
  maybeCompact?: () => Promise<void>;
  /** Structural early-termination signal, checked at the TOP of every cycle (before any
   *  compaction or model request). When it returns true the loop returns 'done' immediately —
   *  the caller already has everything it needs and must NOT re-prompt the model. Used by
   *  `runDelegate` (`shouldStop: () => resultCaptured`): once a delegate's action tasklist is
   *  auto-captured — or the model explicitly resolves — the delegate's deliverable is in hand,
   *  so re-prompting is not just wasteful but unbounded for a weak/looping model that keeps
   *  re-emitting the same action tasklist call every turn (it never volunteers a no-statements
   *  turn). Absent ⇒ never short-circuits (sessions/forks rely on the natural done paths). */
  shouldStop?: () => boolean;
  /** True only for an INTERACTIVE top-level session turn (the Session's start/continue/
   *  resume). Left unset by forks, delegates and headless single-shots — they legitimately
   *  produce no `display()`. Gates the anti-silent no-visible-output guard below: an
   *  interactive turn that did real work yet reaches 'done' having emitted ZERO display()
   *  and ZERO ask() showed the user nothing, so we re-prompt once then fail loud. */
  interactive?: boolean;
  /** Reports whether THIS turn has emitted at least one top-level `display()` (the
   *  Session tracks it via its onDisplay hook). Combined with an `ask` yield this turn,
   *  it tells the no-visible-output guard whether the user saw anything. */
  hadVisibleOutput?: () => boolean;
}

/** Re-prompt sent when the model ends its response immediately after awaiting a
 *  non-yielding space function (e.g. `const r = await writeTaskFile(...)`) and
 *  binding the result. Those results are NOT surfaced to the model (only yields
 *  are), so a model that stops to "see" one would strand the run mid-program.
 *  This tells it the runtime truth and asks it to continue. */
const CONTINUATION_NUDGE =
  'Your statements ran successfully, but the task is not finished. Your last statement bound a value from a NON-yielding call (a space function such as writeTaskFile/validateSpace/listScaffoldedSpaces) — and those results are NOT shown to you automatically (only yielding calls like ask/inspect/delegate/registerSpace surface their value). Continue the program now:\n' +
  '- If you must SEE that result before the next step, call inspect(<var>) — it surfaces the value and resumes you.\n' +
  '- Otherwise keep emitting the remaining statements (validate, register, delegate, display the final result, …).\n' +
  'Only stop (reply with no code) once the whole task is complete and the final result has been displayed.';

/** Re-prompt sent when a whole turn produced ONLY natural-language prose — every "statement"
 *  was dropped by looksLikeProse, so nothing ran and nothing was saved, yet the model emitted
 *  visible text. Silently returning `done` there discards the entire turn (the "wrote a plan in
 *  prose, saved nothing" failure). This tells the model the runtime truth and asks for the real
 *  statements; if the very next turn is prose again, the turn loop fails LOUD instead. */
const DROPPED_PROSE_NUDGE =
  'Nothing ran. Prose is not executed here — your entire last response was natural-language text with no TypeScript statements, so NOTHING was run or saved. Do not describe what you will do; emit the actual statements now (e.g. `const x = await …;`, `db.insert(...)`, `display(...)`). If the task is genuinely already complete, reply with no code at all.';

/** Re-prompt sent when an INTERACTIVE turn did real work (ran statements) but is about to
 *  settle having shown the user NOTHING — no `display()` and no `ask()`. That is a silent
 *  turn: the work happened but the user sees a blank reply. This tells the model to surface
 *  the result; if it settles output-less again, the loop fails LOUD instead of returning a
 *  blank `done`. (Distinct from DROPPED_PROSE, which fires when NOTHING ran.) */
const NO_OUTPUT_NUDGE =
  'You did the work but showed the user nothing — this turn ran statements yet called neither display() nor ask(), so the user sees a blank reply. Surface the result now: display(...) the answer/outcome the user asked for (or ask(...) if you genuinely need input before you can). Do not stop until the user can see the result.';

/** Outcome of running the shared per-statement pipeline (typecheck → transpile →
 *  eval → pending-yield check). Callers own the parts that legitimately differ
 *  between the streaming loop and the trailing-buffer flush (tracer/log emissions,
 *  stream.abort()/aborted bookkeeping) — see the two call sites in runTurnLoop. */
type StatementOutcome =
  | { kind: 'dropped' }
  | { kind: 'typecheck_error'; message: string }
  | { kind: 'eval_error'; message: string }
  | { kind: 'yielded'; yield: YieldRequest }
  | { kind: 'ok' };

/** Maps yield-resolved values onto the bound names of a yielding statement's binding
 *  pattern (simple/array/object), then prefers the VM's own computed value for each
 *  name over the raw resolved value where they diverge. They agree whenever the
 *  yielding call IS the directly-awaited expression (every yield kind today). They
 *  diverge when a yield is nested inside another async function the model awaited
 *  instead (e.g. `webSearch()` awaiting `fetch()` internally) — there, the raw
 *  resolved value is the INNER yield's value, not the outer call's real return value,
 *  while the VM's own bytecode (continued via drivePendingJobs(), including the
 *  per-statement `globalThis[name] = name` propagation) has already computed the
 *  correct one. Falls back to the raw value when the VM reports the global as unset.
 *  Exported so a later phase (host-executed preludes) can reuse it. */
export function bindYieldResults(
  vm: VM,
  pattern: { kind: BindingKind; names: string[] },
  yieldCount: number,
  resolvedValues: unknown[],
): Record<string, unknown> {
  const variables: Record<string, unknown> = {};
  // Multiple yields ⟹ the statement awaited a combinator (Promise.all), whose result
  // is the array of resolved values in source order; a single yield ⟹ the result is
  // that one value.
  const awaited: unknown = yieldCount > 1 ? resolvedValues : resolvedValues[0];
  const asRecord = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' ? (v as Record<string, unknown>) : {});
  const asArray = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
  if (pattern.kind === 'array') {
    const arr = asArray(awaited);
    pattern.names.forEach((name, i) => { variables[name] = arr[i]; });
  } else if (pattern.kind === 'object') {
    const obj = asRecord(awaited);
    pattern.names.forEach((name) => { variables[name] = obj[name]; });
  } else if (pattern.names.length === 1) {
    variables[pattern.names[0]!] = awaited;
  }
  for (const name of pattern.names) {
    const vmValue = vm.getVar(name);
    if (vmValue !== undefined) variables[name] = vmValue;
  }
  return variables;
}

export async function runTurnLoop(deps: TurnLoopDeps): Promise<'done' | 'error'> {
  const { vm, history, systemBlock, ambientDts, renderHost, streamFn, processYield } = deps;
  const maxRetries = deps.maxRetries ?? 3;
  const tracer = deps.tracer ?? NULL_TRACER;
  const scope = deps.scope;
  const ctx = scope?.label ?? deps.traceContext ?? 'session';
  const nodeId = scope?.nodeId;
  // Mint a per-turn yieldId counter (cheap monotonic suffix)
  let yieldCounter = 0;

  let attempt = 0;
  // Persists across yield-continuations within a turn AND across turns: seeded from
  // deps.initialContext (prior-turn scope kept by the Session, since the VM still
  // holds those variables) and reported back via onContextSnapshot as it grows.
  // Only a fresh start() resets it (Session passes no initialContext there).
  let accumulatedContext = deps.initialContext ?? '';
  const appendContext = (stmt: string) => {
    accumulatedContext += (accumulatedContext ? '\n' : '') + stmt;
    deps.onContextSnapshot?.(accumulatedContext);
  };

  // Names bound by a yielding statement whose yield ERRORED on a retryable attempt.
  // That statement is never committed to accumulatedContext (it gets re-tried), so
  // without help a retry that references the name fails typecheck ("Cannot find name
  // 'top'" — the research-fork-scope-loss bug). We declare these as ambient `any`
  // globals (NOT in session context): a forward reference resolves against them, and
  // a re-emitted `const <name> = …` simply shadows them — no redeclare conflict.
  const yieldErrorNames = new Set<string>();
  const fullAmbient = (): string =>
    yieldErrorNames.size > 0
      ? ambientDts + '\n' + [...yieldErrorNames].map((n) => `declare const ${n}: any;`).join('\n')
      : ambientDts;
  let continueNudges = 0;
  const maxContinueNudges = deps.maxContinueNudges ?? 4;
  // TURN-level (persists across every cycle of this runTurnLoop call): true once ANY cycle
  // ran a real statement. Guards the anti-silent-prose check below so a turn that did real
  // work and then signed off in prose is NOT mistaken for an all-dropped-prose turn.
  let everRanStatement = false;
  // Re-prompt budget for the all-dropped-prose guard: fire the nudge ONCE, then fail loud.
  let droppedProseNudges = 0;
  // TURN-level: true once ANY cycle resolved an `ask` yield (user-visible interaction).
  // Consumed, together with deps.hadVisibleOutput() (display), by the no-visible-output guard.
  let didAsk = false;
  // Re-prompt budget for the no-visible-output guard: nudge ONCE, then fail loud.
  let noOutputNudges = 0;

  // Anti-silent-turn guard (no-visible-output case) — see NO_OUTPUT_NUDGE. Verdict for the
  // CURRENT settle: an INTERACTIVE turn that ran real work but emitted no display() AND no
  // ask() showed the user nothing → ONE nudge, then fail loud. `null` ⇒ not applicable (let
  // the normal 'done' proceed). Gated on `interactive` so forks/delegates (which legitimately
  // never display) and headless single-shots are never touched; on `everRanStatement` so it
  // stays disjoint from the DROPPED_PROSE / empty-response paths (which ran nothing).
  const noVisibleOutputVerdict = (): 'nudge' | 'fail' | null => {
    const silent =
      deps.interactive === true &&
      everRanStatement &&
      !didAsk &&
      !(deps.hadVisibleOutput?.() ?? false);
    if (!silent) return null;
    return noOutputNudges < 1 ? 'nudge' : 'fail';
  };

  while (attempt < maxRetries) {
    attempt++;
    // Structural early stop (delegate auto-capture): the caller signals it already holds the
    // deliverable, so end the turn cleanly INSTEAD of re-prompting. Checked first — before any
    // compaction or model request — so a weak/looping delegate that keeps re-emitting its action
    // tasklist call terminates the moment its result is captured, rather than spinning forever.
    if (deps.shouldStop?.()) {
      renderHost.log(`[turn ${attempt}] caller signalled stop — done`);
      tracer.write({ ts: Date.now(), type: 'turn_end', context: ctx, ...(nodeId ? { nodeId } : {}), reason: 'done' });
      return 'done';
    }
    // Mid-turn history compaction. A single long turn (many yield-resume, error-retry or
    // nudge cycles) never crosses the turn boundary where the Session's per-turn summarizer
    // runs, so without this its `history` can grow until the concatenated prompt overflows
    // V8's max string length (the runaway-turn "Invalid string length" crash). Runs at the
    // TOP of every cycle — no yield is pending here, and the hook rewrites ONLY `history`;
    // the in-flight binding lives in the VM + accumulatedContext, and keepLast preserves the
    // just-appended VARIABLES block. See Session.maybeCompactHistoryBySize.
    await deps.maybeCompact?.();
    // Budget: count this LLM turn before issuing the request. Throws
    // BudgetExceededError (propagates out of runTurnLoop) if over the episode
    // or wall-clock cap — the caller disposes the VM. Counted outside the
    // stream try/catch so it cannot be swallowed as an abort.
    deps.budget?.tickEpisode();

    const basePromptMessages = history.getPromptMessages();
    // Soft per-turn reminder (e.g. open todos). Transient: appended to THIS request only,
    // never written to history, so it is re-evaluated fresh every turn and never duplicates.
    const reminder = deps.beforeTurn?.();
    const promptMessages = reminder
      ? [...basePromptMessages, { role: 'user' as const, content: reminder }]
      : basePromptMessages;
    tracer.write({ ts: Date.now(), type: 'llm_request', context: ctx, ...(nodeId ? { nodeId } : {}), system: systemBlock, messages: promptMessages, model: deps.model });
    let lastProgressTs = 0;
    const stream = await streamFn({ system: systemBlock, messages: promptMessages, model: deps.model });

    const detector = new BoundaryDetector();
    const fenceFilter = new FenceLineFilter();
    let pendingYield: YieldRequest | null = null;
    let yieldingStatement: string | null = null;
    let hadStatements = false;
    let turnError: string | null = null;
    let failingStatement: string | null = null;
    let aborted = false;
    // Set when the provider stream throws a NON-abort error (e.g. a dropped/terminated
    // connection). Distinct from `aborted` (our own intentional stream.abort() on a
    // statement boundary). A transient drop must be RETRIED, not mistaken for the model
    // finishing — otherwise the turn silently returns 'done' and strands the program.
    let streamErrored = false;
    // True when the last statement that evaluated cleanly this turn bound a value
    // from a NON-yielding call (a space-function result the runtime won't surface) —
    // whether or not it used `await`. Sync space functions like writeTaskFile/
    // validateSpace bind without `await`, and a model that stops right after one is
    // stranded mid-program (the exact failure CONTINUATION_NUDGE recovers from).
    let lastStmtNonYieldBinding = false;
    let assistantContent = '';
    const parsedStatements: string[] = [];

    // Shared per-statement pipeline: prose-drop check → typecheck → transpile +
    // globalThis-propagation → eval → pending-yield check → accumulatedContext append.
    // Used by both the main streaming loop and the trailing-buffer flush below. Mutates
    // the per-turn loop state captured above (turnError, failingStatement, pendingYield,
    // yieldingStatement, parsedStatements, lastStmtNonYieldBinding); callers own the
    // parts that differ between the two sites (tracer/log emissions, stream.abort()).
    const processStatement = (stmt: string): StatementOutcome => {
      if (looksLikeProse(stmt)) return { kind: 'dropped' };

      const tscResult = runTsc({ ambientDts: fullAmbient(), sessionContext: accumulatedContext, statement: stmt });
      if (!tscResult.ok) {
        const errMsg = tscResult.diagnostics.map((d) => d.message).join('; ');
        turnError = errMsg;
        failingStatement = stmt;
        return { kind: 'typecheck_error', message: errMsg };
      }

      // Transpile TS/JSX → JS, append globalThis bindings so the next module can
      // access variables declared here (each evalStatement is an isolated module).
      const boundNames = extractBindingNames(stmt);
      let jsCode = transpileStatement(stmt);
      if (boundNames.length > 0) {
        const assigns = boundNames
          .map((n) => `try { globalThis['${n}'] = ${n}; } catch {}`)
          .join('\n');
        jsCode += '\n' + assigns;
      }
      const evalResult = vm.evalStatement(jsCode);
      if (!evalResult.ok) {
        turnError = evalResult.error;
        failingStatement = stmt;
        return { kind: 'eval_error', message: evalResult.error };
      }

      if (vm.pendingYields.length > 0) {
        const yieldReq = vm.pendingYields[vm.pendingYields.length - 1]!;
        pendingYield = yieldReq;
        yieldingStatement = stmt;
        parsedStatements.push(stmt);
        return { kind: 'yielded', yield: yieldReq };
      }

      parsedStatements.push(stmt);
      appendContext(stmt);
      lastStmtNonYieldBinding = boundNames.length > 0 && /[A-Za-z_$][\w.$]*\s*\(/.test(stmt);
      return { kind: 'ok' };
    };

    // Neutralize known, provider-agnostic model output habits (e.g. a chain-of-thought
    // model leaking a stray </think> tag into its first statement) BEFORE the statement
    // is traced, typechecked or evaluated — a sibling of the fence/prose filters above.
    // The returned text is what every downstream site (log, trace, processStatement)
    // sees, so the trace stays honest with what actually ran. Runs at BOTH statement
    // sites (the streaming loop and the trailing-buffer flush). See eval/model-habits.ts.
    const sanitize = (raw: string): string => {
      const { text, applied } = sanitizeModelHabits(raw);
      if (applied.length > 0) renderHost.log(`[stmt] (sanitized model habit: ${applied.join(', ')})`);
      return text;
    };

    renderHost.log(`[turn ${attempt}] streaming...`);
    const idleMs = deps.streamIdleMs ?? 60_000;
    try {
      // Manual iteration so each token read can race an inactivity timeout. A silent
      // no-token stall (the architect-stall bug) is otherwise indistinguishable from a
      // slow model and hangs the turn forever; on idle we abort + mark a transient stream
      // error so the existing retry path re-issues the request.
      const iterator = stream.textStream[Symbol.asyncIterator]();
      while (true) {
        let idleTimer: ReturnType<typeof setTimeout> | undefined;
        const idle = new Promise<'idle'>((res) => { idleTimer = setTimeout(() => res('idle'), idleMs); });
        let step: IteratorResult<string> | 'idle';
        try {
          step = await Promise.race([iterator.next(), idle]);
        } finally {
          if (idleTimer) clearTimeout(idleTimer);
        }
        if (step === 'idle') {
          renderHost.log(`[turn ${attempt}] stream idle >${idleMs}ms — treating as transient error, will retry`);
          streamErrored = true;
          try { stream.abort(); } catch { /* ignore */ }
          break;
        }
        if (step.done) break;
        const chunk = step.value;
        assistantContent += chunk;
        const statements = detector.feed(fenceFilter.feed(chunk));

        for (const rawStmt of statements) {
          // Neutralize known model output habits (e.g. a leaked </think> tag), then:
          // drop narrated prose the model emitted instead of code (e.g. "Based on the
          // query, I will…"). Both never parse as TS, so handling them here avoids
          // burning a retry on a guaranteed typecheck error. Same rationale as stray
          // fence tags. `stmt` is the sanitized text so every trace/log below matches
          // what actually ran.
          const stmt = sanitize(rawStmt);
          const outcome = processStatement(stmt);
          if (outcome.kind === 'dropped') {
            renderHost.log(`[stmt] (dropped prose) ${stmt}`);
            tracer.write({ ts: Date.now(), type: 'statement', context: ctx, ...(nodeId ? { nodeId } : {}), code: `/* dropped non-code prose: ${stmt.slice(0, 80)} */` });
            continue;
          }
          hadStatements = true;
          renderHost.log(`[stmt] ${stmt}`);
          tracer.write({ ts: Date.now(), type: 'statement', context: ctx, ...(nodeId ? { nodeId } : {}), code: stmt });

          // Throttled streaming progress (≥250ms between emissions, subscriber-only)
          const now = Date.now();
          if (now - lastProgressTs >= 250) {
            lastProgressTs = now;
            tracer.write({ ts: now, type: 'llm_progress', context: ctx, ...(nodeId ? { nodeId } : {}), chars: assistantContent.length, statements: parsedStatements.length });
          }

          if (outcome.kind === 'typecheck_error') {
            stream.abort();
            aborted = true;
            tracer.write({ ts: Date.now(), type: 'typecheck_error', context: ctx, ...(nodeId ? { nodeId } : {}), statement: stmt, message: outcome.message, attempt });
            break;
          }

          if (outcome.kind === 'eval_error') {
            stream.abort();
            aborted = true;
            tracer.write({ ts: Date.now(), type: 'eval_error', context: ctx, ...(nodeId ? { nodeId } : {}), statement: stmt, message: outcome.message });
            break;
          }

          if (outcome.kind === 'yielded') {
            stream.abort();
            aborted = true;
            break;
          }
        }

        if (aborted) break;
      }
    } catch (err) {
      const isAbort = err instanceof Error && (err.name === 'AbortError' || err.message.includes('abort'));
      if (!isAbort) {
        renderHost.log(`Stream error: ${err instanceof Error ? err.message : String(err)}`);
        streamErrored = true;
      }
    }

    // A transient provider failure (dropped/terminated connection) that produced NO
    // usable output must be RETRIED — not silently treated as "the model finished".
    // Without this, one flaky stream ends the turn with 'done' and strands the whole
    // run (the exact failure that killed an optional research fork mid-pipeline).
    if (streamErrored && !hadStatements && !aborted) {
      tracer.write({ ts: Date.now(), type: 'turn_end', context: ctx, ...(nodeId ? { nodeId } : {}), reason: 'stream_error' });
      if (attempt >= maxRetries) {
        renderHost.log(`[turn ${attempt}] stream error exhausted retries — giving up this turn`);
        return 'error';
      }
      renderHost.log(`[turn ${attempt}] stream error with no output — retrying request`);
      // Brief backoff so we don't hammer a provider that just dropped us.
      await new Promise((r) => setTimeout(r, Math.min(2000, 300 * attempt)));
      continue;
    }

    // Flush remaining buffer. Unlike the streaming loop above, this never emits
    // statement/progress/error tracer events or renderHost logs, and never touches
    // `stream`/`aborted` (the stream has already ended) — that asymmetry is intentional
    // and predates this refactor; processStatement only supplies the shared pipeline.
    if (!aborted) {
      // Release the fence filter's held partial line first — it may complete one
      // or more statements in the detector — then flush the detector's own tail.
      const released = fenceFilter.flush();
      const flushedStatements = released ? detector.feed(released) : [];
      const trailing = detector.flush().trim();
      for (const rawStmt of [...flushedStatements, ...(trailing ? [trailing] : [])]) {
        const stmt = sanitize(rawStmt);
        const outcome = processStatement(stmt);
        if (outcome.kind !== 'dropped') hadStatements = true;
        // Mirror the streaming loop: stop at the first error or yield.
        if (outcome.kind !== 'ok' && outcome.kind !== 'dropped') break;
      }
    }

    // Record, across the whole turn, whether ANY real statement ever ran (covers both the
    // streaming loop and the flush above). Consumed by the anti-silent-prose guard below.
    if (hadStatements) everRanStatement = true;

    // Await token usage from the stream (best-effort; available after stream is consumed).
    // Skip when the stream was aborted mid-way (yield/error): the usage event arrives
    // only in the final API chunk, which never comes after abort, so the promise hangs.
    // Even on a "normal" end the promise can stay pending forever (provider ended the
    // stream without the final usage chunk — live E6 hang: one fork stalled here with
    // no timer left, the DAG deadlocked, and Node exited silently once every other
    // promise drained). Usage is telemetry, never worth blocking on: bound the wait.
    let inputTokens: number | undefined;
    let outputTokens: number | undefined;
    if (stream.usage && !aborted && !streamErrored) {
      let usageTimer: ReturnType<typeof setTimeout> | undefined;
      try {
        const u = await Promise.race([
          stream.usage,
          new Promise<undefined>((res) => { usageTimer = setTimeout(() => res(undefined), 10_000); }),
        ]);
        if (u && (u.promptTokens > 0 || u.completionTokens > 0)) {
          inputTokens = u.promptTokens;
          outputTokens = u.completionTokens;
        }
      } catch { /* usage unavailable */ } finally {
        if (usageTimer) clearTimeout(usageTimer);
      }
    }

    // Use parsed statements for history so incomplete trailing stream text is excluded.
    const historyContent = parsedStatements.length > 0 ? parsedStatements.join('\n') : assistantContent.trim();
    if (historyContent) {
      renderHost.log(`[model response]\n${historyContent}\n[/model response]`);
      tracer.write({
        ts: Date.now(), type: 'llm_response', context: ctx,
        ...(nodeId ? { nodeId } : {}),
        attempt, text: historyContent,
        ...(deps.model ? { model: deps.model } : {}),
        ...(inputTokens !== undefined ? { inputTokens } : {}),
        ...(outputTokens !== undefined ? { outputTokens } : {}),
      });
      history.append({ role: 'assistant', content: historyContent, blockType: 'normal' });
    }

    if (turnError && failingStatement) {
      // process.exit() is intentional termination, not a recoverable error. The model
      // uses it as control flow (e.g. `if (!ok) process.exit(1)`); retrying re-runs the
      // exact same code and burns LLM calls in a loop. Treat it as a clean stop.
      if (/\bprocess\.exit\(/.test(turnError)) {
        renderHost.log(`[process.exit] intentional termination — not retrying`);
        return 'done';
      }
      // Do NOT roll back accumulatedContext: statements that succeeded earlier in
      // this turn already bound their variables in the VM (globalThis) and persist
      // into the retry. Keeping them in the typecheck context matches VM reality —
      // rolling back would make tsc reject valid references with "Cannot find name".
      // The failing statement was never appended (it errors before accumulation), so
      // there is nothing partial to discard.
      renderHost.log(`[error] ${turnError}`);
      history.append({ role: 'user', content: buildErrorBlock(failingStatement, turnError, attempt, maxRetries, accumulatedContext), blockType: 'error' });
      if (attempt >= maxRetries) return 'error';
      continue;
    }

    if (pendingYield && yieldingStatement) {
      // Binding pattern of the yielding statement (kind + names).
      const pattern = extractBindingPattern(yieldingStatement);

      // Resolve the statement's yields to completion. Most statements yield once, or a
      // single CONCURRENT batch — `await Promise.all([fork(...), fork(...)])`. But a
      // model-awaited helper can also await host calls SEQUENTIALLY: e.g. `webFetch`
      // does a plain fetch and THEN, if the page is JS-rendered, a second fetch to the
      // render service; `webSearch`'s `auto` chain likewise falls Tavily→Bing→DuckDuckGo.
      // Each later await only surfaces as a pending yield AFTER `drivePendingJobs()`
      // resumes the prior one, so we loop until the VM has no pending yields left (the
      // statement has fully returned). Servicing only the first batch would bind an
      // incomplete value — the raw first Response — instead of the helper's real return.
      // The QuickJS module continuation after `await` does NOT re-run in this sync eval
      // model, so the host binds the final value itself (see bindYieldResults, below).
      // Bounded by MAX_SEQUENTIAL_YIELDS (a runaway is also bounded by the tool-call budget).
      const yields: YieldRequest[] = [];
      const resolvedValues: unknown[] = [];
      const yieldErrors: Array<{ kind: string; message: string }> = [];
      let batch = vm.pendingYields.splice(0);
      for (let guard = 0; batch.length > 0 && guard < MAX_SEQUENTIAL_YIELDS; guard++) {
        const base = resolvedValues.length;
        for (const y of batch) { yields.push(y); resolvedValues.push(undefined); if (y.kind === 'ask') didAsk = true; }
        // Budget: count each resolved yield as a tool call. Throws (and the caller
        // disposes the VM) if over the tool-call or wall-clock cap.
        deps.budget?.tickToolCalls(batch.length);
        await Promise.all(batch.map(async (yieldReq, i) => {
          const yieldId = `${nodeId ?? ctx}_y${++yieldCounter}`;
          tracer.write({ ts: Date.now(), type: 'yield', context: ctx, ...(nodeId ? { nodeId } : {}), kind: yieldReq.kind, args: yieldReq.args, yieldId });
          try {
            const resolved = await processYield(yieldReq);
            tracer.write({ ts: Date.now(), type: 'yield_resolved', context: ctx, ...(nodeId ? { nodeId } : {}), kind: yieldReq.kind, value: resolved, yieldId });
            yieldReq.deferred.resolve(resolved);
            resolvedValues[base + i] = resolved;
          } catch (err) {
            // A budget breach inside a yield (e.g. a fork rejected by the fork-depth
            // cap, or an over-budget fork) is a HARD stop, not a recoverable
            // tool error. Propagate it so it surfaces exactly like the episode and
            // tool-call caps (clean non-zero exit + VM disposal by the caller) —
            // instead of being swallowed into an undefined binding that lets the run
            // continue past its ceiling.
            if (err instanceof BudgetExceededError) throw err;
            yieldReq.deferred.reject(err);
            resolvedValues[base + i] = undefined;
            yieldErrors.push({ kind: yieldReq.kind, message: err instanceof Error ? err.message : String(err) });
          }
        }));
        vm.drivePendingJobs();
        // A yield that errored can't cleanly resume the VM continuation, so stop
        // servicing further sequential yields and let the error path below surface it
        // (and retry the turn). `fetch` never rejects — it resolves `{ok:false}` — so
        // webFetch/webSearch's sequential fetches always run to completion here.
        if (yieldErrors.length > 0) break;
        batch = vm.pendingYields.splice(0);
      }

      // The VM can be torn down (disposed) WHILE a long yield — e.g. a multi-minute nested
      // delegate — is in flight: an idle-reaper / capacity / memory eviction that races the
      // in-flight turn. Every resume op below (bindYieldResults' getVar, setVar, and the
      // drivePendingJobs already run above) would then throw the opaque QuickJS "Lifetime not
      // alive". Detect it here and end the turn with an ATTRIBUTABLE error instead — a clean,
      // retryable stop. This is a DEFENSIVE guard, not a root-cause fix: WHAT disposed the VM
      // is recorded separately as a `session_disposed` trace event by the session manager.
      // See CLAUDE.md's bridged-host-promise hazard.
      if (!vm.isAlive()) {
        renderHost.log(`[turn ${attempt}] session VM was disposed while a yield was in flight — aborting turn`);
        tracer.write({ ts: Date.now(), type: 'turn_end', context: ctx, ...(nodeId ? { nodeId } : {}), reason: 'vm_disposed' });
        return 'error';
      }

      // A yield that threw (e.g. delegate() to a hallucinated space key, a function
      // that errored) used to bind `undefined` silently — the model never learned why
      // and could not self-correct. Surface it as a normal turn error so the actionable
      // message (e.g. the list of real space keys) reaches the model and it retries.
      // Hard caps already short-circuited above; forks/tasklists salvage rather than
      // throw, so this primarily catches recoverable model mistakes. On the final attempt
      // we fall through and bind the undefined values so the run can still limp forward.
      if (yieldErrors.length > 0 && attempt < maxRetries) {
        turnError = yieldErrors.map((e) => `${e.kind}() failed: ${e.message}`).join('; ');
        failingStatement = yieldingStatement;
        renderHost.log(`[yield error] ${turnError}`);
        // Preserve the failed statement's bound names so a retry that references them
        // (or re-emits the binding) typechecks instead of dying with "Cannot find name".
        // Declared ambient (any) + seeded undefined in the VM so eval can't ReferenceError.
        for (const name of pattern.names) {
          yieldErrorNames.add(name);
          vm.setVar(name, undefined);
        }
        history.append({ role: 'user', content: buildErrorBlock(failingStatement, turnError, attempt, maxRetries, accumulatedContext), blockType: 'error' });
        continue;
      }

      // Map resolved values onto the bound names, preferring the VM's own computed
      // value for each name over the raw resolved-yield value where they diverge
      // (see bindYieldResults' doc comment — the webSearch()-awaiting-fetch() case).
      const variables = bindYieldResults(vm, pattern, yields.length, resolvedValues);
      for (const [name, value] of Object.entries(variables)) {
        vm.setVar(name, value); // inject into VM scope + host scope for the next turn
      }

      // Emit a serialized variables snapshot for the observability tree
      if (Object.keys(variables).length > 0) {
        const serialized: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(variables)) {
          serialized[k] = serialize(v);
        }
        tracer.write({ ts: Date.now(), type: 'variables', context: ctx, ...(nodeId ? { nodeId } : {}), vars: serialized });
      }

      // Add the yielding statement to accumulated context for future typecheck
      appendContext(yieldingStatement);

      // inspect() is a read-only probe: its whole purpose is to surface a value
      // (or a queried slice/path/keys view of it) to the MODEL. Unlike other yields
      // it is normally called WITHOUT a binding (`inspect(x)` / `inspect([x, q])`),
      // so the generic name-binding above captures nothing. Surface the inspected
      // values explicitly via formatInspectResult, independent of any binding —
      // otherwise a bare inspect() resolves to an empty VARIABLES block and the
      // model sees nothing (the exact failure that lets it re-type/​hallucinate
      // values instead of reading them).
      const inspectArgs = yields
        .filter((y) => y.kind === 'inspect')
        .flatMap((y) => (y.args as Array<{ value: unknown; query?: InspectQuery }>));

      // Always emit a continuation message so the model knows the yield resolved and
      // what's already in scope — even for yields with no variable bindings (e.g. sleep).
      if (Object.keys(variables).length > 0) {
        renderHost.log(`[variables] ${Object.keys(variables).join(', ')}`);
      } else if (inspectArgs.length > 0) {
        renderHost.log(`[inspect] ${inspectArgs.length} value(s)`);
      } else {
        renderHost.log(`[resumed]`);
      }

      let varContent = emitVariables(variables, accumulatedContext);
      if (inspectArgs.length > 0) {
        // Fold the inspected lines into the VARIABLES section the model already reads.
        // formatInspectResult returns "VARIABLES\ninspected[i]: …" — drop its header
        // and splice its lines in right after the existing VARIABLES header.
        const inspectLines = formatInspectResult(inspectArgs).split('\n').slice(1);
        varContent = varContent.replace(/^VARIABLES\n?/, (m) => m + inspectLines.join('\n') + '\n');
      }
      // readDocument results are meant to be READ IN FULL. The VARIABLES preview
      // serializes the bound `doc` with a 200-char string cap, so the model would
      // otherwise see only the opening of any real document (and mistake the preview
      // marker for real truncation). Surface each successfully-read document's whole
      // text as its own block, exactly as it came back from readDocument (already
      // capped host-side at READ_DOCUMENT_MAX_CHARS).
      const documentBlock = formatReadDocuments(yields, resolvedValues);
      if (documentBlock) varContent += `\n\n${documentBlock}`;
      // loadKnowledge results deserve the identical treatment — see formatLoadKnowledgeContents'
      // doc comment: the same 200-char VARIABLES cap silently hid everything past the opening
      // of any real knowledge file, and the model free-invented what it couldn't see.
      const knowledgeBlock = formatLoadKnowledgeContents(yields, resolvedValues);
      if (knowledgeBlock) varContent += `\n\n${knowledgeBlock}`;
      const budgetWarning = deps.budget?.nearLimitWarning();
      if (budgetWarning) varContent += `\n\n${budgetWarning}`;
      history.append({ role: 'user', content: varContent, blockType: 'variables' });

      // Reset the retry budget ONLY on a CLEAN resolution. If this turn's yields ERRORED and
      // we still reached here (attempt >= maxRetries → the fall-through above binds the failed
      // names to `undefined` so the run can limp forward), that is NOT progress. A model that
      // stubbornly re-emits the same failing yield (e.g. a forbidden delegate) would otherwise
      // get its retry counter zeroed every cycle and loop forever — each cycle appending another
      // error+variables block until the history string overflows V8's max length ("Invalid
      // string length"). Withholding the reset lets `attempt` climb past maxRetries so the loop
      // returns 'error' (forks then salvage a schema-valid placeholder; sessions stop) instead
      // of spinning.
      if (yieldErrors.length === 0) attempt = 0;
      continue;
    }

    if (!hadStatements) {
      // Anti-silent-turn guard (dropped-prose case): the turn ran ZERO statements yet the
      // model emitted non-whitespace text — i.e. ALL of its output was natural-language prose
      // that looksLikeProse dropped (it "wrote a plan / narrated a change" but ran nothing and
      // saved nothing). Returning clean `done` here silently discards the whole turn. Re-prompt
      // ONCE; if the very next cycle is prose again, surface `error` (loud) instead of a false
      // completion. `everRanStatement` keeps this from firing on a turn that did real work and
      // then signed off in prose (that legitimately reaches `done`). A genuinely-empty response
      // (no prose either) is a real "done" and falls through untouched.
      const allDroppedProse = !everRanStatement && assistantContent.trim() !== '';
      if (allDroppedProse && droppedProseNudges < 1) {
        droppedProseNudges++;
        renderHost.log(`[turn ${attempt}] entire response was dropped prose — nudging for real statements`);
        tracer.write({ ts: Date.now(), type: 'turn_end', context: ctx, ...(nodeId ? { nodeId } : {}), reason: 'dropped_prose_nudge' });
        history.append({ role: 'user', content: DROPPED_PROSE_NUDGE, blockType: 'normal' });
        attempt = 0;
        continue;
      }
      if (allDroppedProse) {
        renderHost.log(`[turn ${attempt}] all output was dropped prose after a nudge — failing loud (nothing ran or was saved)`);
        tracer.write({ ts: Date.now(), type: 'turn_end', context: ctx, ...(nodeId ? { nodeId } : {}), reason: 'dropped_prose_error' });
        return 'error';
      }
      // Broadened anti-silent guard: real work ran in an EARLIER cycle (everRanStatement)
      // but the turn is settling here having shown the user nothing. Nudge once, then fail.
      const nsVerdict = noVisibleOutputVerdict();
      if (nsVerdict === 'nudge') {
        noOutputNudges++;
        renderHost.log(`[turn ${attempt}] did work but showed the user nothing — nudging for display()`);
        tracer.write({ ts: Date.now(), type: 'turn_end', context: ctx, ...(nodeId ? { nodeId } : {}), reason: 'no_output_nudge' });
        history.append({ role: 'user', content: NO_OUTPUT_NUDGE, blockType: 'normal' });
        attempt = 0;
        continue;
      }
      if (nsVerdict === 'fail') {
        renderHost.log(`[turn ${attempt}] did work but produced no user-visible output after a nudge — failing loud`);
        tracer.write({ ts: Date.now(), type: 'turn_end', context: ctx, ...(nodeId ? { nodeId } : {}), reason: 'no_output_error' });
        return 'error';
      }
      renderHost.log(`[turn ${attempt}] model produced no statements — done`);
      tracer.write({ ts: Date.now(), type: 'turn_end', context: ctx, ...(nodeId ? { nodeId } : {}), reason: 'no_statements' });
      return 'done';
    }

    // The model ended its response with no pending yield. If its last clean
    // statement was a non-yielding `await`-binding, it most likely stopped to
    // "see" a result the runtime never surfaces (e.g. writeTaskFile) — which
    // would strand a multi-step program. Re-prompt it to continue, bounded so a
    // genuinely-finished model (which emits no further statements → no_statements
    // → done) and a model that keeps binding without progressing both terminate.
    if (lastStmtNonYieldBinding && continueNudges < maxContinueNudges) {
      continueNudges++;
      renderHost.log(`[turn ${attempt}] ended on a non-yielding binding — nudging to continue (${continueNudges}/${maxContinueNudges})`);
      tracer.write({ ts: Date.now(), type: 'turn_end', context: ctx, ...(nodeId ? { nodeId } : {}), reason: 'continue' });
      history.append({ role: 'user', content: CONTINUATION_NUDGE, blockType: 'normal' });
      attempt = 0;
      continue;
    }

    // Broadened anti-silent guard (main done path): an interactive turn that ran real work
    // but is about to settle 'done' having emitted neither display() nor ask() showed the
    // user nothing — nudge once, then fail loud rather than return a blank reply.
    const doneVerdict = noVisibleOutputVerdict();
    if (doneVerdict === 'nudge') {
      noOutputNudges++;
      renderHost.log(`[turn ${attempt}] did work but showed the user nothing — nudging for display()`);
      tracer.write({ ts: Date.now(), type: 'turn_end', context: ctx, ...(nodeId ? { nodeId } : {}), reason: 'no_output_nudge' });
      history.append({ role: 'user', content: NO_OUTPUT_NUDGE, blockType: 'normal' });
      attempt = 0;
      continue;
    }
    if (doneVerdict === 'fail') {
      renderHost.log(`[turn ${attempt}] did work but produced no user-visible output after a nudge — failing loud`);
      tracer.write({ ts: Date.now(), type: 'turn_end', context: ctx, ...(nodeId ? { nodeId } : {}), reason: 'no_output_error' });
      return 'error';
    }

    renderHost.log(`[turn ${attempt}] done`);
    tracer.write({ ts: Date.now(), type: 'turn_end', context: ctx, ...(nodeId ? { nodeId } : {}), reason: 'done' });
    return 'done';
  }

  tracer.write({ ts: Date.now(), type: 'turn_end', context: ctx, ...(nodeId ? { nodeId } : {}), reason: 'max_retries' });
  return 'error';
}
