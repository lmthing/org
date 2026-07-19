import { extractScopeNamesFromContext } from '../context/variables.js';

/**
 * Every statement in a session shares ONE persistent scope, so a name bound many turns
 * ago is still bound now. Refining an earlier statement (a wider `slice`, one more field)
 * by re-sending it with the same `const` is the natural move and it fails — TS2451 /
 * TS2300. The generic "already declared" list in the error block grows to hundreds of
 * names over a long session, so the model cannot scan it and re-sends the same
 * declaration until the retry budget is gone. Naming the ONE colliding binding, and the
 * two ways out of it, recovers that in a single attempt. Returns '' when nothing matches.
 */
export function redeclareHint(message: string): string {
  const m = message.match(
    /Cannot redeclare block-scoped variable '([^']+)'|Duplicate identifier '([^']+)'/,
  );
  if (!m) return '';
  const name = m[1] ?? m[2]!;
  return (
    `HINT: \`${name}\` is ALREADY bound — every statement in this session shares one persistent scope, ` +
    `so a name you bound in an EARLIER statement (even many turns ago) is still bound. Re-sending the ` +
    `same \`const ${name} = …\` will fail identically. Either bind a NEW name (\`${name}2\`, ` +
    `\`${name}Full\`, …) for the new value, or drop the keyword and reassign (\`${name} = …\`) if you ` +
    `really mean to overwrite it.`
  );
}

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
    return 'HINT: Node/Bun/Deno modules are NOT available, and there is no generic shell here. Running code/subprocesses is only possible inside the engineer\'s scratch sandbox (`execShell` there, after `createScratch()`). If you are not the engineer, delegate the code to it and persist what it returns with your typed writer.';
  }
  // HTTP — point at the fetch global.
  if (/cannot find name 'fetch'|cannot find name "fetch"|\baxios\b|node-fetch|\bgot\b\b/.test(m)) {
    return 'HINT: Use the host global `await fetch(url, opts?)` → `Promise<{ ok, status, text(), json() }>`. Do not import http libraries.';
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

/** Rolling window (chars) for the ALREADY-EXECUTED echo in {@link buildErrorBlock}. The
 *  full accumulated context is re-embedded on EVERY retry so the model can see what ran;
 *  on a long turn that is thousands of statements re-sent each attempt — a quadratic driver
 *  of the runaway-turn history blow-up ("Invalid string length"). The model only needs the
 *  RECENT tail to "continue from there"; the complete set of live bindings is already
 *  advertised on the "Still in scope" line (derived from the FULL context), and typecheck
 *  still runs against the full accumulatedContext host-side (turn-loop.ts) — so bounding
 *  this echo is purely a prompt-size cap with ZERO typecheck-correctness cost. */
const ALREADY_EXECUTED_WINDOW_CHARS = 8_000;

/**
 * Bound the re-embedded ALREADY-EXECUTED context to the last {@link ALREADY_EXECUTED_WINDOW_CHARS}
 * characters, cut on a statement (newline) boundary, prefixed with an "N earlier statements
 * omitted" marker. The omitted statements are NOT lost to the model: their bound names are
 * listed on the "Still in scope" line above (computed from the full context), and the VM +
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

  const hint = redeclareHint(message) || sandboxApiHint(message);
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
    lines.push(boundAlreadyExecuted(scopeContext));
  }

  return lines.join('\n');
}
