#!/usr/bin/env node
/**
 * css-computed-equivalence.mjs — the real gate for the Tailwind deletion.
 *
 * `css-equivalence.mjs` compares declaration TEXT, which is enough for inlining `@apply` verbatim but
 * useless once we deliberately rewrite values (resolving `var(--tw-shadow)` chains and Tailwind's own
 * `--spacing`/`--text-sm` theme variables down to literals). The text is *supposed* to change; what
 * must not change is what the browser computes.
 *
 * So this asks a browser. For each stylesheet it builds two pages — one with the CSS Tailwind
 * compiles from the current source, one with the CSS after rewriting — renders a probe element for
 * every selector, and diffs `getComputedStyle` across the audited property set.
 *
 * It is independent of the rewriting logic: a bug in the resolver cannot hide here, because the
 * "before" side never goes through it.
 *
 * Usage: node libs/css/scripts/css-computed-equivalence.mjs <before-dir> <file.css> …
 *   where <before-dir> holds `<slug>.css` snapshots produced by --snapshot.
 *        node libs/css/scripts/css-computed-equivalence.mjs --snapshot <dir> <file.css> …
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve, relative, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:http';

const HERE = dirname(fileURLToPath(import.meta.url));
const ORG = resolve(HERE, '../../..');
const require = createRequire(resolve(HERE, '../../cli/package.json'));
const { compile } = await import(`file://${require.resolve('@tailwindcss/node')}`);
// `playwright` is not a direct dependency of any workspace package — resolve the pnpm-store copy the
// same way `apps/web/tests/visual-surface/capture.mjs` does.
const { chromium } = await import(
  new URL('../../../node_modules/.pnpm/playwright@1.61.1/node_modules/playwright/index.mjs', import.meta.url).href
);

const EXECUTABLE = process.env.PW_CHROMIUM || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';

/** Same audited set as the P0 harness, plus the properties the deletion is most likely to break. */
const PROPS = [
  'display', 'position', 'box-sizing', 'width', 'height', 'min-width', 'min-height', 'max-width', 'max-height',
  'margin-top', 'margin-right', 'margin-bottom', 'margin-left',
  'padding-top', 'padding-right', 'padding-bottom', 'padding-left',
  'border-top-width', 'border-right-width', 'border-bottom-width', 'border-left-width',
  'border-top-style', 'border-left-style',
  'border-top-color', 'border-right-color', 'border-bottom-color', 'border-left-color',
  'border-top-left-radius', 'border-top-right-radius', 'border-bottom-left-radius', 'border-bottom-right-radius',
  'flex-direction', 'flex-wrap', 'flex-grow', 'flex-shrink', 'flex-basis',
  'align-items', 'align-self', 'justify-content', 'gap', 'grid-template-columns', 'grid-template-rows',
  'color', 'background-color', 'background-image', 'opacity',
  // the ones the `--tw-*` chains carry, and the whole reason this gate exists
  'box-shadow', 'outline-color', 'outline-width', 'outline-style',
  'font-family', 'font-size', 'font-weight', 'font-style', 'line-height', 'letter-spacing',
  'text-align', 'text-transform', 'text-decoration-line', 'text-overflow',
  'white-space', 'overflow-x', 'overflow-y', 'overflow-wrap', 'word-break',
  'cursor', 'pointer-events', 'user-select', 'z-index',
  'transition-property', 'transition-duration', 'transition-timing-function',
  'animation-name', 'animation-duration', 'animation-iteration-count',
  'rotate', 'translate', 'scale', 'list-style-type', 'text-underline-offset', 'border-collapse',
];

