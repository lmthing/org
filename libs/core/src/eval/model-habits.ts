/**
 * Model output habits — the ONE place that neutralizes NON-code artifacts a model
 * leaks into the statement stream, applied to each raw statement BEFORE typecheck so a
 * known habit never burns a typecheck-error retry.
 *
 * The model writes TypeScript one statement at a time; anything that is not valid TS
 * fails typecheck and costs a whole turn. Some models have consistent, harmless
 * habits — a leaked reasoning tag, a stray chat/harmony control token — that are pure
 * noise, never intent. Rather than special-casing a provider inside the turn loop,
 * every habit is one entry in {@link MODEL_HABITS}: a cheap matcher plus a rewrite.
 * Add a new model habit here — never as a branch in the turn loop.
 *
 * This is a sibling of `looksLikeProse` / `FenceLineFilter` in `turn-loop.ts`, which
 * neutralize the two OTHER provider-agnostic habits (narrated prose, markdown fences).
 * Difference: those DROP or STRIP; a habit here REWRITES the statement — it comments
 * the artifact out — so the neutralization stays visible in the trace/history instead
 * of vanishing. Applied at the single per-statement choke point in the turn loop (the
 * `sanitize` closure in `runTurnLoop`).
 *
 * Safety invariant every habit upholds: **only rewrite a region that STRIPS TO NOTHING
 * but the artifact.** {@link commentIfPureMarkup} enforces it — the whole statement is
 * commented out when stripping the markup leaves only whitespace, and when the artifact
 * is confined to complete LEADING lines of an otherwise-real statement just those lines
 * are commented (a trailing artifact glued to code — `display("</think>")`, or a tag on
 * the same line as code — never matches, so those statements are returned untouched).
 * Real code is never corrupted; the worst case is a no-op comment on a line that was
 * pure noise anyway.
 */

/**
 * One model output habit: detect it cheaply with {@link matches}, then rewrite the
 * statement with {@link clean} to neutralize it. `clean` returns the statement
 * unchanged when it decides NOT to act — callers detect a real change by string
 * identity (`next !== stmt`), so a rewrite that is a genuine no-op MUST return the same
 * reference it was given.
 */
export interface ModelHabit {
  /** Diagnostic name, surfaced in the turn-loop log when the habit fires. */
  readonly name: string;
  /** Cheap pre-check: could this statement exhibit the habit? */
  matches(stmt: string): boolean;
  /** Rewrite the statement to neutralize the habit (or return it unchanged). */
  clean(stmt: string): string;
}

/** Comment out every non-blank line of a statement. Blank lines are preserved so the
 *  line count (and any diagnostic line numbers computed off it) does not move. The
 *  result is a valid no-op that still shows the artifact in the trace/history rather
 *  than deleting it. */
function commentOut(stmt: string): string {
  return stmt
    .split('\n')
    .map((line) => (line.trim() === '' ? line : `// ${line}`))
    .join('\n');
}

/**
 * Neutralize markup in a statement that is REAL CODE PLUS ARTIFACT:
 *
 *  - Nothing but markup → comment the WHOLE statement out (the original behavior).
 *  - Markup confined to complete LEADING lines, real code after → comment just those
 *    lines and keep the rest verbatim. This shape arrives when the boundary detector
 *    HELD a buffer whose head is an error artifact (e.g. a leaked `</think>` the parser
 *    cannot split from the statement behind it) and surfaced the whole thing through
 *    flush(): without the leading-line rewrite the code behind the tag would die in
 *    typecheck and burn the exact retry this module exists to save.
 *
 * Safety invariant, upheld in both cases: only a region that STRIPS TO NOTHING is ever
 * rewritten (commented) — surviving code is never modified, only preserved. A tag that
 * merely appears inside or after real code (`display("</think>")`, `foo(); // <think>`)
 * is not an artifact-only prefix and is left untouched.
 */
function neutralizeMarkup(strip: (s: string) => string, stmt: string): string {
  if (strip(stmt).trim() === '') return commentOut(stmt);
  let idx = -1;
  while ((idx = stmt.indexOf('\n', idx + 1)) !== -1) {
    const prefix = stmt.slice(0, idx + 1);
    if (strip(prefix).trim() === '') {
      return (
        prefix.split('\n').map((line) => (line.trim() === '' ? line : `// ${line}`)).join('\n') +
        stmt.slice(idx + 1)
      );
    }
  }
  return stmt;
}

