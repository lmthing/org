import { serialize } from '../globals/serialize.js';

/**
 * Format a VARIABLES block from a map of variable names to values.
 * When scopeContext is provided, also lists:
 *   - SCOPE: already-declared variable names (don't redeclare)
 *   - EXECUTED: full accumulated context block so the model knows what already ran
 */
export function emitVariables(vars: Record<string, unknown>, scopeContext?: string): string {
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

    lines.push('');
    lines.push('ALREADY EXECUTED (do not repeat any of these statements — write only what comes NEXT):');
    lines.push(scopeContext);
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

  // Declaration with NO initializer: `let parsed;`, `let a, b;`, `let x: string;`.
  // Without this, such names are never propagated to globalThis, so a later eval
  // statement that references them throws ReferenceError (each eval is its own module).
  const noInitMatch = stripped.match(/^\s*(?:const|let|var)\s+([^=;]+?)\s*;?\s*$/);
  if (noInitMatch) {
    for (const part of noInitMatch[1]!.split(',')) {
      const name = part.replace(/\s*:.*$/, '').trim(); // strip type annotation
      if (/^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(name)) names.push(name);
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
