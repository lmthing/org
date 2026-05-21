/**
 * First-omission grace for top-level await annotations.
 *
 * Spec contract L1861:
 *   On the FIRST occurrence of a top-level await without `as Type` in a session,
 *   instead of rejecting:
 *     1. Enter grace mode (skip speculative type-checking for this buffer).
 *     2. On resolve, derive a JSON-Schema-ish shape from the actual value.
 *     3. Inject a hint comment so the LLM learns the annotation form.
 *     4. Flip `meta.json.annotation_grace_used = true`.
 *   All subsequent omissions are `kind: "type"` errors.
 */

export type GraceCheckResult =
  | { kind: 'ok'; awaitedType: string }
  | { kind: 'grace' }
  | { kind: 'error'; message: string };

/**
 * Per-session annotation grace tracker. Create one instance per session.
 */
export class AnnotationGrace {
  private _used = false;

  get used(): boolean {
    return this._used;
  }

  /**
   * Called when a top-level await is encountered.
   *
   * @param annotatedType The `as Type` annotation text, or `null` if absent.
   */
  check(annotatedType: string | null): GraceCheckResult {
    if (annotatedType !== null) {
      return { kind: 'ok', awaitedType: annotatedType };
    }

    if (!this._used) {
      this._used = true;
      return { kind: 'grace' };
    }

    return {
      kind: 'error',
      message:
        'Missing type annotation on top-level await. ' +
        'Add `as YourType` after the awaited expression to enable speculative execution. ' +
        'Example: `const result = await fetchData() as ResponseType`',
    };
  }

  reset(): void {
    this._used = false;
  }
}

// ── Shape derivation ──────────────────────────────────────────────────────────

/**
 * Derive a TypeScript type string from a runtime value.
 * Used during grace-mode resolution to inject a hint annotation.
 */
export function deriveTypeShape(value: unknown, depth = 0): string {
  if (depth > 3) return 'unknown';

  if (value === null) return 'null';
  if (value === undefined) return 'undefined';

  switch (typeof value) {
    case 'boolean': return 'boolean';
    case 'number': return 'number';
    case 'string': return 'string';
    case 'bigint': return 'bigint';
    case 'function': return '(...args: unknown[]) => unknown';
    case 'symbol': return 'symbol';
    case 'object': {
      if (Array.isArray(value)) {
        if (value.length === 0) return 'unknown[]';
        const elem = deriveTypeShape(value[0], depth + 1);
        return `${elem}[]`;
      }
      const rec = value as Record<string, unknown>;
      const keys = Object.keys(rec).slice(0, 12);
      if (keys.length === 0) return 'Record<string, unknown>';
      const fields = keys.map((k) => {
        const safe = /^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(k) ? k : JSON.stringify(k);
        return `${safe}: ${deriveTypeShape(rec[k], depth + 1)}`;
      });
      return `{ ${fields.join('; ')} }`;
    }
    default:
      return 'unknown';
  }
}

/**
 * Build the hint comment injected after a grace-mode resolve.
 */
export function buildGraceHint(derivedShape: string): string {
  return [
    '// ⚠ annotation_grace: first unannotated await — speculative checking skipped.',
    `// Resolved type: ${derivedShape}`,
    `// Next time, annotate: const result = await expr as ${derivedShape}`,
  ].join('\n');
}