/** Build a `clean` from a markup-stripping function. See neutralizeMarkup. */
function commentIfPureMarkup(strip: (s: string) => string): (stmt: string) => string {
  return (stmt) => neutralizeMarkup(strip, stmt);
}

// ---------------------------------------------------------------------------
// Habit 1 — reasoning tags
// ---------------------------------------------------------------------------

/** Tag names chain-of-thought models wrap their private reasoning in. Kept to names
 *  that are unambiguously "thinking" markers (never common HTML/JSX elements), so the
 *  pure-markup guard is the only thing standing between us and real code anyway. */
const REASONING_TAG_NAMES = [
  'think', 'thinking', 'thought', 'reason', 'reasoning',
  'reflection', 'scratchpad', 'analysis', 'monologue', 'antthinking',
];
const REASONING_NAME_ALT = REASONING_TAG_NAMES.join('|');
/** A single reasoning tag, opening or closing: `<think>`, `</think>`, `<thinking …>`. */
const REASONING_TAG = new RegExp(String.raw`<\/?(?:${REASONING_NAME_ALT})\b[^>]*>`, 'i');
/** A whole reasoning block `<think>…</think>` (non-greedy, spans newlines, matched
 *  name closed by its own name via a backreference). */
const REASONING_BLOCK = new RegExp(
  String.raw`<(${REASONING_NAME_ALT})\b[^>]*>[\s\S]*?<\/\1\s*>`,
  'gi',
);

/** Strip reasoning markup: whole blocks first, then any stray tag left over. */
function stripReasoning(stmt: string): string {
  return stmt
    .replace(REASONING_BLOCK, '')
    .replace(new RegExp(REASONING_TAG.source, 'gi'), '');
}

/**
 * Chain-of-thought reasoning tags. DeepSeek / Kimi / … wrap their reasoning in
 * `<think>…</think>` (other models use `<thinking>`, `<reasoning>`, `<reflection>`,
 * …). The SDK routes most of it to a reasoning part, but a stray closing `</think>`
 * (or, rarely, a whole block emitted as text) leaks into the text stream, and the
 * boundary detector carves it into its OWN statement AHEAD of the first real one
 * (verified: `</think>\nconst x = 1` splits into `</think>` + `const x = 1`; a whole
 * `<think>…</think>` block arrives as one statement). That lone artifact is a
 * guaranteed typecheck error ("Cannot find name 'think'") that wastes a turn before
 * the model recovers. Comment it out so it is a harmless no-op that still typechecks.
 */
const REASONING_TAGS: ModelHabit = {
  name: 'reasoning-tags',
  matches: (stmt) => REASONING_TAG.test(stmt),
  clean: commentIfPureMarkup(stripReasoning),
};

// ---------------------------------------------------------------------------
// Habit 2 — chat / harmony control tokens
// ---------------------------------------------------------------------------

/** A chat-template / harmony control token: `<|im_start|>`, `<|im_end|>`, `<|end|>`,
 *  `<|channel|>`, `<|message|>`, `<|assistant|>`, … These are special tokens the model
 *  should never emit as text, but a lone one occasionally leaks (ChatML, GPT-harmony,
 *  Qwen). `<\|` never begins a valid TS statement, so a statement that is nothing but
 *  control tokens is pure noise. */
const CONTROL_TOKEN = /<\|[^|>]*\|>/;

function stripControlTokens(stmt: string): string {
  return stmt.replace(new RegExp(CONTROL_TOKEN.source, 'g'), '');
}

const CONTROL_TOKENS: ModelHabit = {
  name: 'control-tokens',
  matches: (stmt) => CONTROL_TOKEN.test(stmt),
  clean: commentIfPureMarkup(stripControlTokens),
};

// ---------------------------------------------------------------------------

/** All known model output habits, applied in registration order. Add a new one here. */
export const MODEL_HABITS: readonly ModelHabit[] = [REASONING_TAGS, CONTROL_TOKENS];

/**
 * Apply every model habit to one raw statement. Returns the (possibly rewritten) text
 * plus the names of the habits that actually changed it, so the turn loop can log which
 * habit fired. A statement no habit touches is returned verbatim.
 */
export function sanitizeModelHabits(stmt: string): { text: string; applied: string[] } {
  let text = stmt;
  const applied: string[] = [];
  for (const habit of MODEL_HABITS) {
    if (!habit.matches(text)) continue;
    const next = habit.clean(text);
    if (next !== text) {
      applied.push(habit.name);
      text = next;
    }
  }
  return { text, applied };
}
