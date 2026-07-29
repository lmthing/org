#!/usr/bin/env node
/**
 * lint-rn-safety.mjs — the RN-safety / no-raw-HTML gate (Tamagui migration, Part I §8).
 *
 * Forbids EVERY raw JSX host tag (lowercase intrinsic element) in the de-HTML'd surfaces —
 * libs/ui/src/{chat,studio,computer}. Those surfaces may only use @lmthing/ui components, so
 * they stay universal / RN-safe as the code evolves. This is the enforcement backbone that
 * makes Phase 0 stick (and keeps future features from re-introducing raw tags).
 *
 * The ONE exception is the designated web-only widget files (`*.web.tsx`, e.g. the Monaco
 * editor) — see §1.6 — which are allowed their web deps and host tags. `.native.tsx` and
 * `.test.tsx` files are also skipped (native forks / test fixtures, not shipped web surface).
 *
 * AST-based (not regex), so host tags inside strings/generics/comments never false-positive.
 *
 * Usage: node libs/ui/scripts/lint-rn-safety.mjs [dir …]   (defaults to the three surfaces)
 */
import ts from 'typescript';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// Anchored to this script's location (libs/ui/scripts/) so it works from any cwd — e.g. both
// `node libs/ui/scripts/lint-rn-safety.mjs` (repo root) and `pnpm --filter @lmthing/ui lint:rn`.
const uiSrc = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');
// `elements` and `components` were NOT in this list, which is how `sidebar-footer`, the `settings`
// panels and the `auth` widgets kept 67 raw host tags while the gate reported clean — and
// `elements/**` is the shared vocabulary layer, the part that most has to be RN-safe.
const DEFAULT_DIRS = [
  join(uiSrc, 'chat'), join(uiSrc, 'studio'), join(uiSrc, 'computer'),
  join(uiSrc, 'elements'), join(uiSrc, 'components'), join(uiSrc, 'view'),
];

const isExempt = (p) =>
  p.endsWith('.web.tsx') || p.endsWith('.native.tsx') || p.endsWith('.test.tsx');

function walk(dir, out) {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  for (const name of entries) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, out);
    else if (extname(name) === '.tsx' && !isExempt(p)) out.push(p);
  }
}

const roots = process.argv.slice(2);
const dirs = roots.length ? roots : DEFAULT_DIRS;
const files = [];
for (const d of dirs) walk(d, files);

const findings = [];
for (const file of files) {
  const src = readFileSync(file, 'utf8');
  const sf = ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const visit = (node) => {
    if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
      const t = node.tagName;
      // A lowercase-first JSX identifier IS a host/intrinsic element (React convention).
      if (ts.isIdentifier(t) && /^[a-z]/.test(t.text)) {
        const { line, character } = sf.getLineAndCharacterOfPosition(t.getStart(sf));
        findings.push({ file, line: line + 1, col: character + 1, tag: t.text });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
}

if (findings.length === 0) {
  console.log(`[lint-rn-safety] ✓ no raw host tags in ${files.length} surface files`);
  process.exit(0);
}
for (const f of findings) console.log(`${f.file}:${f.line}:${f.col}  raw-host-tag  <${f.tag}>`);
console.error(
  `\n[lint-rn-safety] ✗ ${findings.length} raw host tag(s). Surfaces must use @lmthing/ui ` +
    `components (elements/primitives/*), not raw JSX host tags. See ` +
    `docs/react-native-tamagui-migration.md §8. (Web-only widgets belong in a *.web.tsx file.)`,
);
process.exit(1);
