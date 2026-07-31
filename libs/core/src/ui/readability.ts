/**
 * Is what the agent displayed something a person can READ, or is it the working
 * material the agent used to find the answer?
 *
 * The anti-silent-turn guard (`eval/turn-loop.ts`) has always asked "did the turn
 * call `display()`?". That is not the same question as "can the person who asked
 * read the reply", and the gap is where a whole class of defect lives. The
 * specimen, from a live team channel (22-crossfire run 2 step 3): Rae asked how to
 * track the lift-out fee, and the ENTIRE turn was
 *
 *   const tables = db.tables();
 *   const pages = listProjectDir('pages');
 *   const api = listProjectDir('api');
 *   // Let me inspect the existing project tables and pages to understand what we have.
 *   display(<Stack>
 *     <Heading>Current project state</Heading>
 *     <Paragraph>The project has these tables: {JSON.stringify(tables)}</Paragraph>
 *     …
 *   </Stack>);
 *
 * `display()` used as a debug print — and because it fired, the guard was satisfied
 * and the turn settled `done`. In `/chat` that is noise beside the conversation. In
 * a team channel the last display IS the message: it went to `#office` under THING's
 * name, stamped with `mentions`, and pushed to phones.
 *
 * THING's instructions already forbid this precisely — *"a table list, a directory
 * listing, or an endpoint-name list is a MEANS to find the real name to act on next,
 * never the finished reply"* — and it happened anyway, which is why this is code and
 * not another paragraph of prose.
 *
 * ## What counts as readable
 *
 * Strip the machine literals (fenced code, parseable JSON structures, source lines),
 * then drop the labels those literals hung off — a line ending in `:` whose content
 * has just been removed was a caption for the dump, not a sentence. Whatever survives
 * has to contain at least one line that reads like language.
 *
 * The point of stripping FIRST is that an answer which legitimately quotes a table
 * alongside real prose keeps its prose and passes. Only a message that is *nothing
 * but* machine output fails.
 *
 * ## This is a heuristic, and it is used accordingly
 *
 * It cannot be exact — "readable" is not a decidable property — so the consumer never
 * fails a turn on it. A negative verdict buys exactly one nudge ("that is what you
 * used to find the answer; now answer the person") and then the turn is accepted
 * whatever comes back. The neighbouring case — displayed NOTHING — keeps its
 * fail-loud behaviour, because there the runtime is certain.
 *
 * That asymmetry is deliberate: `display(someTable)` at the end of a `/chat` turn is
 * legal today, renders as a data blob beside the conversation, and must stay legal.
 *
 * Browser-safe (no Node imports), like its neighbour `descriptor.ts`.
 */

import { descriptorToText, isJsxDescriptor } from './descriptor.js';

/** A fenced code block, however it is tagged. */
const FENCE = /```[\s\S]*?```/g;

/** Lines that are source code rather than language. Deliberately narrow: these are the
 *  shapes seen posting whole generated modules into a channel as "the answer". */
const CODE_LINE =
  /(^|\s)(import\s|export\s+(const|type|default|async)\s|function\s+\w+\s*\(|=>\s*\{|await\s+ctx\.|throw\s+new\s+\w*Error)/;

/**
 * Remove every balanced JSON object/array literal that actually parses.
 *
 * Scans for an opening brace/bracket and walks to its match (respecting string
 * literals and escapes, so a `}` inside `"a}b"` does not close the span). A span is
 * removed only when `JSON.parse` accepts it and it is long enough to be a real
 * serialization rather than an `{}` in prose — the output of `JSON.stringify(...)`,
 * which is what `db.tables()` and `listProjectDir()` dumps look like by the time they
 * reach a person.
 */
function stripJsonLiterals(text: string): string {
  let out = '';
  let i = 0;
  while (i < text.length) {
    const ch = text[i]!;
    if (ch !== '{' && ch !== '[') {
      out += ch;
      i++;
      continue;
    }
    const end = matchBalanced(text, i);
    if (end < 0) {
      out += ch;
      i++;
      continue;
    }
    const span = text.slice(i, end + 1);
    if (span.length >= 8 && parses(span)) {
      i = end + 1; // drop it
      continue;
    }
    out += ch;
    i++;
  }
  return out;
}

/** Index of the brace/bracket closing the one at `start`, or -1. String-aware. */
function matchBalanced(text: string, start: number): number {
  const open = text[start]!;
  const close = open === '{' ? '}' : ']';
  let depth = 0;
  let inString = false;
  for (let i = start; i < text.length; i++) {
    const c = text[i]!;
    if (inString) {
      if (c === '\\') i++;
      else if (c === '"') inString = false;
      continue;
    }
    if (c === '"') inString = true;
    else if (c === open) depth++;
    else if (c === close) {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

function parses(span: string): boolean {
  try {
    const v: unknown = JSON.parse(span);
    return typeof v === 'object' && v !== null;
  } catch {
    return false;
  }
}

/**
 * Words, counting only tokens that could be language.
 *
 * A token carrying an internal `-` or `_` is an identifier, not a word: that is what
 * a route or table listing is made of (`press-checks-create`, `press_checks`), and
 * splitting on the hyphen would score such a listing as a five-word sentence — which
 * it did, on `job-status jobs-get jobs-list press-checks-create statuses`, until this
 * was narrowed.
 *
 * The cost is that a genuinely hyphenated English word ("lift-out", "heads-up") does
 * not count toward the total. That is the right trade: prose carries a handful of
 * them among ordinary words, so the sentence still clears the bar, whereas an
 * identifier list is made of nothing else and now scores near zero.
 */
function wordCount(line: string): number {
  const tokens = line.match(/[\p{L}\p{N}'’_-]+/gu);
  if (!tokens) return 0;
  return tokens.filter((t) => /[\p{L}]/u.test(t) && !/[\p{L}\p{N}][-_][\p{L}\p{N}]/u.test(t)).length;
}

/**
 * Does this line read like language?
 *
 * Either it ends like a sentence (with enough words to be one), or it is long enough
 * that no plausible label or column header reaches it. Five words is the threshold
 * because it clears the specimens — *"Current project state"*, *"API routes:"* — while
 * admitting the short bullets a real answer is often made of (*"Marisol — waiting on
 * parts"* is four, and is caught by the punctuation-free length rule only at five, so
 * bullets shorter than that rely on the turn's other lines; that is the intended bias,
 * since the cost of a false negative here is one nudge).
 */
function readsLikeLanguage(line: string): boolean {
  const t = line.trim();
  if (!t) return false;
  const words = wordCount(t);
  if (/[.!?][)"'’”]?$/.test(t) && words >= 3) return true;
  return words >= 5;
}

/**
 * True when the displayed value carries prose a person can act on.
 *
 * A non-descriptor object or array — `display(someTable)`, `display(rows)` — is
 * working material by definition: it has no text of its own, so there is nothing to
 * read. A bare string or a JSX descriptor is judged on what survives stripping.
 */
export function hasReadableProse(value: unknown): boolean {
  const text = typeof value === 'string' ? value : isJsxDescriptor(value) ? descriptorToText(value) : '';
  if (!text.trim()) return false;

  const stripped = stripJsonLiterals(text.replace(FENCE, '\n'));

  for (const raw of stripped.split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    if (CODE_LINE.test(line)) continue;
    // A label whose material was just stripped ("The project has these tables:") is a
    // caption for the dump, not a sentence. A colon-terminated line that still has its
    // content is unaffected, because the content is on the same line and counted.
    if (line.endsWith(':')) continue;
    if (readsLikeLanguage(line)) return true;
  }
  return false;
}
