import { serialize } from '../globals/serialize.js';

/**
 * Format a VARIABLES block from a map of variable names to values.
 * Used after yield resumes to inject resolved values into context.
 */
export function emitVariables(vars: Record<string, unknown>): string {
  const lines: string[] = ['VARIABLES'];
  for (const [name, value] of Object.entries(vars)) {
    lines.push(`${name}: ${serialize(value)}`);
  }
  return lines.join('\n');
}

/**
 * Extract LHS binding identifier names from a TypeScript statement.
 * Handles: `const x = ...`, `let [a, b] = ...`, `const { x, y } = ...`
 */
export function extractBindingNames(statement: string): string[] {
  const names: string[] = [];

  // const/let/var declarations
  const declMatch = statement.match(/^\s*(?:const|let|var)\s+(.+?)\s*=/);
  if (declMatch) {
    const lhs = declMatch[1]!.trim();
    // Object destructuring: { a, b, c: alias }
    const objDestructMatch = lhs.match(/^\{([^}]+)\}$/);
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
    // Array destructuring: [a, b, c]
    const arrDestructMatch = lhs.match(/^\[([^\]]+)\]$/);
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
    // Simple identifier
    if (/^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(lhs)) {
      names.push(lhs);
    }
  }

  return names;
}
