/**
 * Speculative execution buffer.
 *
 * When a top-level `await` is encountered, subsequent statements are buffered
 * rather than executed immediately (because the runtime is suspended waiting
 * for the Promise). Each buffered statement is structurally type-checked
 * against the annotated awaited type.
 *
 * Stack-based: nested `await` expressions each open their own frame; a
 * type mismatch only discards the innermost buffer.
 *
 * Spec ref: L1500–1514.
 */
import ts from 'typescript';

export interface BufferedStatement {
  source: string;
  /** Transpiled JS from tsc-runner (available if type-check passed). */
  js: string;
  typeCheckOk: boolean;
}

export interface SpeculativeOk {
  kind: 'ok';
  statements: BufferedStatement[];
}

export interface SpeculativeMismatch {
  kind: 'mismatch';
  awaitedType: string;
  actualType: string;
  /** Formatted `__speculative_nudge` section for context reconstruction. */
  nudge: string;
  discarded: BufferedStatement[];
}

export interface SpeculativeOverflow {
  kind: 'overflow';
  /** Formatted `__speculative_pending` section for context reconstruction. */
  pending: string;
  buffered: BufferedStatement[];
}

export type SpeculativeFlushResult =
  | SpeculativeOk
  | SpeculativeMismatch
  | SpeculativeOverflow;

export interface SpeculativeConfig {
  /** Token cap per frame. Default: 2048. */
  maxTokens?: number;
}

/**
 * Manages speculative statement buffering during top-level await.
 */
export class SpeculativeBuffer {
  private stack: Frame[] = [];
  private readonly maxTokens: number;

  constructor(config: SpeculativeConfig = {}) {
    this.maxTokens = config.maxTokens ?? 2048;
  }

  get active(): boolean {
    return this.stack.length > 0;
  }

  get depth(): number {
    return this.stack.length;
  }

  /**
   * Open a new speculative frame when a top-level await is encountered.
   * `awaitedType` is the type annotation from `await expr as Type`;
   * pass `null` if there was no `as` annotation.
   */
  openFrame(awaitedType: string | null): void {
    this.stack.push({ awaitedType, tokens: 0, statements: [] });
  }

  /**
   * Buffer a statement. Must be called between `openFrame` and `flush`/`abortFrame`.
   * Returns `SpeculativeOverflow` if the token budget is exceeded (caller should
   * abort the LLM stream), or `null` if the statement was buffered successfully.
   */
  feed(stmt: BufferedStatement): SpeculativeOverflow | null {
    const frame = this.currentFrame();
    if (!frame) throw new Error('No open speculative frame');

    const estimate = Math.ceil(stmt.source.length / 4);
    if (frame.tokens + estimate >= this.maxTokens) {
      const overflow: SpeculativeOverflow = {
        kind: 'overflow',
        pending: buildPendingSection(frame.statements),
        buffered: [...frame.statements],
      };
      return overflow;
    }

    frame.tokens += estimate;
    frame.statements.push(stmt);
    return null;
  }

  /**
   * Called when the awaited Promise resolves.
   * `actualType` is the inferred type of the resolved value.
   *
   * Pops the innermost frame and checks structural assignability.
   */
  flush(actualType: string): SpeculativeFlushResult {
    const frame = this.stack.pop();
    if (!frame) return { kind: 'ok', statements: [] };

    if (frame.awaitedType !== null) {
      const assignable = isStructurallyAssignable(actualType, frame.awaitedType);
      if (!assignable) {
        return {
          kind: 'mismatch',
          awaitedType: frame.awaitedType,
          actualType,
          nudge: buildNudgeSection(frame.awaitedType, actualType, frame.statements.length),
          discarded: frame.statements,
        };
      }
    }

    return { kind: 'ok', statements: frame.statements };
  }

  /**
   * Discard the innermost frame without executing its statements.
   */
  abortFrame(): void {
    this.stack.pop();
  }

  private currentFrame(): Frame | null {
    return this.stack.length > 0 ? this.stack[this.stack.length - 1]! : null;
  }
}

// ── AST helpers ───────────────────────────────────────────────────────────────

