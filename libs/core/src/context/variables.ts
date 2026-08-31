import ts from 'typescript';
import { serialize } from '../globals/serialize.js';

/** Rolling window (chars) for the ALREADY-EXECUTED echo. The full accumulated
 *  context re-embedded on every yield/retry is a QUADRATIC driver of history
 *  growth (the runaway-turn "Invalid string length" crash, and — for small
 *  models — silent context-window overflow). The model only needs the RECENT
 *  tail to "continue from there": the complete set of live bindings is on the
 *  SCOPE line (derived from the FULL context), and typecheck still runs against
 *  the full accumulatedContext host-side, so bounding this echo is purely a
 *  prompt-size cap with ZERO typecheck-correctness cost.
 *  Lives here (not error-rewind.ts) because error-rewind imports this module. */
export const ALREADY_EXECUTED_WINDOW_CHARS = 8_000;

/**
 * Bound the re-embedded ALREADY-EXECUTED context to the last {@link ALREADY_EXECUTED_WINDOW_CHARS}
 * characters, cut on a statement (newline) boundary, prefixed with an "N earlier statements
 * omitted" marker. The omitted statements are NOT lost to the model: their bound names are
 * listed on the SCOPE / "Still in scope" line (computed from the full context), and the VM +
 * host typecheck context still hold them. Always keeps at least the final statement even if
 * it alone exceeds the window. Exported for direct testing.
 */
export function boundAlreadyExecuted(scopeContext: string, windowChars = ALREADY_EXECUTED_WINDOW_CHARS): string {
  if (scopeContext.length <= windowChars) return scopeContext;
  const stmts = scopeContext.split('\n');
  const kept: string[] = [];
  let total = 0;
  for (let i = stmts.length - 1; i >= 0; i--) {
    const cost = stmts[i]!.length + 1; // + the joining newline
    if (kept.length > 0 && total + cost > windowChars) break;
    kept.unshift(stmts[i]!);
    total += cost;
  }
  const omitted = stmts.length - kept.length;
  if (omitted <= 0) return kept.join('\n');
  const marker = `// … ${omitted} earlier statement${omitted === 1 ? '' : 's'} omitted (still in scope — see the names listed above) …`;
  return marker + '\n' + kept.join('\n');
}

/**
 * The ALREADY-EXECUTED section (header + bounded echo) as a standalone block.
 * The turn loop stores the raw context on the history message and the prompt
 * builder appends THIS to only the latest VARIABLES block — every earlier
 * block's echo is superseded dead weight (see MessageHistory.getPromptMessages).
 */
export function formatAlreadyExecuted(scopeContext: string): string {
  return (
    'ALREADY EXECUTED (do not repeat any of these statements — write only what comes NEXT):\n' +
    boundAlreadyExecuted(scopeContext)
  );
}

/**
 * Format a VARIABLES block from a map of variable names to values.
 * When scopeContext is provided, also lists:
 *   - SCOPE: already-declared variable names (don't redeclare)
 *   - EXECUTED: the (bounded) accumulated context so the model knows what already ran.
 *     Pass `omitExecuted` to leave the echo out entirely — callers that store the
 *     context on the history message instead (turn loop) do this so the prompt
 *     builder can attach ONE echo to the latest block rather than one per yield.
 */
export function emitVariables(
  vars: Record<string, unknown>,
  scopeContext?: string,
  opts?: { omitExecuted?: boolean },
): string {
  const lines: string[] = ['VARIABLES'];
  for (const [name, value] of Object.entries(vars)) {
    lines.push(`${name}: ${serialize(value)}`);
  }

  if (scopeContext) {
    const alreadyDeclared = extractScopeNamesFromContext(scopeContext).filter((n) => !(n in vars));
    if (alreadyDeclared.length > 0) {
      lines.push('');
      lines.push(`SCOPE (already declared — do not redeclare): ${alreadyDeclared.join(', ')}`);
    }

    if (!opts?.omitExecuted) {
      lines.push('');
      lines.push(formatAlreadyExecuted(scopeContext));
    }
  }

  return lines.join('\n');
}

/**
 * Extract all simple variable binding names declared in accumulated context.
 * One parse of the whole context, then the same AST walk as extractBindingNames —
 * line-oriented scanning missed multi-line declarations entirely and mis-read
 * declarations nested inside a committed block statement.
 */
