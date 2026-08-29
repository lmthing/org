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
 * Scans lines that start a const/let/var declaration.
 */
export function extractScopeNamesFromContext(context: string): string[] {
  if (!context) return [];
  const names: string[] = [];
  for (const line of context.split('\n')) {
    const trimmed = line.trim();
    if (/^(?:const|let|var)\s/.test(trimmed)) {
      names.push(...extractBindingNames(trimmed));
    }
  }
  return [...new Set(names)];
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
 * Handles: `const x = ...`, `let [a, b] = ...`, `const { x, y } = ...`
 * Strips leading line-comments (// ...) which the boundary detector may include as trivia.
 */
export function extractBindingNames(statement: string): string[] {
  const names: string[] = [];

  // Strip leading single-line comments before checking for declarations
  const stripped = statement.replace(/^(\s*\/\/[^\n]*\n)+/g, '').trimStart();

  // const/let/var declarations
  const declMatch = stripped.match(/^\s*(?:const|let|var)\s+(.+?)\s*=/);
  if (declMatch) {
    const lhs = declMatch[1]!.trim();
    // Object destructuring: { a, b, c: alias } — strip optional type annotation after }
    const objDestructMatch = lhs.match(/^\{([^}]+)\}/);
    if (objDestructMatch) {
      const parts = objDestructMatch[1]!.split(',');
      for (const part of parts) {
        const aliased = part.split(':');
        const name = (aliased.length > 1 ? aliased[1] : aliased[0])!.trim();
        if (/^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(name)) {
          names.push(name);
        }
      }
      return names;
    }
    // Array destructuring: [a, b, c] — strip optional type annotation after ]
    const arrDestructMatch = lhs.match(/^\[([^\]]+)\]/);
    if (arrDestructMatch) {
      const parts = arrDestructMatch[1]!.split(',');
      for (const part of parts) {
        const name = part.trim();
        if (/^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(name)) {
          names.push(name);
        }
      }
      return names;
    }
    // Simple identifier or multi-variable declaration: const a=x, b=y, c=z
    // Split by top-level commas to extract ALL declarators (not just the first one,
    // which was the pre-fix bug: const a=x, b=y only propagated `a` to globalThis).
    const afterKeyword = stripped.replace(/^\s*(?:const|let|var)\s+/, '');
    for (const part of splitByTopLevelCommas(afterKeyword)) {
      const eqIdx = part.indexOf('=');
      if (eqIdx === -1) continue;
      const namePart = part.slice(0, eqIdx).replace(/\s*:.*$/, '').trim();
      if (/^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(namePart)) {
        names.push(namePart);
      }
    }
    return names;
  }

  // Declaration with NO initializer: `let parsed;`, `let a, b;`, `let x: string;`,
  // `let w: { ok: boolean; error?: string };`. A no-initializer declarator can only ever
  // be a bare identifier with an optional type annotation — destructuring patterns
  // (`{ a, b }` / `[a, b]`) require an initializer in JS/TS, so they can't appear here.
  // The declarator list is therefore just top-level-comma-separated identifiers, but the
  // type annotation on any of them may itself contain `;`/`,` at brace/paren/bracket
  // depth (e.g. an inline object type's members) — a flat `[^=;]` character class can't
  // tell those apart from real declarator separators, so it must split comma-aware
  // (`splitByTopLevelCommas`) rather than matching the whole tail with one regex.
  const noInitKeywordMatch = stripped.match(/^\s*(?:const|let|var)\s+([\s\S]+?);?\s*$/);
  if (noInitKeywordMatch && !hasTopLevelEquals(noInitKeywordMatch[1]!)) {
    for (const part of splitByTopLevelCommas(noInitKeywordMatch[1]!)) {
      const nameMatch = part.trim().match(/^([a-zA-Z_$][a-zA-Z0-9_$]*)/);
      if (nameMatch) names.push(nameMatch[1]!);
    }
    return names;
  }

  // function / class declarations. Each eval statement is its own module, so a
  // `function foo() {}` in one statement is invisible to the next unless we
  // propagate it via globalThis like any other binding. Without this, typecheck
  // (which sees the accumulated context) accepts a later `foo(...)` while eval
  // throws "'foo' is not defined" — the model then re-declares and hits
  // "Duplicate identifier" (live E4 failure shape). Type-only declarations
  // (type/interface) need no runtime propagation.
  const fnMatch = stripped.match(/^(?:export\s+)?(?:async\s+)?function\s*\*?\s*([a-zA-Z_$][a-zA-Z0-9_$]*)/);
  if (fnMatch) {
    names.push(fnMatch[1]!);
    return names;
  }
  const classMatch = stripped.match(/^(?:export\s+)?(?:abstract\s+)?class\s+([a-zA-Z_$][a-zA-Z0-9_$]*)/);
  if (classMatch) {
    names.push(classMatch[1]!);
  }

  return names;
}

/**
 * Split a string by commas that are not inside brackets, braces, or parentheses.
 * Used to separate declarators in multi-variable const/let/var statements.
 */
function splitByTopLevelCommas(str: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < str.length; i++) {
    const c = str[i];
    if (c === '{' || c === '[' || c === '(') depth++;
    else if (c === '}' || c === ']' || c === ')') depth--;
    else if (c === ',' && depth === 0) {
      parts.push(str.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(str.slice(start));
  return parts;
}

/**
 * True if `str` contains a top-level (depth-0) assignment `=` — as opposed to one that's
 * part of a comparison/arrow (`==`, `=>`, `<=`, `>=`, `!=`) or nested inside a bracketed
 * type (a function-type member's own `=>`). Used to tell a genuine no-initializer
 * declaration (`let w: { a: () => void };`) apart from a WITH-initializer declaration
 * whose `=` simply falls outside what the single-line with-initializer regex above can see
 * (a multi-line `let w: {\n  ...\n} = value;`) — the latter must NOT be parsed as no-init.
 */
function hasTopLevelEquals(str: string): boolean {
  let depth = 0;
  for (let i = 0; i < str.length; i++) {
    const c = str[i];
    if (c === '{' || c === '[' || c === '(') depth++;
    else if (c === '}' || c === ']' || c === ')') depth--;
    else if (c === '=' && depth === 0) {
      const prev = str[i - 1];
      const next = str[i + 1];
      if (next === '=' || next === '>') continue; // ==, =>
      if (prev === '=' || prev === '!' || prev === '<' || prev === '>') continue; // ==, !=, <=, >=
      return true;
    }
  }
  return false;
}