/**
 * Scan a statement for a top-level await expression.
 * Returns:
 *   - `string`    — the `as Type` annotation text if present
 *   - `null`      — top-level await without annotation
 *   - `undefined` — statement does not contain a top-level await
 */
export function extractAwaitAnnotation(statement: string): string | null | undefined {
  const sf = ts.createSourceFile(
    '_spec.ts',
    statement,
    ts.ScriptTarget.ESNext,
    false,
    ts.ScriptKind.TS,
  );

  for (const stmt of sf.statements) {
    const result = findAwaitAnnotation(stmt, sf);
    if (result !== undefined) return result;
  }

  return undefined;
}

/** Returns true if the statement contains a top-level await. */
export function hasTopLevelAwait(statement: string): boolean {
  return extractAwaitAnnotation(statement) !== undefined;
}

// ── Internal ──────────────────────────────────────────────────────────────────

interface Frame {
  awaitedType: string | null;
  tokens: number;
  statements: BufferedStatement[];
}

function findAwaitAnnotation(
  node: ts.Node,
  sf: ts.SourceFile,
): string | null | undefined {
  if (ts.isVariableStatement(node)) {
    for (const decl of node.declarationList.declarations) {
      const init = decl.initializer;
      if (!init) continue;

      if (ts.isAsExpression(init) && ts.isAwaitExpression(init.expression)) {
        return init.type.getText(sf);
      }
      if (ts.isAwaitExpression(init)) {
        return null;
      }
    }
  }

  if (ts.isExpressionStatement(node)) {
    const expr = node.expression;
    if (ts.isAsExpression(expr) && ts.isAwaitExpression(expr.expression)) {
      return expr.type.getText(sf);
    }
    if (ts.isAwaitExpression(expr)) {
      return null;
    }
  }

  return undefined;
}

/**
 * Coarse structural assignability check using the TypeScript compiler.
 * Creates a tiny in-memory program that assigns `actual` to `target`;
 * zero semantic errors = assignable.
 *
 * Note: `transpileModule` does NOT type-check — we must use `createProgram`.
 */
function isStructurallyAssignable(actualType: string, targetType: string): boolean {
  if (actualType === targetType) return true;
  if (targetType === 'any' || targetType === 'unknown') return true;

  const safe = (t: string) => t.replace(/`/g, "'");
  const snippet = `type _T = ${safe(targetType)};\ntype _A = ${safe(actualType)};\ndeclare const _v: _A;\nconst _c: _T = _v;\n`;

  const opts: ts.CompilerOptions = {
    strict: true,
    noEmit: true,
    target: ts.ScriptTarget.ES2022,
    skipLibCheck: true,
  };

  const defaultHost = ts.createCompilerHost(opts);
  const host: ts.CompilerHost = {
    ...defaultHost,
    getSourceFile(fileName, lang) {
      if (fileName === '_assignability.ts') {
        return ts.createSourceFile(fileName, snippet, lang);
      }
      return defaultHost.getSourceFile(fileName, lang);
    },
    fileExists(f) { return f === '_assignability.ts' || defaultHost.fileExists(f); },
    readFile(f) { return f === '_assignability.ts' ? snippet : defaultHost.readFile(f); },
    writeFile() {},
  };

  const program = ts.createProgram(['_assignability.ts'], opts, host);
  const sf = program.getSourceFile('_assignability.ts')!;
  const semanticDiags = program.getSemanticDiagnostics(sf);
  return semanticDiags.length === 0;
}

function buildNudgeSection(
  awaitedType: string,
  actualType: string,
  discardedCount: number,
): string {
  return [
    '// __speculative_nudge',
    `// Awaited value resolved as \`${actualType}\`, expected \`${awaitedType}\`.`,
    `// ${discardedCount} buffered statement(s) discarded.`,
    '// Call inspect(__resolved) to continue with the actual resolved value.',
  ].join('\n');
}

function buildPendingSection(buffered: BufferedStatement[]): string {
  return [
    '// __speculative_pending',
    `// Speculative buffer overflowed with ${buffered.length} statement(s) pending.`,
    '// Execution paused — awaiting top-level Promise resolution.',
  ].join('\n');
}
