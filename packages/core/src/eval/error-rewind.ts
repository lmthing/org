import { extractScopeNamesFromContext } from '../context/variables.js';

/**
 * Build an error block for injection into the message history after a failed statement.
 *
 * Statements that ran successfully earlier in the turn already bound their variables
 * in the VM (globalThis), and those bindings persist into the retry. We do NOT roll
 * back the typecheck context on error (that would diverge typecheck from VM reality
 * and trigger spurious "Cannot find name" errors). So the error block tells the model
 * exactly what is still in scope — write only what comes NEXT, and do not redeclare.
 */
export function buildErrorBlock(
  failingStatement: string,
  message: string,
  attempt: number,
  maxRetries = 3,
  scopeContext?: string,
): string {
  const lines = [
    `ERROR (attempt ${attempt} of ${maxRetries})`,
    `// ${failingStatement.split('\n').join('\n// ')}`,
    `// ${message}`,
  ];

  if (scopeContext) {
    const inScope = extractScopeNamesFromContext(scopeContext);
    if (inScope.length > 0) {
      lines.push('');
      lines.push(`// Still in scope from earlier successful statements (do NOT redeclare): ${inScope.join(', ')}`);
    }
    lines.push('');
    lines.push('// ALREADY EXECUTED (do not repeat — fix the failing statement and continue from there):');
    lines.push(scopeContext);
  }

  return lines.join('\n');
}
