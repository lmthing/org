#!/usr/bin/env node
/**
 * lint-import-extensions.mjs — no `.js` extension on a relative import of a TypeScript file.
 *
 * `libs/ui` resolves with `moduleResolution: "bundler"` (`@lmthing/config/tsconfig/react-lib`),
 * where the extension is optional — so `from './x.js'` pointing at `x.tsx` is a habit inherited from
 * the NodeNext packages (`core`, `cli`), where it IS required. TypeScript and Vite both accept it.
 *
 * **Metro does not, and does not fall back**: it appends platform extensions to the specifier as
 * written, looks for `x.js`/`x.js.native.tsx`/… , finds nothing, and fails the build outright. That
 * made every `.js` specifier a hard blocker for the React Native port — invisible until a file was
 * added to the native entry, because the surfaces holding them are not ported yet
 * (see `libs/ui/metro/README.md`).
 *
 * This gate keeps them from coming back. `--fix` strips the extension in place, which is how the
 * original 411 were removed.
 *
 * Scope is `libs/ui` ONLY. `core` and `cli` use NodeNext, where dropping the extension would be a
 * genuine error — never point this at them.
 *
 * Usage: node libs/ui/scripts/lint-import-extensions.mjs [--fix] [dir …]   (defaults to ./src)
 */
import ts from 'typescript';
import { readFileSync, writeFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, dirname, extname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const uiRoot = join(dirname(fileURLToPath(import.meta.url)), '..');

const args = process.argv.slice(2);
const fix = args.includes('--fix');
const roots = args.filter((a) => !a.startsWith('--'));
const dirs = roots.length ? roots : [join(uiRoot, 'src')];

function walk(dir, out) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (['.ts', '.tsx'].includes(extname(name))) out.push(p);
  }
  return out;
}

/** The string literals of every relative import/export/`import()` specifier in a source file. */
function specifiers(sourceFile) {
  const found = [];
  const visit = (node) => {
    let literal = null;
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier) {
      literal = node.moduleSpecifier;
    } else if (
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword &&
      node.arguments.length > 0
    ) {
      literal = node.arguments[0];
    }
    if (literal && ts.isStringLiteral(literal) && literal.text.startsWith('.')) found.push(literal);
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return found;
}

const files = [];
for (const d of dirs) walk(resolve(d), files);

const findings = [];
let fixedFiles = 0;

for (const file of files) {
  const src = readFileSync(file, 'utf8');
  const sf = ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  // Collected first, then applied back-to-front so earlier edits cannot shift later positions.
  const edits = [];
  for (const literal of specifiers(sf)) {
    const spec = literal.text;
    if (!spec.endsWith('.js') && !spec.endsWith('.jsx')) continue;
    const target = resolve(dirname(file), spec);
    // A real `.js` file on disk is a real `.js` import — leave it alone.
    if (existsSync(target)) continue;
    const stripped = spec.replace(/\.jsx?$/, '');
    const asTs = resolve(dirname(file), stripped);
    if (!['.ts', '.tsx', '/index.ts', '/index.tsx'].some((ext) => existsSync(asTs + ext))) continue;
    const { line, character } = sf.getLineAndCharacterOfPosition(literal.getStart(sf));
    findings.push({ file, line: line + 1, col: character + 1, spec, stripped });
    edits.push({ start: literal.getStart(sf), end: literal.getEnd(), text: `'${stripped}'` });
  }
  if (fix && edits.length) {
    let next = src;
    for (const edit of edits.sort((a, b) => b.start - a.start)) {
      next = next.slice(0, edit.start) + edit.text + next.slice(edit.end);
    }
    writeFileSync(file, next);
    fixedFiles++;
  }
}

if (fix) {
  console.log(
    `[lint-import-extensions] fixed ${findings.length} specifier(s) in ${fixedFiles} file(s)`,
  );
  process.exit(0);
}
if (findings.length === 0) {
  console.log(`[lint-import-extensions] ✓ no .js specifiers on TS files in ${files.length} files`);
  process.exit(0);
}
for (const f of findings) console.log(`${f.file}:${f.line}:${f.col}  '${f.spec}' → '${f.stripped}'`);
console.error(
  `\n[lint-import-extensions] ✗ ${findings.length} relative import(s) carry a .js extension for a ` +
    `TypeScript file. Metro cannot resolve these and fails the native build outright — it does not ` +
    `fall back to the .ts/.tsx file. Run with --fix. (This applies to libs/ui only; core and cli ` +
    `use NodeNext, where the extension is required.)`,
);
process.exit(1);
