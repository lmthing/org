#!/usr/bin/env node
/**
 * resolve-tw-vars.mjs — the second half of `expand-apply.mjs`, and the part that actually deletes
 * Tailwind rather than just moving it.
 *
 * `@apply` does not expand to plain declarations. It expands to declarations that reference
 * Tailwind's OWN variables, in two families:
 *
 *   --tw-*                       registered with `@property` (initial values, no `:root` block)
 *   --spacing / --text-sm /      Tailwind's default THEME, emitted into `:root` by `@layer theme`
 *   --font-weight-* / --default-transition-*
 *
 * Both vanish with Tailwind, so `box-shadow: var(--tw-ring-shadow), var(--tw-shadow)` computes to
 * `none` and `border-left-style: var(--tw-border-style)` computes to `none`. That is exactly the
 * silent breakage this pass exists to prevent.
 *
 * WHAT IT DOES NOT TOUCH: lmthing's own tokens. `var(--border)`, `var(--brand-2)`, `var(--muted)`
 * survive the deletion (`theme.css` keeps emitting them), so they are left as references — inlining
 * them would break theming, which is the opposite of the goal.
 *
 * The variable tables are read out of Tailwind itself, never hardcoded.
 *
 * Usage: node libs/css/scripts/resolve-tw-vars.mjs [--check] <file.css> …
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ORG = resolve(HERE, '../../..');
const require = createRequire(resolve(HERE, '../../cli/package.json'));
const { compile } = await import(`file://${require.resolve('@tailwindcss/node')}`);

// ── Tailwind's own variable tables, read from Tailwind ────────────────────────────────────────────
const probe = await compile('@import "tailwindcss";', { base: resolve(HERE, '../src'), onDependency: () => {} });
const full = probe.build([
  'shadow-sm', 'shadow-md', 'shadow-lg', 'shadow-xl', 'shadow-2xl', 'shadow-none', 'shadow',
  'ring', 'ring-1', 'ring-2', 'ring-offset-2', 'inset-ring',
  'transition-all', 'transition-colors', 'transition-transform', 'duration-150', 'duration-200',
  'text-xs', 'text-sm', 'text-xl', 'font-medium', 'font-semibold', 'font-bold',
  'border', 'border-2', 'border-none', 'space-y-2', 'space-y-3',
  'bg-gradient-to-r', 'bg-linear-to-r', 'from-brand-2', 'via-brand-3', 'to-brand-3',
  'from-black/50', 'to-transparent', 'bg-radial', 'bg-conic',
  'rotate-90', '-translate-x-1/2', 'tracking-tight', 'antialiased',
]);

/** `@property --tw-x { initial-value: v }`. A property with NO initial-value is guaranteed-invalid,
 *  so a `var()` on it resolves to the var's own fallback — represented here as `undefined`. */
const PROPERTY_INITIAL = new Map();
for (const m of full.matchAll(/@property\s+(--[a-zA-Z0-9-]+)\s*\{([^}]*)\}/g)) {
  const iv = /initial-value:\s*([^;]*)/.exec(m[2]);
  PROPERTY_INITIAL.set(m[1], iv ? iv[1].trim() : undefined);
}

/** Tailwind's default theme, from its `@layer theme` `:root`. These are NOT lmthing tokens. */
const THEME = new Map();
{
  const layer = /@layer theme\s*\{([\s\S]*?)\n\}/.exec(full);
  if (layer) for (const m of layer[1].matchAll(/(--[a-zA-Z0-9-]+):\s*([^;]+);/g)) THEME.set(m[1], m[2].trim());
}
/** lmthing's own tokens live in theme.css's `:root` — never resolve these away. */
const OURS = new Set();
{
  const themeCss = readFileSync(resolve(HERE, '../src/theme.css'), 'utf8');
  for (const m of themeCss.matchAll(/^\s*(--[a-zA-Z0-9-]+):/gm)) OURS.add(m[1]);
}

// ── value resolution ──────────────────────────────────────────────────────────────────────────────

/** Split a `var(...)` argument list at the FIRST top-level comma: name, fallback. */
function splitVarArgs(inner) {
  let depth = 0;
  for (let i = 0; i < inner.length; i++) {
    if (inner[i] === '(') depth++;
    else if (inner[i] === ')') depth--;
    else if (inner[i] === ',' && depth === 0) return [inner.slice(0, i).trim(), inner.slice(i + 1)];
  }
  return [inner.trim(), null];
}

