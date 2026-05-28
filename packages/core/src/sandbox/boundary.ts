import ts from 'typescript';

const { ScriptTarget, ScriptKind, NodeFlags, SyntaxKind } = ts;

/**
 * BoundaryDetector accumulates streamed text and returns complete top-level
 * TypeScript/TSX statements as they become parseable.
 */
export class BoundaryDetector {
  private buffer = '';

  /**
   * Feed a chunk of text. Returns an array of complete statements extracted
   * from the front of the buffer.
   */
  feed(chunk: string): string[] {
    this.buffer += chunk;
    const complete: string[] = [];

    while (true) {
      const stmt = this.extractLeadingStatement(this.buffer);
      if (stmt === null) break;
      complete.push(stmt);
      this.buffer = this.buffer.slice(stmt.length).replace(/^\s*\n?/, '');
    }

    return complete;
  }

  /**
   * Return any trailing partial text that hasn't formed a complete statement yet.
   */
  flush(): string {
    return this.buffer;
  }

  /**
   * Clear internal buffer.
   */
  reset(): void {
    this.buffer = '';
  }

  private extractLeadingStatement(buf: string): string | null {
    const trimmed = buf.trimStart();
    if (trimmed.length === 0) return null;

    // Leading whitespace offset
    const leadingWs = buf.length - trimmed.length;

    const sf = ts.createSourceFile('_b.tsx', buf, ScriptTarget.ESNext, /*setParentNodes*/ true, ScriptKind.TSX);

    if (sf.statements.length === 0) return null;

    // If more than one statement parsed, the first one is complete
    if (sf.statements.length > 1) {
      const first = sf.statements[0]!;
      return buf.slice(0, first.end);
    }

    // Single statement: check if it's complete
    const stmt = sf.statements[0]!;

    // Must reach a proper ending
    const stmtText = buf.slice(0, stmt.end);
    const lastChar = stmtText.trimEnd().slice(-1);
    const endsWithSemiOrBrace = lastChar === ';' || lastChar === '}';
    if (!endsWithSemiOrBrace) return null;

    // Check for error / synthetic / missing tokens
    if (hasMissingOrErrorTokens(stmt)) return null;

    // Ignore leading whitespace from the full buffer
    void leadingWs; // used implicitly via buf above

    return buf.slice(0, stmt.end);
  }
}

/**
 * Walk the AST looking for missing tokens or error flags that indicate the
 * statement is incomplete.
 */
function hasMissingOrErrorTokens(node: ts.Node): boolean {
  if (node.flags & NodeFlags.ThisNodeHasError) return true;

  // Missing tokens are zero-width tokens at specific kinds
  if (isMissingToken(node)) return true;

  return node.getChildren().some((child) => hasMissingOrErrorTokens(child));
}

function isMissingToken(node: ts.Node): boolean {
  // Zero-width tokens that are not EOF and not whitespace/trivia
  const zeroWidth = node.end === node.pos;
  if (!zeroWidth) return false;

  const kind = node.kind;
  // These kinds can appear as zero-width and indicate a missing/synthetic token
  const missingKinds = new Set([
    SyntaxKind.MissingDeclaration,
    SyntaxKind.Identifier, // missing identifier placeholder
    SyntaxKind.SemicolonToken,
    SyntaxKind.CloseBraceToken,
    SyntaxKind.CloseParenToken,
    SyntaxKind.CloseBracketToken,
    SyntaxKind.EndOfFileToken, // only an issue when also zero-width in middle
  ]);

  return missingKinds.has(kind) && kind !== SyntaxKind.EndOfFileToken;
}
