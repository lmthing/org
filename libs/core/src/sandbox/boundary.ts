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
      const firstText = buf.slice(0, first.end).trim();
      // Prose guard FIRST: its whole reason to exist is an error-flagged head (the
      // bare identifier carved out of an apostrophe prose line), so the completeness
      // gates below must not run ahead of it and hold the line.
      if (/^[A-Za-z_$][\w$]*$/.test(firstText)) {
        const nl = buf.indexOf('\n');
        if (nl === -1) return null;
        return buf.slice(0, nl);
      }
      // The head statement must then pass the SAME error-token gate as the
      // single-statement branch below. That a further statement follows proves the
      // stream continued — it does NOT prove the head itself is whole: a garbage
      // fragment (` = readProjectFile(item.path);`) parses statement-shaped after the
      // parser skips its stray token, and without this gate it was emitted as a
      // "statement" the moment any second statement shared its chunk. A head HELD here
      // (e.g. a leaked `</think>` glued to real code behind it) still reaches the turn
      // loop through flush(), whose sanitizer neutralizes a pure-markup LEADING line
      // and keeps the code — so holding never strands a binding.
      if (hasMissingOrErrorTokens(first) || isConstWithoutInitializer(first)) return null;
      return buf.slice(0, first.end);
    }

    // Single statement: check if it's complete
    const stmt = sf.statements[0]!;

    // Must reach a proper ending
    const stmtText = buf.slice(0, stmt.end);
    const lastChar = stmtText.trimEnd().slice(-1);
    const endsWithSemiOrBrace = lastChar === ';' || lastChar === '}';
    if (!endsWithSemiOrBrace) return null;

    // Check for error / synthetic / missing tokens — and the other incompleteness
    // shapes a syntactically clean parse can still hide.
    if (
      hasMissingOrErrorTokens(stmt) ||
      parsedPastSkippedText(sf, stmt) ||
      isConstWithoutInitializer(stmt)
    ) {
      return null;
    }

    // Ignore leading whitespace from the full buffer
    void leadingWs; // used implicitly via buf above

    return buf.slice(0, stmt.end);
  }
}

/**
 * True when the statement was parsed past SKIPPED source text: a parse diagnostic that
 * starts BEFORE the statement's first token can only target characters the parser threw
 * away to make the statement parse — the head is a fragment
 * (` = readProjectFile(item.path);` parses as a clean expression statement after the
 * stray `=` is skipped, with no missing tokens of its own). Only the parse diagnostics
 * record skipped tokens; the node walk in hasMissingOrErrorTokens cannot see them.
 *
 * Deliberately run on the single-statement branch too: a fragment head there is exactly
 * as unemittable, and for the live-streaming case the diagnostic of a still-incomplete
 * TAIL always sits beyond stmt.end, so a complete head is never held because of what
 * follows it.
 */
function parsedPastSkippedText(sf: ts.SourceFile, stmt: ts.Statement): boolean {
  const firstToken = stmt.getStart(sf);
  const parseDiagnostics = (sf as unknown as { parseDiagnostics: ts.Diagnostic[] }).parseDiagnostics;
  return parseDiagnostics.some((d) => (d.start ?? 0) < firstToken);
}

/**
 * A `const` declaration with an initializer-less declarator is never a complete
 * statement — TS requires every const declarator to be initialized — so a parse that
 * ACCEPTS one can only mean the stream cut mid-declaration: `const f: { … }` is the
 * grammatical no-init PREFIX of `const f: { … } = item;` (destructuring is always
 * initializer-requiring and is covered by the same check). Emitting it fails typecheck
 * ("'const' declarations must be initialized"), the declaring statement never commits to
 * the session context, and every later reference dies with "Cannot find name 'f'".
 * Hold until the `=` and its initializer arrive; a genuinely truncated FINAL statement
 * still surfaces through flush(), where the typecheck failure names the real problem for
 * the model. `let`/`var` declarations without an initializer ARE genuine complete
 * statements and still emit (e.g. `let w: { ok: boolean; error?: string };`).
 */
function isConstWithoutInitializer(stmt: ts.Statement): boolean {
  if (!ts.isVariableStatement(stmt)) return false;
  if ((stmt.declarationList.flags & NodeFlags.Const) === 0) return false;
  return stmt.declarationList.declarations.some((d) => !d.initializer);
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
