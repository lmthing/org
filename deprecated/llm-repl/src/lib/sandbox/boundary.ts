/**
 * TypeScript parser-based boundary detector.
 *
 * Uses ts.createSourceFile to parse the accumulated buffer.
 * The TypeScript parser correctly handles:
 * - Template literals with ${} interpolation
 * - JSX elements
 * - Arrow functions
 * - Nested braces in expressions vs block statements
 *
 * We parse the full buffer each time a chunk arrives, then extract
 * complete statements (those whose `end` position is NOT the end of
 * the source file — meaning they are fully delimited and not the
 * last partial statement).
 */
import ts from 'typescript';

export interface BoundaryResult {
  complete: string[];
  remainder: string;
}

/**
 * Stateful incremental boundary detector.
 */
export class BoundaryDetector {
  private buffer = '';

  feed(chunk: string): string[] {
    this.buffer += chunk;
    return this._extract();
  }

  flush(): string | null {
    const remainder = this.buffer.trim();
    this.buffer = '';
    return remainder.length > 0 ? remainder : null;
  }

  reset(): void {
    this.buffer = '';
  }

  private _extract(): string[] {
    const complete: string[] = [];
    while (true) {
      const result = this._tryExtractOne(this.buffer);
      if (result === null) break;
      complete.push(result.statement);
      this.buffer = result.remaining;
    }
    return complete;
  }

  private _tryExtractOne(
    source: string,
  ): { statement: string; remaining: string } | null {
    if (!source.trim()) return null;

    // Parse the buffer using the TypeScript parser
    const sf = ts.createSourceFile(
      '_boundary.tsx',
      source,
      ts.ScriptTarget.ESNext,
      /* setParentNodes */ false,
      ts.ScriptKind.TSX,
    );

    if (sf.statements.length === 0) return null;

    // The parser may include a partial last statement (it fills in missing
    // tokens for error recovery). A statement is "complete" if its `end`
    // position is strictly less than the total source length AND it ends
    // at a real boundary (the parser did not synthesize tokens to close it).
    //
    // Heuristic: a statement is complete if either:
    // 1. There is a subsequent statement after it (meaning the parser saw
    //    a clear boundary), OR
    // 2. It is the only statement AND the source text at stmt.end does not
    //    leave the statement open (no parse errors that indicate missing tokens)
    //
    // The most reliable signal: if sf.statements.length >= 2, the first
    // statement is definitely complete. If there's only one statement, we
    // check if it ends before the last non-whitespace character of the source
    // (which would mean there's trailing content the parser didn't include
    // in the statement — shouldn't normally happen) OR if the statement
    // ends right at a semicolon or closing brace.

    const firstStmt = sf.statements[0];
    const stmtEnd = firstStmt.end;

    if (sf.statements.length >= 2) {
      // Definitely complete — there are more statements after it
      const statement = source.slice(0, stmtEnd).trimEnd();
      const remaining = source.slice(stmtEnd);
      return { statement, remaining };
    }

    // Only one statement — need to determine if it's complete.
    // Check: does the source after the statement contain only whitespace?
    // If yes AND the statement itself is well-formed, it's complete.
    //
    // Detect a complete single statement by checking if:
    // a) The source ends with a `;` or `}` (after trimming)
    //    and the parser has no "missing" tokens at the end.
    // b) The statement text itself ends at the same position as the source.

    const trimmed = source.trimEnd();
    const lastChar = trimmed[trimmed.length - 1];

    // Check for parse errors indicating the statement is incomplete
    // (the TS parser creates synthetic "missing" tokens for error recovery)
    const hasErrors = hasMissingTokens(firstStmt);

    if (hasErrors) {
      return null;
    }

    // Statement ends at the last char of source
    if (stmtEnd >= trimmed.length) {
      // The single statement fills the whole buffer
      // Only emit if it ends cleanly (with ; or } or is a complete expression)
      if (lastChar === ';' || lastChar === '}') {
        const statement = source.slice(0, stmtEnd).trimEnd();
        const remaining = source.slice(stmtEnd);
        if (statement.trim()) {
          return { statement, remaining };
        }
      }
    }

    return null;
  }
}

/**
 * Check if an AST node contains any "missing" synthetic tokens,
 * which the TypeScript parser inserts when it performs error recovery
 * for incomplete input.
 */
function hasMissingTokens(node: ts.Node): boolean {
  // Check if this is a synthetic missing token
  if (node.flags & ts.NodeFlags.ThisNodeHasError) return true;

  // For tokens, check if they are "missing" (no width)
  if (ts.isToken(node)) {
    const start = node.pos;
    const end = node.end;
    // Missing tokens have pos === end
    if (start === end && node.kind !== ts.SyntaxKind.EndOfFileToken) {
      // This is a synthetic missing token
      if (
        node.kind === ts.SyntaxKind.CloseBraceToken ||
        node.kind === ts.SyntaxKind.CloseBracketToken ||
        node.kind === ts.SyntaxKind.CloseParenToken ||
        node.kind === ts.SyntaxKind.SemicolonToken
      ) {
        return true;
      }
    }
  }

  return ts.forEachChild(node, hasMissingTokens) ?? false;
}
