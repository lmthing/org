/**
 * 3-retry type-check loop.
 *
 * On each failure, error messages are injected as `// tsc: <msg>` comments
 * above the offending line and the statement is re-checked. This gives the
 * downstream (LLM correction loop) inline context about what went wrong.
 *
 * Per spec contract "Append timing" (L1850): callers must NOT append to
 * session.ts until `ok: true` is returned.
 */
import { runTsc, type TscResult, type TscRunnerOptions } from './tsc-runner.js';

export interface RetryResult {
  ok: boolean;
  attempts: number;
  /** Final transpiled JS (from the last successful or last attempt). */
  js: string;
  inferredBindings: TscResult['inferredBindings'];
  /** Diagnostics from the final attempt (empty on success). */
  finalDiagnostics: TscResult['diagnostics'];
  /** Statement text as it was on the final attempt (may have // tsc: comments). */
  finalStatement: string;
}

const MAX_RETRIES = 3;

export function runTscWithRetry(
  statement: string,
  opts: TscRunnerOptions = {},
): RetryResult {
  let current = statement;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    const result = runTsc(current, opts);

    if (result.ok) {
      return {
        ok: true,
        attempts: attempt,
        js: result.js,
        inferredBindings: result.inferredBindings,
        finalDiagnostics: [],
        finalStatement: current,
      };
    }

    if (attempt === MAX_RETRIES) {
      return {
        ok: false,
        attempts: attempt,
        js: result.js,
        inferredBindings: result.inferredBindings,
        finalDiagnostics: result.diagnostics,
        finalStatement: current,
      };
    }

    // Inject error comments for the next attempt
    current = injectDiagnosticComments(current, result.diagnostics);
  }

  // Unreachable
  throw new Error('unreachable');
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function injectDiagnosticComments(
  source: string,
  diagnostics: TscResult['diagnostics'],
): string {
  if (diagnostics.length === 0) return source;

  const lines = source.split('\n');

  // Group comments by the line they annotate (0-indexed within statement)
  const commentsByLine = new Map<number, string[]>();
  for (const d of diagnostics) {
    const lineIdx = Math.max(0, Math.min(d.line, lines.length - 1));
    const existing = commentsByLine.get(lineIdx) ?? [];
    const msg = d.message.replace(/\n/g, ' ').replace(/\s+/g, ' ').trim();
    existing.push(`// tsc(${d.code}): ${msg}`);
    commentsByLine.set(lineIdx, existing);
  }

  // Rebuild: insert comment lines before the annotated line
  const result: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const comments = commentsByLine.get(i);
    if (comments) result.push(...comments);
    result.push(lines[i]!);
  }

  return result.join('\n');
}
