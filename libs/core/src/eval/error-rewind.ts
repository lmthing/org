import { extractScopeNamesFromContext } from '../context/variables.js';

/**
 * Map a failure message that reaches for a sandbox-unavailable API to a concrete,
 * actionable hint. The model repeatedly tries Node/Bun/Deno subprocess APIs that do
 * not exist in the QuickJS VM and burns its whole retry budget — these hints redirect
 * it to the real host-injected primitives in one step. Returns '' when nothing matches.
 */
export function sandboxApiHint(message: string): string {
  const m = message.toLowerCase();
  // Subprocess / shell — the single most common dead end (child_process, Bun, Deno, spawn…).
  if (
    /child_process|node:child_process|\bbun\b|\bdeno\b|execsync|spawnsync|\bspawn\b|\bexeca\b|require\(/.test(m)
  ) {
    return 'HINT: Node/Bun/Deno modules are NOT available in this sandbox. To run a shell command or subprocess use the host global `execShell(cmd)` → returns `{ ok, stdout, stderr }`. Example: `const { ok, stdout } = execShell("npx tsx path/to/test.ts");`';
  }
  // HTTP — point at the synchronous fetch shim.
  if (/cannot find name 'fetch'|cannot find name "fetch"|\baxios\b|node-fetch|\bgot\b\b/.test(m)) {
    return 'HINT: Use the host global `fetch(url, opts?)` (synchronous, curl-backed) → `{ ok, status, text(), json() }`. Do not import http libraries.';
  }
  // File system — point at readFileRaw/writeFileRaw / fs space functions.
  if (/node:fs|'fs'|"fs"|readfilesync|writefilesync|\bfs\.|mkdirsync/.test(m)) {
    return 'HINT: Node `fs` is NOT available. Use `readFile(path)` / `writeFile(path, content)` / `editFile(...)` (space functions), or the host globals `readFileRaw(path)` / `writeFileRaw(path, content)`. Relative paths resolve against the space dir.';
  }
  // Text encoding helpers.
  if (/textdecoder|textencoder|\bbuffer\b/.test(m)) {
    return 'HINT: TextDecoder/TextEncoder/Buffer are NOT available. `execShell`/`fetch` already return decoded strings (stdout / text()).';
  }
  // process.cwd and friends — process is a read-only env shim only.
  if (/property 'cwd'|process\.cwd|cannot find name 'process'/.test(m)) {
    return 'HINT: `process` is a minimal read-only env shim — only `process.env` is available (incl. LMTHING_SPACE_DIR). There is no process.cwd(); relative file paths already resolve against the space dir.';
  }
  return '';
}

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

  const hint = sandboxApiHint(message);
  if (hint) {
    lines.push('');
    lines.push(`// ${hint}`);
  }

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