const NEEDS_TAILWIND = /@(apply|reference|theme|source|custom-variant|utility|variant)\b|@import\s+["']tailwindcss/;

async function toCss(file) {
  const src = readFileSync(file, 'utf8');
  if (!NEEDS_TAILWIND.test(src.replace(/\/\*[\s\S]*?\*\//g, ''))) return src;
  const compiler = await compile(src, { base: dirname(file), onDependency: () => {} });
  return compiler.build([]);
}

/**
 * Collect renderable selectors. A rule like `.a .b:hover` becomes a probe whose OUTER element
 * carries `a` and inner carries `b`, with `:hover`/`:focus`/`::marker` etc. recorded as UNCOVERED —
 * we cannot force those states here, and claiming otherwise would be worse than reporting the gap.
 */
function selectors(css) {
  const s = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const found = new Map(); // selector text → { chain: string[][], uncovered: boolean }
  const uncovered = new Set();
  const re = /(^|[};])\s*([^{}@][^{}]*?)\s*\{/g;
  let m;
  while ((m = re.exec(s))) {
    for (const raw of m[2].split(',')) {
      const sel = raw.trim().replace(/\s+/g, ' ');
      if (!sel || sel.startsWith('@') || sel.includes('&')) continue;
      if (/^(html|body|:root|\*)\b/.test(sel)) continue;
      if (/[:>+~[]/.test(sel)) { uncovered.add(sel); continue; }
      const parts = sel.split(' ').map((p) => p.match(/\.[A-Za-z0-9_-]+/g)).filter(Boolean);
      if (!parts.length || parts.length !== sel.split(' ').length) { uncovered.add(sel); continue; }
      found.set(sel, parts.map((cls) => cls.map((c) => c.slice(1))));
    }
  }
  return { found, uncovered };
}

/**
 * lmthing's tokens, so `var(--brand-3)` resolves inside the probe. Without them a `color-mix()` on a
 * token is INVALID, and the two sides fail differently — Tailwind's `--tw-ring-color` chain falls back
 * to `currentcolor` while a resolved literal invalidates the whole declaration. That is an artefact of
 * the probe, not a real difference, and it masked the real ones.
 */
const TOKENS = (() => {
  const themeCss = readFileSync(resolve(HERE, '../src/theme.css'), 'utf8');
  const root = [...themeCss.matchAll(/(?:^|\n):root\s*\{([\s\S]*?)\n\}/g)].map((m) => m[1]).join('\n');
  const inline = [...themeCss.matchAll(/@theme(?:\s+inline)?\s*\{([\s\S]*?)\n\}/g)].map((m) => m[1]).join('\n');
  return `:root {\n${root}\n${inline}\n}`;
})();

function page(css, probes) {
  const body = probes
    .map(([sel, chain], i) => {
      let html = `<div data-probe="${i}" class="${chain[chain.length - 1].join(' ')}">x</div>`;
      for (let d = chain.length - 2; d >= 0; d--) html = `<div class="${chain[d].join(' ')}">${html}</div>`;
      return html;
    })
    .join('\n');
  return `<!doctype html><html><head><meta charset="utf-8"><style>\n${TOKENS}\n</style><style>\n${css}\n</style></head><body>${body}</body></html>`;
}

async function measure(browser, css, probes) {
  const p = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await p.setContent(page(css, probes), { waitUntil: 'load' });
  const out = await p.evaluate((props) => {
    const r = {};
    for (const el of document.querySelectorAll('[data-probe]')) {
      const cs = getComputedStyle(el);
      const o = {};
      for (const prop of props) o[prop] = cs.getPropertyValue(prop);
      r[el.getAttribute('data-probe')] = o;
    }
    return r;
  }, PROPS);
  await p.close();
  return out;
}

const snapshotMode = process.argv[2] === '--snapshot';
const dir = snapshotMode ? process.argv[3] : process.argv[2];
const files = process.argv.slice(snapshotMode ? 4 : 3);
if (!dir || !files.length) {
  console.error('usage: css-computed-equivalence.mjs [--snapshot] <dir> <file.css> …');
  process.exit(2);
}
const slug = (f) => relative(ORG, f).replace(/[/.]/g, '_');

if (snapshotMode) {
  mkdirSync(dir, { recursive: true });
  for (const f of files) writeFileSync(join(dir, `${slug(f)}.css`), await toCss(f));
  console.log(`[computed-equivalence] snapshot: ${files.length} compiled stylesheet(s) → ${relative(ORG, dir)}`);
  process.exit(0);
}

/**
 * The ONE intentional computed difference the rewrite makes. Tailwind always composes five shadow
 * layers (`--tw-inset-shadow`, `--tw-ring-shadow`, …), defaulting the unused ones to `0 0 #0000` —
 * fully transparent with zero geometry, i.e. painting nothing. `resolve-tw-vars.mjs` drops them, so
 * both sides are normalised by removing transparent zero-size layers before comparing. Anything that
 * actually paints still has to match exactly.
 */
function norm(prop, value) {
  // `transition-property` listed Tailwind's own `--tw-gradient-*` custom properties so gradients could
  // animate. Those properties do not exist without Tailwind, so naming them transitions nothing —
  // dropping them is intentional and changes no rendered behaviour.
  if (prop === 'transition-property' && value) {
    return value.split(',').map((p) => p.trim()).filter((p) => !p.startsWith('--tw-')).join(', ');
  }
  if (prop !== 'box-shadow' || !value) return value;
  const layers = value
    .split(/,(?![^(]*\))/)
    .map((l) => l.trim())
    .filter((l) => l && !/^rgba\(0,\s*0,\s*0,\s*0\)\s+0px\s+0px\s+0px\s+0px$/.test(l));
  return layers.length ? layers.join(', ') : 'none';
}

const browser = await chromium.launch({ executablePath: EXECUTABLE });
let problems = 0;
let compared = 0;
const gaps = new Set();

for (const f of files) {
  const beforePath = join(dir, `${slug(f)}.css`);
  if (!existsSync(beforePath)) {
    console.log(`✗ ${relative(ORG, f)}: no snapshot — run --snapshot on the pre-change tree first`);
    problems++;
    continue;
  }
  const before = readFileSync(beforePath, 'utf8');
  const after = await toCss(f);
  const { found, uncovered } = selectors(before);
  for (const u of uncovered) gaps.add(`${relative(ORG, f)}  ${u}`);
  if (!found.size) continue;
  const probes = [...found.entries()];

  const [a, b] = [await measure(browser, before, probes), await measure(browser, after, probes)];
  for (let i = 0; i < probes.length; i++) {
    const [sel] = probes[i];
    for (const prop of PROPS) {
      compared++;
      if (norm(prop, a[i]?.[prop]) === norm(prop, b[i]?.[prop])) continue;
      console.log(`✗ ${relative(ORG, f)}\n    ${sel}  ${prop}\n      was: ${a[i]?.[prop]}\n      now: ${b[i]?.[prop]}`);
      problems++;
    }
  }
}
await browser.close();

if (gaps.size) {
  console.log(`\n[computed-equivalence] ${gaps.size} selector(s) NOT covered (pseudo-class/combinator — cannot force state here):`);
  for (const g of [...gaps].slice(0, 12)) console.log(`    ${g}`);
  if (gaps.size > 12) console.log(`    … and ${gaps.size - 12} more`);
}
console.log(
  problems
    ? `\n[computed-equivalence] ${problems} computed difference(s) across ${compared} comparison(s)`
    : `\n[computed-equivalence] ✓ ${compared} computed value(s) identical`,
);
process.exit(problems ? 1 : 0);
