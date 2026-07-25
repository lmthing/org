#!/usr/bin/env node
/**
 * css-equivalence.mjs — the gate for phase 4's stylesheet work.
 *
 * P0 (`pnpm test:surface`) is the review artefact for the phase, but it only measures elements the
 * harness RENDERS. The 11 component stylesheets style studio/computer surfaces that are not in the
 * fixtures, so inlining their `@apply` could break a rule P0 never looks at.
 *
 * This closes that gap without a browser. For each stylesheet it compares the CSS the browser
 * actually receives, before and after:
 *
 *   before  = Tailwind compiles the source (`@reference` + `@apply`)   → declarations
 *   after   = the rewritten source IS plain CSS                        → declarations
 *
 * Both sides are normalised to a `selector → { property: value }` map and diffed. Equivalence here
 * means the deletion cannot change any rule in any of these files, rendered or not.
 *
 * Usage:
 *   node libs/css/scripts/css-equivalence.mjs --snapshot <out.json> <file.css> …
 *   node libs/css/scripts/css-equivalence.mjs --verify   <out.json> <file.css> …
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ORG = resolve(HERE, '../../..');
const require = createRequire(resolve(HERE, '../../cli/package.json'));
const { compile } = await import(`file://${require.resolve('@tailwindcss/node')}`);

/** Does this file still carry a Tailwind directive that needs the compiler? */
const NEEDS_TAILWIND = /@(apply|reference|theme|source|custom-variant|utility|variant)\b|@import\s+["']tailwindcss/;

async function toCss(file) {
  const src = readFileSync(file, 'utf8');
  const code = src.replace(/\/\*[\s\S]*?\*\//g, ''); // a directive NAMED in a comment is not one
  if (!NEEDS_TAILWIND.test(code)) return src; // already plain CSS — this is what we are moving to
  const compiler = await compile(src, { base: dirname(file), onDependency: () => {} });
  return compiler.build([]);
}

/**
 * Flatten CSS into `selector → { prop: value }`.
 *
 * Deliberately ignores `@property` blocks and bare `@layer` statements: those are Tailwind's own
 * plumbing, and whether they exist is exactly what phase 4 is changing. What must not change is the
 * DECLARATIONS that land on each selector — including inside `@media`/`@supports`, which are kept as
 * part of the selector key so a rule cannot silently move between conditions.
 */
function declarations(css) {
  const out = {};
  // Strip comments, then walk brace-balanced blocks.
  const s = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const walk = (text, prefix) => {
    let i = 0;
    while (i < text.length) {
      const brace = text.indexOf('{', i);
      if (brace === -1) break;
      let depth = 1;
      let j = brace + 1;
      while (j < text.length && depth > 0) {
        if (text[j] === '{') depth++;
        else if (text[j] === '}') depth--;
        j++;
      }
      const selector = text.slice(i, brace).trim().replace(/\s+/g, ' ');
      const body = text.slice(brace + 1, j - 1);
      i = j;

      if (/^@property\b/.test(selector)) continue; // Tailwind plumbing, see above
      if (/^@(layer|supports|media|keyframes)\b/.test(selector)) {
        // `@layer x { … }` is transparent for cascade-equivalence purposes; `@media`/`@supports`
        // must stay part of the key. `@keyframes` bodies are percentage rules, keyed whole.
        const nextPrefix = /^@layer\b/.test(selector) ? prefix : `${prefix}${selector} `;
        if (/^@keyframes\b/.test(selector)) {
          out[`${prefix}${selector}`] = { __body__: body.replace(/\s+/g, ' ').trim() };
        } else {
          walk(body, nextPrefix);
        }
        continue;
      }

      const key = `${prefix}${selector}`;
      out[key] = out[key] || {};
      // Nested at-rules / nested selectors inside a rule (Tailwind emits `@supports` and
      // `:where(& > …)` inside rules) — recurse with the rule as prefix.
      const nested = [];
      let flat = body.replace(/([^{};]+)\{([^{}]*(?:\{[^{}]*\}[^{}]*)*)\}/g, (m) => {
        nested.push(m);
        return '';
      });
      for (const decl of flat.split(';')) {
        const c = decl.indexOf(':');
        if (c === -1) continue;
        const prop = decl.slice(0, c).trim();
        const value = decl.slice(c + 1).trim().replace(/\s+/g, ' ');
        if (!prop || !value) continue;
        out[key][prop] = value;
      }
      if (nested.length) walk(nested.join('\n'), `${key} `);
    }
  };
  walk(s, '');
  return out;
}

const mode = process.argv[2];
const jsonPath = process.argv[3];
const files = process.argv.slice(4);
if (!['--snapshot', '--verify'].includes(mode) || !jsonPath || !files.length) {
  console.error('usage: css-equivalence.mjs --snapshot|--verify <out.json> <file.css> …');
  process.exit(2);
}

const current = {};
for (const f of files) current[relative(ORG, f)] = declarations(await toCss(f));

if (mode === '--snapshot') {
  writeFileSync(jsonPath, `${JSON.stringify(current, null, 2)}\n`);
  const rules = Object.values(current).reduce((n, m) => n + Object.keys(m).length, 0);
  console.log(`[css-equivalence] snapshot: ${files.length} file(s), ${rules} rule(s) → ${relative(ORG, jsonPath)}`);
  process.exit(0);
}

const expected = JSON.parse(readFileSync(jsonPath, 'utf8'));
let problems = 0;
let checked = 0;

/** Tailwind emits these as its own bookkeeping; their absence afterwards is the POINT. */
const TW_INTERNAL = (p) => p.startsWith('--tw-');

for (const [file, want] of Object.entries(expected)) {
  const got = current[file];
  if (!got) {
    console.log(`✗ ${file}: missing from this run`);
    problems++;
    continue;
  }
  for (const [selector, decls] of Object.entries(want)) {
    const gotDecls = got[selector];
    if (!gotDecls) {
      console.log(`✗ ${file}\n    selector GONE: ${selector}`);
      problems++;
      continue;
    }
    for (const [prop, value] of Object.entries(decls)) {
      checked++;
      if (TW_INTERNAL(prop)) continue;
      const gotValue = gotDecls[prop];
      if (gotValue === value) continue;
      // A value that merely stopped going through a `--tw-*` indirection is equivalent, so long as
      // the fallback it resolved to is what we now state literally.
      const fallback = /var\(--tw-[a-z-]+,\s*([^)]*(?:\([^)]*\)[^)]*)*)\)/.exec(value);
      if (fallback && gotValue && fallback[1].trim() === gotValue.trim()) continue;
      console.log(`✗ ${file}\n    ${selector}\n      ${prop}:\n        was: ${value}\n        now: ${gotValue ?? '(absent)'}`);
      problems++;
    }
  }
}

console.log(
  problems
    ? `\n[css-equivalence] ${problems} difference(s) across ${checked} declaration(s) — REVIEW EACH`
    : `\n[css-equivalence] ✓ ${checked} declaration(s) equivalent across ${Object.keys(expected).length} file(s)`,
);
process.exit(problems ? 1 : 0);
