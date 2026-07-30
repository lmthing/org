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
 * See org/docs/design-system/tokens.md + tokens.manifest.json for the full palette.
 *
 * Legitimately allowed (not flagged):
 *   - Color functions built from tokens: rgb/hsl(var(--…))
 *   - Achromatic overlays/scrims/shadows: rgba(0,0,0,<a<1>) / rgba(255,255,255,<a<1>)
 *
 * Comments are NOT scanned. A comment cannot style anything, and this linter's own subject matter
 * means the code most likely to describe `rgb()` or a hex in prose is the code that got the colour
 * handling RIGHT. `view/icons.tsx` is the case in point: it resolves `$token` paints to a real
 * `rgb()` because React Native SVG cannot parse tokens, and the JSDoc explaining why tripped the
 * gate on the word `rgb()` alone. A false positive there teaches people to reach for
 * `ds-lint-file-ok`, which then hides the real violations in the same file.
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
  /(^|\/)tokens\.generated\.ts$/.test(p) || // generated Tamagui token module — token defs, like theme.css
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

/**
 * Blank out every comment, preserving the exact character positions of everything else.
 *
 * Positions matter: findings are reported as `file:line:col`, so comments are overwritten with
 * spaces (newlines kept) rather than removed. Handles `//` and block comments for TS/JSX, and
 * block comments for CSS — a bare `//` inside a CSS file is not a comment, so it is left alone.
 *
 * String literals are tracked so a `//` inside one (a URL, most often) is not mistaken for the
 * start of a comment — otherwise the rest of that line would be blanked and a real violation
 * sitting after a URL would go unreported.
 */
function stripComments(src, isCss) {
  const out = src.split('');
  let i = 0;
  let quote = null; // ' " ` when inside a string literal
  while (i < src.length) {
    const c = src[i];
    const next = src[i + 1];
    if (quote) {
      if (c === '\\') { i += 2; continue; }
      if (c === quote) quote = null;
      i++;
      continue;
    }
    if (c === '"' || c === "'" || (!isCss && c === '`')) { quote = c; i++; continue; }
    if (c === '/' && next === '*') {
      while (i < src.length && !(src[i] === '*' && src[i + 1] === '/')) {
        if (src[i] !== '\n') out[i] = ' ';
        i++;
      }
      // the closing */ itself
      for (let k = 0; k < 2 && i < src.length; k++, i++) if (src[i] !== '\n') out[i] = ' ';
      continue;
    }
    if (!isCss && c === '/' && next === '/') {
      while (i < src.length && src[i] !== '\n') { out[i] = ' '; i++; }
      continue;
    }
    i++;
  }
  return out.join('');
}

const findings = [];
for (const file of files) {
  if (ALLOW_FILE(file)) continue;
  const src = readFileSync(file, 'utf8');
  if (src.includes('ds-lint-file-ok')) continue;
  // `ds-lint-ok` lives in a comment, so match it against the ORIGINAL line; scan the stripped one.
  const rawLines = src.split('\n');
  const lines = stripComments(src, extname(file) === '.css').split('\n');
  lines.forEach((line, i) => {
    if (rawLines[i].includes('ds-lint-ok')) return;
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
  `\n[lint-design-tokens] ✗ ${findings.length} violation(s). Use a design token (var(--…) or a token-backed utility like bg-primary). See org/docs/design-system/. Escape with a \`ds-lint-ok\` comment when truly necessary.`,
);
process.exit(1);
