import { extractScopeNamesFromContext, boundAlreadyExecuted } from '../context/variables.js';

// boundAlreadyExecuted moved to context/variables.js (the VARIABLES hot path
// needs it too, and this module already imports from there). Re-exported so
// existing importers/tests keep working.
export { boundAlreadyExecuted };

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
  // HTTP — raw fetch is deliberately absent from every model DTS (see
  // NET_FETCH_DTS in typecheck/library-dts.ts); pointing the model back at it
  // was a guaranteed identical-retry loop. Point at the granted research path.
  if (/cannot find name 'fetch'|cannot find name "fetch"|\baxios\b|node-fetch|\bgot\b\b/.test(m)) {
    return 'HINT: raw `fetch` is NOT available to you. For the web use your granted research functions — `await webSearch(query)` / `await webFetch(url)` — and if you have neither, you are not meant to reach the network from this context. Do not import http libraries or retry `fetch`.';
  }
  // File system — there is NO generic fs on the model surface (readFile/
  // readFileRaw/writeFileRaw are internal host primitives absent from every
  // agent DTS; only the engineer holds scratch fs). Prescribing them here was
  // a guaranteed identical-retry loop — point at the typed read/write surface.
  if (/node:fs|'fs'|"fs"|readfilesync|writefilesync|\bfs\.|mkdirsync/.test(m)) {
    return 'HINT: there is NO filesystem here. Read with `listProjectDir`/`readProjectFile` (project) or `listSpaceDir`/`readSpaceFile` (space); persist ONLY through your typed writers (`writeProject*`, builder functions). Only the engineer has a scratch fs (after `createScratch()`). Do not retry fs calls this context does not declare.';
  }
  // TS2591 — with `types: []` the checker suggests installing @types/node for
  // any node-ish global; "npm i @types/node" is actively harmful advice here.
  if (/install type definitions for node|@types\/node/.test(m)) {
    return 'HINT: this is NOT a missing-types problem — Node builtins do not exist in this sandbox and installing @types/node is impossible here. Use the injected globals your context declares instead.';
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