/** Find the matching `)` for a `var(` starting at `open`. */
function matchParen(s, open) {
  let depth = 0;
  for (let i = open; i < s.length; i++) {
    if (s[i] === '(') depth++;
    else if (s[i] === ')' && --depth === 0) return i;
  }
  return -1;
}

function resolveValue(value, locals, seen = new Set()) {
  let out = value;
  for (let guard = 0; guard < 12; guard++) {
    const at = out.indexOf('var(');
    if (at === -1) break;
    let changed = false;
    let cursor = 0;
    let next = '';
    while (true) {
      const i = out.indexOf('var(', cursor);
      if (i === -1) { next += out.slice(cursor); break; }
      const close = matchParen(out, i + 3);
      if (close === -1) { next += out.slice(cursor); break; }
      const [name, fallback] = splitVarArgs(out.slice(i + 4, close));
      next += out.slice(cursor, i);

      let replacement = null;
      if (OURS.has(name)) {
        replacement = null; // ours — keep the reference
      } else if (locals.has(name) && !seen.has(name)) {
        replacement = resolveValue(locals.get(name), locals, new Set([...seen, name]));
      } else if (PROPERTY_INITIAL.has(name)) {
        const initial = PROPERTY_INITIAL.get(name);
        replacement = initial !== undefined ? initial : (fallback ?? '').trim();
      } else if (THEME.has(name)) {
        replacement = THEME.get(name);
      } else if (fallback !== null) {
        replacement = fallback.trim();
      }

      if (replacement === null) {
        next += out.slice(i, close + 1); // untouched
      } else {
        next += replacement;
        changed = true;
      }
      cursor = close + 1;
    }
    out = next;
    if (!changed) break;
  }
  return simplify(out);
}

/** Collapse the `calc()` forms Tailwind emits for spacing/leading, once operands are literal. */
function simplify(value) {
  let v = value;
  for (let i = 0; i < 6; i++) {
    const before = v;
    // calc(<num><unit> * <num>) and calc(<num> * <num><unit>)
    v = v.replace(/calc\(\s*(-?[\d.]+)(r?em|px|%)\s*\*\s*(-?[\d.]+)\s*\)/g, (_, a, u, b) => `${round(a * b)}${u}`);
    v = v.replace(/calc\(\s*(-?[\d.]+)\s*\*\s*(-?[\d.]+)(r?em|px|%)\s*\)/g, (_, a, b, u) => `${round(a * b)}${u}`);
    // Deliberately NOT folding `calc(<num> / <num>)`: `line-height: calc(1.25 / 0.875)` rounded to
    // six places moved a 20px line box to 19.9844px. The browser's exact rational is the correct value,
    // so the calc() stays.
    if (v === before) break;
  }
  // `color-mix(in oklab, X 100%, transparent)` is exactly X — the wrapper existed only to apply
  // `--tw-shadow-alpha`, which defaults to 100%. Unwrapping it is computed-identical.
  for (let i = 0; i < 6; i++) {
    const before = v;
    v = v.replace(/color-mix\(in oklab,\s*(color-mix\((?:[^()]|\([^()]*\))*\)|var\([^()]*\)|[^,()]+)\s+100%,\s*transparent\)/g, '$1');
    if (v === before) break;
  }
  // `box-shadow: 0 0 #0000, 0 0 #0000, X` — the transparent zero-geometry layers Tailwind always
  // composes in. They paint nothing; dropping them is the one intentional computed difference this
  // pass makes, and `css-computed-equivalence.mjs` normalises for it on both sides.
  if (/(^|,)\s*0 0 #0000\s*(,|$)/.test(v)) {
    const parts = splitTopLevel(v).filter((p) => p.trim() !== '0 0 #0000' && p.trim() !== '');
    v = parts.length ? parts.join(', ') : 'none';
  }
  return v.replace(/\s+/g, ' ').replace(/\s*,\s*/g, ', ').trim();
}
const round = (n) => Math.round(Number(n) * 1e6) / 1e6;

function splitTopLevel(v) {
  const out = [];
  let depth = 0;
  let cur = '';
  for (const ch of v) {
    if (ch === '(') depth++;
    if (ch === ')') depth--;
    if (ch === ',' && depth === 0) { out.push(cur); cur = ''; continue; }
    cur += ch;
  }
  out.push(cur);
  return out;
}

// ── file rewriting ────────────────────────────────────────────────────────────────────────────────

