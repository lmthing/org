#!/usr/bin/env node
/**
 * lint-rn-text-children.mjs — the "no bare text in a View" gate.
 *
 * React Native raises "Text strings must be rendered within a `<Text>` component" and then DROPS
 * the string — a bare JSX text child, or a string/number/template-literal expression, sitting
 * directly under a primitive that is an RN `View` (`Prim.Box`/`Row`/`Col`/`Pressable`/`List`/
 * `ListItem`/… — anything in the barrel that is not a text host). On web the identical markup is
 * ordinary and correct (a `<span>` inherits from its container), so `tsc`, jsdom and the Metro
 * resolution gate are all happy; only a device — or the native render suites in `metro/suites/` —
 * ever sees the drop. `labelled()` (`elements/primitives/labelled.tsx`) is the fix at the four
 * leaves it already covers; everywhere else in `libs/ui/src` this gate is the only thing watching.
 *
 * AST-based (not regex), so a string inside a comment, a generic constraint or an unrelated string
 * literal never false-positives — same approach as `lint-rn-safety.mjs`, which this is modelled on
 * (including that script's own scar: its `DEFAULT_DIRS` once omitted `elements`/`components` and 67
 * violations hid behind a clean report). This gate does not take a directory allowlist at all — it
 * walks the whole of `libs/ui/src`, because the bug is a primitive-usage property, not a
 * surface-boundary one.
 *
 * ## What it deliberately does NOT flag (and why a type-checker would over/under-reach here)
 *
 * Only three literal SHAPES are flagged: a string, a number, a template literal, or a `?:` whose
 * branches (recursively) reduce to one of those — never a bare identifier or property access
 * (`{tab.label}`, `{children}`, `{icon}`). A component's own `children` or a `ReactNode`-typed prop
 * being handed straight to a View is the SAME bug class when the caller happens to pass a string,
 * but nothing in the syntax tells us that without full program type-checking (and a `ReactNode`
 * union is `string | number | ReactElement | …`, so even a checker can't tell "always a string" from
 * "sometimes an icon" without inlining every call site). Those cases are real and have to be found
 * by reading — see `elements/nav/tab-bar/index.tsx`'s `{tab.label}` and `chat/app/common.tsx`'s
 * `Tabs`, both fixed by hand alongside this gate's own findings, not by it.
 *
 * Usage: node libs/ui/scripts/lint-rn-text-children.mjs [dir …]   (defaults to the whole of `src`)
 */
import ts from 'typescript';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const uiSrc = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');
const DEFAULT_DIRS = [uiSrc];

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

/**
 * Every name the primitives barrel (`elements/primitives/index.ts`) exports that renders a REAL
 * text host on native — i.e. its `.native.tsx` fork is (or wraps) `NativeText`/RN's `Text`, so a
 * bare string child resolves normally. Established by reading each fork, not guessed:
 * `text/index.native.tsx` (`Text`), `misc.native.tsx` (`Pre` → `NativeText fontFamily="$mono"`),
 * `controls.native.tsx` (`Option` → bare `NativeText`), `table.native.tsx` (`Caption` → `NativeText`),
 * `link/index.native.tsx` (`Link` → `NativeText` with `onPress`/`accessibilityRole="link"` — an
 * anchor is a text-flow element on native too, not a `View`).
 * `SvgText`/`Tspan` (`svg.native.tsx`) alias react-native-svg's `Text`/`TSpan`, which is SVG's own
 * text-rendering primitive (a distinct render tree from RN's View/Text host-component check) and
 * takes raw string children by design — that is the entire reason `Svg`/`Path`/etc. are named to
 * mirror `react-native-svg` in the first place.
 */
const TEXT_HOSTS = new Set(['Text', 'Pre', 'Option', 'Caption', 'SvgText', 'Tspan', 'Link']);

/**
 * Every OTHER name the barrel exports — every one is an RN `View` (or, for `Br`/`Hr`/`DataList`,
 * renders nothing/a rule and never legitimately takes a text child at all) on native. A bare string
 * under any of these is the bug this gate exists to catch. Kept as an explicit allowlist rather than
 * "not in TEXT_HOSTS" so a future barrel export that this list has not been taught about is ignored
 * rather than silently mis-classified either way — see the exhaustiveness note in `classify()`.
 */
const NON_TEXT_HOSTS = new Set([
  'Box', 'Scroll', 'KeyboardAvoiding', 'Pressable', 'Row', 'Col', 'Image', 'Form',
  'List', 'ListItem', 'TextField', 'TextArea', 'Select', 'Audio', 'Video', 'IFrame',
  'Table', 'Thead', 'Tbody', 'Tfoot', 'Tr', 'Th', 'Td',
  'Svg', 'Path', 'Rect', 'Circle', 'Ellipse', 'Line', 'Polyline', 'Polygon', 'G', 'Defs',
  'LinearGradient', 'RadialGradient', 'Stop', 'Use', 'ClipPath', 'Mask',
  'Br', 'Hr', 'DataList',
]);

/** Strip `(expr)` wrappers so `(a ? b : c)` reads the same as `a ? b : c`. */
function unwrapParens(node) {
  while (node && ts.isParenthesizedExpression(node)) node = node.expression;
  return node;
}

/**
 * Does this expression provably yield a bare string/number — the shape that DROPS on a device?
 * Recurses through `?:` because either branch may fire at runtime; does NOT recurse into a call
 * (`labelled(x)`, `preview(x)`, a `.map(...)`) or a bare identifier/property access — see the
 * module docstring for why those are out of scope for a syntax-only gate.
 */
