#!/usr/bin/env node
/**
 * lint-design-tokens — the design-system adherence gate.
 *
 * Fails (exit 1) when source uses colors that bypass the token system:
 *   1. Raw hex / rgb() / hsl() color literals in .css/.tsx/.ts
 *   2. Stock Tailwind color-family utilities (gray-500, blue-600, green-500, …)
 *      in @apply directives or className strings
 *
 * Use a design token instead: var(--foreground), bg-primary, text-agent, etc.
 * See @lmthing/css DESIGN.md + tokens.manifest.json for the full palette.
 *
 * Legitimately allowed (not flagged):
 *   - Color functions built from tokens: rgb/hsl(var(--…))
 *   - Achromatic overlays/scrims/shadows: rgba(0,0,0,<a<1>) / rgba(255,255,255,<a<1>)
 *
 * Escape hatches:
 *   - `ds-lint-ok` in a comment on the offending line skips that line
 *   - `ds-lint-file-ok` anywhere in a file skips the whole file (for terminal
 *     ANSI palettes, syntax-highlight themes, and other non-brand color sets)
 *
 * Usage: node lint-design-tokens.mjs <dir> [dir…]   (defaults to ./src)
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, basename, extname } from 'node:path';

const EXTS = new Set(['.css', '.tsx', '.ts', '.jsx']);
const SKIP_DIRS = new Set(['node_modules', 'dist', '.turbo', '.git', 'build', 'coverage']);
// Files that legitimately contain raw color values (the token definitions themselves).
const ALLOW_FILE = (p) =>
  /(^|\/)theme\.css$/.test(p) ||
  /(^|\/)tokens\.json$/.test(p) ||
  /(^|\/)tokens\.manifest\.json$/.test(p) ||
  /(^|\/)scripts\//.test(p);

const STOCK = 'slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose';
// A stock color utility, optionally with a variant prefix (hover:) and opacity (/50).
const STOCK_RE = new RegExp(`\\b(?:[a-z-]+:)*(?:bg|text|border|ring|from|via|to|fill|stroke|outline|decoration|shadow|accent|caret|divide|placeholder)-(?:${STOCK})-(?:50|100|200|300|400|500|600|700|800|900|950)\\b`, 'g');
const HEX_RE = /#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})\b/g;
const FUNC_RE = /\b(rgba?|hsla?)\(([^)]*)\)/g;

// A color function is allowed if it's token-based (var(...)) or an achromatic
// overlay/scrim/shadow (grey/black/white with alpha < 1 — no token exists for these).
function funcAllowed(fn, args) {
  if (args.includes('var(')) return true;
  const nums = args.split(/[,/\s]+/).filter(Boolean);
  if (fn.startsWith('rgb')) {
    const [r, g, b, a] = nums.map(parseFloat);
    const achromatic = r === g && g === b;
    const alpha = nums[3] !== undefined ? a : 1;
    return achromatic && alpha < 1;
  }
  // hsl/hsla: saturation is the 2nd value; achromatic when it starts with 0
  const achromatic = (nums[1] || '').startsWith('0');
  const alpha = nums[3] !== undefined ? parseFloat(nums[3]) : 1;
  return achromatic && alpha < 1;
}

function walk(dir, out) {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  for (const name of entries) {
    if (SKIP_DIRS.has(name)) continue;
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, out);
    else if (EXTS.has(extname(name))) out.push(p);
  }
}

const roots = process.argv.slice(2);
if (roots.length === 0) roots.push('src');

const files = [];
for (const r of roots) {
  const st = (() => {
    try {
      return statSync(r);
    } catch {
      return null;
    }
  })();
  if (!st) continue;
  if (st.isDirectory()) walk(r, files);
  else if (EXTS.has(extname(r))) files.push(r);
}

const findings = [];
for (const file of files) {
  if (ALLOW_FILE(file)) continue;
  const src = readFileSync(file, 'utf8');
  if (src.includes('ds-lint-file-ok')) continue;
  const lines = src.split('\n');
  lines.forEach((line, i) => {
    if (line.includes('ds-lint-ok')) return;
    const check = (re, kind) => {
      re.lastIndex = 0;
      let m;
      while ((m = re.exec(line))) {
        findings.push({ file, line: i + 1, col: m.index + 1, kind, text: m[0] });
      }
    };
    check(STOCK_RE, 'stock-tailwind-color');
    check(HEX_RE, 'raw-hex');
    // color functions: only flag non-token, non-achromatic-overlay uses
    FUNC_RE.lastIndex = 0;
    let m;
    while ((m = FUNC_RE.exec(line))) {
      if (!funcAllowed(m[1], m[2])) {
        findings.push({ file, line: i + 1, col: m.index + 1, kind: 'raw-color-fn', text: m[0] });
      }
    }
  });
}

if (findings.length === 0) {
  console.log(`[lint-design-tokens] ✓ no violations in ${files.length} files`);
  process.exit(0);
}

for (const f of findings) {
  console.log(`${f.file}:${f.line}:${f.col}  ${f.kind}  ${f.text}`);
}
console.error(
  `\n[lint-design-tokens] ✗ ${findings.length} violation(s). Use a design token (var(--…) or a token-backed utility like bg-primary). See @lmthing/css DESIGN.md. Escape with a \`ds-lint-ok\` comment when truly necessary.`,
);
process.exit(1);