export function extractScopeNamesFromContext(context: string): string[] {
  if (!context) return [];
  const sf = ts.createSourceFile('_ctx.tsx', context, ts.ScriptTarget.ES2022, /*setParentNodes*/ true, ts.ScriptKind.TSX);
  return [...new Set(declaredBindingNames(sf.statements))];
}

export type BindingKind = 'simple' | 'array' | 'object' | 'none';

/**
 * Like extractBindingNames, but also reports the binding pattern kind so callers
 * can map awaited results correctly:
 *   - 'simple' → `const x = ...`            (one name)
 *   - 'array'  → `const [a, b] = ...`        (positional)
 *   - 'object' → `const { a, b } = ...`      (by key)
 *   - 'none'   → no const/let/var binding
 */
export function extractBindingPattern(statement: string): { kind: BindingKind; names: string[] } {
  const stripped = statement.replace(/^(\s*\/\/[^\n]*\n)+/g, '').trimStart();
  const declMatch = stripped.match(/^\s*(?:const|let|var)\s+(.+?)\s*=/);
  if (!declMatch) return { kind: 'none', names: [] };
  const lhs = declMatch[1]!.trim();
  const names = extractBindingNames(statement);
  if (lhs.startsWith('{')) return { kind: 'object', names };
  if (lhs.startsWith('[')) return { kind: 'array', names };
  return { kind: 'simple', names };
}

/**
 * Extract LHS binding identifier names from a TypeScript statement.
 * Handles every binding shape a declarator can have — `const x = …`, typed
 * declarations, object/array destructuring with nesting (`{ a: { b } }`,
 * `[a, [b, c]]`), defaults (`{ a = 1, b: c = 2 }`), rest elements
 * (`[a, ...rest]`), multi-declarator lists (`const a = 1, b = 2`), no-init
 * declarations with annotated types, and function/class/enum declarations.
 *
 * Implemented on the TypeScript AST, not regexes: binding patterns nest, a type
 * annotation can legally contain any of `= , ; { } ( )` at depth, and the flat
 * character-class approach failed twice before (multi-declarator splitting, then
 * no-init declarations with structured type annotations). One `createSourceFile`
 * parse is negligible next to the full `runTsc` program check every statement
 * already pays. Leading comments need no stripping — they are parser trivia.
 */
export function extractBindingNames(statement: string): string[] {
  const sf = ts.createSourceFile('_b.tsx', statement, ts.ScriptTarget.ES2022, /*setParentNodes*/ true, ts.ScriptKind.TSX);
  return declaredBindingNames(sf.statements);
}

/** Names bound by TOP-LEVEL declarations of a parsed file — the runtime-binding
 *  counterpart of `typecheck/tsc.ts#declaredNames` (which shadows re-declared
 *  bindings for typecheck; this one propagates them to globalThis). Type-only
 *  declarations (type/interface) bind nothing and are skipped. */
function declaredBindingNames(statements: readonly ts.Statement[]): string[] {
  const names: string[] = [];
  for (const stmt of statements) {
    if (ts.isVariableStatement(stmt)) {
      for (const d of stmt.declarationList.declarations) walkBindingName(d.name, names);
    } else if (
      (ts.isFunctionDeclaration(stmt) || ts.isClassDeclaration(stmt) || ts.isEnumDeclaration(stmt)) &&
      stmt.name
    ) {
      // function / class / enum declarations. Each eval statement is its own module,
      // so a `function foo() {}` in one statement is invisible to the next unless we
      // propagate it via globalThis like any other binding. Without this, typecheck
      // (which sees the accumulated context) accepts a later `foo(...)` while eval
      // throws "'foo' is not defined" — the model then re-declares and hits
      // "Duplicate identifier" (live E4 failure shape).
      names.push(stmt.name.text);
    }
  }
  return names;
}

/** Collect the identifiers a BindingName binds, recursing through nested
 *  object/array patterns. Aliases (`{ b: c }`), defaults (`{ a = 1 }`) and rest
 *  elements (`...rest`) bind their `name`, never their property key. */
function walkBindingName(name: ts.BindingName, out: string[]): void {
  if (ts.isIdentifier(name)) {
    out.push(name.text);
    return;
  }
  for (const el of name.elements) {
    if (!ts.isBindingElement(el)) continue; // OmittedExpression (array hole)
    walkBindingName(el.name, out);
  }
}