function isBareTextExpression(node) {
  const e = unwrapParens(node);
  if (!e) return false;
  if (ts.isStringLiteral(e) || ts.isNoSubstitutionTemplateLiteral(e)) return e.text.trim() !== '';
  if (ts.isNumericLiteral(e)) return true;
  if (ts.isTemplateExpression(e)) return true; // `${x} of ${y}` — always renders as a string
  if (ts.isConditionalExpression(e)) return isBareTextExpression(e.whenTrue) || isBareTextExpression(e.whenFalse);
  return false;
}

/** A short, human label for what tripped the gate. */
function describe(node) {
  const e = unwrapParens(node);
  if (ts.isConditionalExpression(e)) return `?: → ${describe(e.whenTrue)} | ${describe(e.whenFalse)}`;
  return e.getText();
}

/**
 * Resolve a JSX tag to a primitives-barrel export name, from the file's own imports — no cross-file
 * resolution, exactly like `lint-rn-safety.mjs`'s "lowercase identifier ⇒ host tag" rule. Handles
 * both `import * as Prim from '.../elements/primitives'` (`Prim.Box`) and a direct named import
 * (`import { Row, Col } from '.../elements/primitives'`, e.g. `chat/app/EmptyState.tsx`) — any local
 * alias, not a hardcoded `Prim`.
 */
function collectPrimitiveBindings(sf) {
  const namespaces = new Set();
  const named = new Map(); // local name -> exported primitive name
  for (const stmt of sf.statements) {
    if (!ts.isImportDeclaration(stmt) || !stmt.importClause) continue;
    if (!ts.isStringLiteral(stmt.moduleSpecifier)) continue;
    if (!stmt.moduleSpecifier.text.includes('elements/primitives')) continue;
    const bindings = stmt.importClause.namedBindings;
    if (bindings && ts.isNamespaceImport(bindings)) {
      namespaces.add(bindings.name.text);
    } else if (bindings && ts.isNamedImports(bindings)) {
      for (const el of bindings.elements) {
        named.set(el.name.text, (el.propertyName ?? el.name).text);
      }
    }
  }
  return { namespaces, named };
}

/** The barrel export name a JSX tag refers to, or `undefined` if it isn't a primitives import. */
function primitiveNameForTag(tagName, bindings) {
  if (ts.isIdentifier(tagName)) return bindings.named.get(tagName.text);
  if (
    ts.isPropertyAccessExpression(tagName) &&
    ts.isIdentifier(tagName.expression) &&
    bindings.namespaces.has(tagName.expression.text)
  ) {
    return tagName.name.text;
  }
  return undefined;
}

const roots = process.argv.slice(2);
const dirs = roots.length ? roots : DEFAULT_DIRS;
const files = [];
for (const d of dirs) walk(d, files);

const findings = [];
for (const file of files) {
  const src = readFileSync(file, 'utf8');
  const sf = ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const bindings = collectPrimitiveBindings(sf);
  if (bindings.namespaces.size === 0 && bindings.named.size === 0) continue; // no primitives import at all

  const visit = (node) => {
    if (ts.isJsxElement(node)) {
      const primName = primitiveNameForTag(node.openingElement.tagName, bindings);
      // Exhaustiveness: TEXT_HOSTS ∪ NON_TEXT_HOSTS is the FULL barrel export list (checked against
      // `elements/primitives/index.ts` by hand). A name resolved from a primitives import that is in
      // neither set means the barrel grew a member this gate has not been taught about — silently
      // skipping is the safe default (a false negative to fix here beats a flood of false positives).
      if (primName && NON_TEXT_HOSTS.has(primName)) {
        for (const child of node.children) {
          if (ts.isJsxText(child)) {
            if (child.containsOnlyTriviaWhiteSpaces) continue;
            const { line, character } = sf.getLineAndCharacterOfPosition(child.getStart(sf));
            // NOT trimmed for display: TS's own `containsOnlyTriviaWhiteSpaces` (used above to
            // decide whether to flag at all) treats a same-line inter-expression space as
            // SIGNIFICANT JSX content, not throwaway indentation — trimming here would print an
            // empty string for exactly the findings that are real (see the module docstring).
            findings.push({
              file, line: line + 1, col: character + 1, tag: primName,
              kind: 'bare-jsx-text', detail: JSON.stringify(child.text),
            });
          } else if (ts.isJsxExpression(child) && child.expression) {
            if (isBareTextExpression(child.expression)) {
              const { line, character } = sf.getLineAndCharacterOfPosition(child.expression.getStart(sf));
              findings.push({
                file, line: line + 1, col: character + 1, tag: primName,
                kind: 'bare-jsx-expression', detail: describe(child.expression),
              });
            }
          }
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
}

if (findings.length === 0) {
  console.log(`[lint-rn-text-children] ✓ no bare text children in a View, across ${files.length} files`);
  process.exit(0);
}
for (const f of findings) {
  console.log(`${f.file}:${f.line}:${f.col}  ${f.kind}  <${f.tag}> ${f.detail}`);
}
console.error(
  `\n[lint-rn-text-children] ✗ ${findings.length} bare text child(ren) of a non-text primitive. ` +
    `Wrap in <Prim.Text> (restating any container styling the container itself cannot pass down — ` +
    `see primitives/_native.tsx#NativeText) or route through labelled(). ` +
    `See elements/primitives/labelled.tsx and metro/suites/string-children.tsx.`,
);
process.exit(1);
