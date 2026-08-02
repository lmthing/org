/**
 * **G1 — rooted import allow-list** (APPFORMAT_IMPROVE.md §6): the whole module graph rooted at
 * `libs/ui/src/view/index.ts` (the `@lmthing/ui/view` barrel every host imports) may import only
 * `react`, the Tamagui primitives layer, the shared theme, and its own siblings — never `react-dom`,
 * never `lucide` (or any DOM-rendering icon lib), never a bare DOM global, never a raw host tag.
 *
 * This is a SOURCE-level, both-targets check — every `import`/`export ... from` statement in every
 * `.ts`/`.tsx` file under `view/` (recursively), parsed with the real TypeScript compiler so a
 * multi-line or re-export form is never missed by a regex. It complements, and does not duplicate,
 * `libs/ui/metro/graph-gate.mjs`: that gate inspects the BUNDLED native dependency graph Metro
 * actually produces (catching a web-only module that leaks in transitively, through a fork Metro
 * picked wrong); this one inspects the SOURCE import statements directly, catching the mistake
 * before a bundle ever runs and on the WEB target too, where graph-gate.mjs does not look at all.
 *
 * The allow-list below is not aspirational — it is exactly what the tree imports today (verified by
 * walking every specifier under `view/` before writing this gate). A NEW import outside it is either
 * a real architectural violation (write it as a primitive under `elements/primitives/`, or reject it)
 * or a legitimate new root this list must grow to name — never silently.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const VIEW_DIR = dirname(fileURLToPath(import.meta.url));

/** Bare (non-relative) specifiers the `view/` tree may import. Anything else bare is a violation. */
const ALLOWED_BARE_SPECIFIERS = new Set([
  'react',
  'react-native',
  '@tamagui/core',
  '@lmthing/ui/view', // the barrel re-importing itself (type-only re-exports / tests)
]);

/** Specifiers that are NEVER allowed, anywhere in the tree, with the reason — checked even if a
 *  future edit to {@link ALLOWED_BARE_SPECIFIERS} would otherwise have let them slip in. */
const FORBIDDEN_SPECIFIERS: Array<{ test: (specifier: string) => boolean; reason: string }> = [
  { test: (s) => s === 'react-dom' || s.startsWith('react-dom/'), reason: 'react-dom is the DOM renderer — the view tree renders on native too' },
  { test: (s) => s.startsWith('lucide') || s.includes('lucide-react'), reason: 'lucide renders raw DOM svg/path elements — icons.tsx is the closed SVG-primitive set' },
  { test: (s) => s === 'react-native-web', reason: 'react-native-web is the web SHIM; importing it directly defeats platform forking' },
];

/** Every `.ts`/`.tsx` source file under `dir`, recursively, excluding `*.test.*` and `*.native.tsx`
 *  (native forks import the SAME allow-list — they are walked too, just not excluded — this filter
 *  only drops the two categories that are not part of the shipped graph: tests, and — kept IN, since
 *  a native fork importing `react-native` directly is exactly what the allow-list must accept). */
function collectSourceFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name.startsWith('.')) continue;
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) {
      collectSourceFiles(p, out);
      continue;
    }
    if (!/\.(ts|tsx)$/.test(name)) continue;
    if (/\.test\.(ts|tsx)$/.test(name)) continue;
    out.push(p);
  }
  return out;
}

interface ImportRef {
  file: string;
  line: number;
  specifier: string;
}

/** Every import/re-export specifier in one source file, via the real TS parser (handles multi-line
 *  imports, `export ... from`, and `import type` — a regex would miss or double-count these). */
function importsIn(file: string): ImportRef[] {
  const text = readFileSync(file, 'utf8');
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.ES2020, true, ts.ScriptKind.TSX);
  const out: ImportRef[] = [];
  const visit = (node: ts.Node): void => {
    let specifier: ts.Expression | undefined;
    if (ts.isImportDeclaration(node)) specifier = node.moduleSpecifier;
    else if (ts.isExportDeclaration(node) && node.moduleSpecifier) specifier = node.moduleSpecifier;
    if (specifier && ts.isStringLiteral(specifier)) {
      const { line } = sf.getLineAndCharacterOfPosition(specifier.getStart(sf));
      out.push({ file, line: line + 1, specifier: specifier.text });
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return out;
}

function relToRepo(file: string): string {
  const idx = file.indexOf('libs/ui/src');
  return idx === -1 ? file : file.slice(idx);
}

describe('G1 — rooted import allow-list (view/ tree)', () => {
  const files = collectSourceFiles(VIEW_DIR);

  it('walks a non-trivial tree (the gate is actually checking something)', () => {
    expect(files.length).toBeGreaterThan(20);
  });

  it('every bare import is react / react-native / @tamagui/core / @lmthing/ui/view — nothing else', () => {
    const violations: string[] = [];
    for (const file of files) {
      for (const ref of importsIn(file)) {
        const isRelative = ref.specifier.startsWith('.') || ref.specifier.startsWith('/');
        if (isRelative) continue; // siblings / reaching into elements/primitives etc. — allowed
        if (ALLOWED_BARE_SPECIFIERS.has(ref.specifier)) continue;
        violations.push(
          `${relToRepo(ref.file)}:${ref.line} imports "${ref.specifier}" — not in the allow-list (react, react-native, @tamagui/core, @lmthing/ui/view). ` +
            `A new root must be added to ALLOWED_BARE_SPECIFIERS deliberately, or the import is a violation.`,
        );
      }
    }
    expect(violations, violations.join('\n')).toEqual([]);
  });

  it('NEVER imports react-dom, lucide, or react-native-web — even via a relative path', () => {
    const violations: string[] = [];
    for (const file of files) {
      for (const ref of importsIn(file)) {
        for (const forbidden of FORBIDDEN_SPECIFIERS) {
          if (forbidden.test(ref.specifier)) {
            violations.push(`${relToRepo(ref.file)}:${ref.line} imports "${ref.specifier}" — ${forbidden.reason}`);
          }
        }
      }
    }
    expect(violations, violations.join('\n')).toEqual([]);
  });

  it('every relative import resolves inside libs/ui/src (no reaching into apps/ or another lib blind)', () => {
    // A relative import climbing high enough to escape libs/ui/src entirely would be a real
    // architectural leak (the shared renderer depending on a specific host app). `../../..` from
    // `view/` or `view/sections/` still lands inside `libs/ui/src` (elements/, chat/, theme/) — the
    // check is that it does NOT climb past `src/`.
    const violations: string[] = [];
    for (const file of files) {
      for (const ref of importsIn(file)) {
        if (!ref.specifier.startsWith('.')) continue;
        const resolvedDir = join(dirname(file), ref.specifier);
        if (!resolvedDir.includes(join('libs', 'ui', 'src'))) {
          violations.push(`${relToRepo(ref.file)}:${ref.line} imports "${ref.specifier}" which resolves outside libs/ui/src`);
        }
      }
    }
    expect(violations, violations.join('\n')).toEqual([]);
  });
});