/** Rewrite each brace block: resolve values, then drop the `--tw-*` declarations that fed them. */
function rewriteBlocks(css) {
  let out = '';
  let i = 0;
  while (i < css.length) {
    const open = css.indexOf('{', i);
    if (open === -1) { out += css.slice(i); break; }
    let depth = 1;
    let j = open + 1;
    while (j < css.length && depth > 0) {
      if (css[j] === '{') depth++;
      else if (css[j] === '}') depth--;
      j++;
    }
    const head = css.slice(i, open + 1);
    const body = css.slice(open + 1, j - 1);
    out += head;
    // A body may hold BOTH declarations and nested blocks (Tailwind emits `&:hover { … }` and
    // `@media (hover: hover) { … }` inside a rule). Recursing on the whole body skipped the
    // declarations that sit alongside them — which is precisely where the `--tw-*` chains live.
    out += rewriteBody(body);
    out += '}';
    i = j;
  }
  return out;
}

/** Split a body into declaration runs and nested blocks, rewriting each appropriately. */
function rewriteBody(body) {
  let out = '';
  let i = 0;
  while (i < body.length) {
    const open = body.indexOf('{', i);
    if (open === -1) { out += rewriteDeclarations(body.slice(i)); break; }
    // The nested block's selector starts after the previous `;` or `}` — everything before that is
    // a declaration run belonging to THIS rule.
    let selStart = open;
    while (selStart > i && !';}'.includes(body[selStart - 1])) selStart--;
    out += rewriteDeclarations(body.slice(i, selStart));
    let depth = 1;
    let j = open + 1;
    while (j < body.length && depth > 0) {
      if (body[j] === '{') depth++;
      else if (body[j] === '}') depth--;
      j++;
    }
    out += body.slice(selStart, open + 1) + rewriteBody(body.slice(open + 1, j - 1)) + '}';
    i = j;
  }
  return out;
}

function rewriteDeclarations(body) {
  const locals = new Map();
  for (const m of body.matchAll(/(--[a-zA-Z0-9-]+)\s*:\s*([^;]*);/g)) locals.set(m[1], m[2].trim());

  const lines = body.split('\n');
  const kept = [];
  for (const line of lines) {
    const decl = /^(\s*)(--[a-zA-Z0-9-]+|[a-zA-Z-]+)\s*:\s*([^;]*);(.*)$/.exec(line);
    if (!decl) { kept.push(line); continue; }
    const [, indent, prop, value, trail] = decl;
    // Tailwind's own bookkeeping: it only existed to feed the declarations we just resolved.
    if (prop.startsWith('--tw-')) continue;
    // Only rewrite a value we actually CHANGED. `simplify()` normalises whitespace, and a value with
    // no Tailwind variable in it must survive byte-for-byte — collapsing runs of spaces corrupted a
    // `@font-face` src path ("TypeMates  Cera Round Pro Bold.otf" has two spaces) on the first run.
    if (!value.includes('var(') && !value.includes('calc(') && !value.includes('color-mix(')) {
      kept.push(line);
      continue;
    }
    let resolved = resolveValue(value, locals);
    if (prop === 'transition-property') {
      // Tailwind lists its own gradient custom properties so gradients can animate. Without Tailwind
      // those properties do not exist, so naming them transitions nothing.
      resolved = splitTopLevel(resolved).map((p) => p.trim()).filter((p) => !p.startsWith('--tw-')).join(', ');
    }
    if (resolved === '' || resolved === undefined) continue; // e.g. an all-empty `var()` chain
    kept.push(`${indent}${prop}: ${resolved};${trail}`);
  }
  return kept.join('\n');
}

const CHECK = process.argv.includes('--check');
const files = process.argv.slice(2).filter((a) => !a.startsWith('--'));
let changed = 0;
for (const f of files) {
  const src = readFileSync(f, 'utf8');
  const out = rewriteBlocks(src);
  if (out === src) { console.log(`  —    ${relative(ORG, f)}: nothing to resolve`); continue; }
  if (!CHECK) writeFileSync(f, out);
  const twLeft = (out.match(/--tw-/g) || []).length;
  console.log(`✓ ${relative(ORG, f)}${twLeft ? `  (WARNING: ${twLeft} --tw- reference(s) left)` : ''}`);
  changed++;
}
console.log(`\n[resolve-tw-vars] ${CHECK ? 'would rewrite' : 'rewrote'} ${changed} file(s)`);
console.log(`  tables: ${PROPERTY_INITIAL.size} @property, ${THEME.size} Tailwind theme vars, ${OURS.size} lmthing tokens preserved`);
