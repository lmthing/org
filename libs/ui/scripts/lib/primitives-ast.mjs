/**
 * primitives-ast.mjs — the shared vocabulary the `@lmthing/ui` primitive gates parse against.
 *
 * Two gates ask the same first question — "is this JSX tag a primitives-barrel export, and is that
 * export an RN `Text` or an RN `View` on native?" — and then diverge:
 *
 *   - `lint-rn-text-children.mjs`  a bare string DIRECTLY inside a View (RN drops it entirely)
 *   - `lint-rn-text-inherit.mjs`   a View that styles text its `Text` descendant never restates
 *
 * The lists live here, once. Duplicating them is the specific failure this package has already
 * paid for: `lint-rn-safety.mjs`'s `DEFAULT_DIRS` omitted `elements`/`components` while reporting
 * clean, and 67 violations hid behind the green tick. Two copies of `TEXT_HOSTS` would drift the
 * same way, silently, in the direction of a false negative.
 */
import ts from 'typescript';
import { readdirSync, statSync } from 'node:fs';
import { join, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

/** `libs/ui/src`, anchored to this file so a gate works from any cwd. */
export const uiSrc = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'src');

/**
 * `.web.tsx` and `.native.tsx` are platform forks — a native gate has nothing to say about the web
 * one, and the native one is already written against RN's rules by hand. `.test.tsx` is a fixture.
 */
export const isExempt = (p) =>
  p.endsWith('.web.tsx') || p.endsWith('.native.tsx') || p.endsWith('.test.tsx');

/** Every non-exempt `.tsx` under `dir`, recursively, appended to `out`. */
export function walk(dir, out) {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const name of entries) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (extname(name) === '.tsx' && !isExempt(p)) out.push(p);
  }
  return out;
}

/**
 * Every name the primitives barrel (`elements/primitives/index.ts`) exports that renders a REAL
 * text host on native — i.e. its `.native.tsx` fork is (or wraps) `NativeText`/RN's `Text`, so a
 * bare string child resolves normally and a nested one inherits from it. Established by reading
 * each fork, not guessed: `text/index.native.tsx` (`Text`), `misc.native.tsx` (`Pre` →
 * `NativeText fontFamily="$mono"`), `controls.native.tsx` (`Option` → bare `NativeText`),
 * `table.native.tsx` (`Caption` → `NativeText`), `link/index.native.tsx` (`Link` → `NativeText`
 * with `onPress`/`accessibilityRole="link"` — an anchor is a text-flow element on native too, not a
 * `View`). `SvgText`/`Tspan` (`svg.native.tsx`) alias react-native-svg's `Text`/`TSpan`, which is
 * SVG's own text-rendering primitive (a distinct render tree from RN's View/Text host-component
 * check) and takes raw string children by design — that is the entire reason `Svg`/`Path`/etc. are
 * named to mirror `react-native-svg` in the first place.
 */
export const TEXT_HOSTS = new Set(['Text', 'Pre', 'Option', 'Caption', 'SvgText', 'Tspan', 'Link']);

/**
 * Every OTHER name the barrel exports — every one is an RN `View` (or, for `Br`/`Hr`/`DataList`,
 * renders nothing/a rule and never legitimately takes a text child at all) on native. Kept as an
 * explicit allowlist rather than "not in TEXT_HOSTS" so a future barrel export neither list has
 * been taught about is IGNORED rather than silently mis-classified either way.
 */
export const NON_TEXT_HOSTS = new Set([
  'Box', 'Scroll', 'KeyboardAvoiding', 'Pressable', 'Row', 'Col', 'Image', 'Form',
  'List', 'ListItem', 'TextField', 'TextArea', 'Select', 'Audio', 'Video', 'IFrame',
  'Table', 'Thead', 'Tbody', 'Tfoot', 'Tr', 'Th', 'Td',
  'Svg', 'Path', 'Rect', 'Circle', 'Ellipse', 'Line', 'Polyline', 'Polygon', 'G', 'Defs',
  'LinearGradient', 'RadialGradient', 'Stop', 'Use', 'ClipPath', 'Mask',
  'Br', 'Hr', 'DataList',
]);

/**
 * Resolve JSX tags to primitives-barrel export names using the file's OWN imports — no cross-file
 * resolution, exactly like `lint-rn-safety.mjs`'s "lowercase identifier ⇒ host tag" rule. Handles
 * both `import * as Prim from '.../elements/primitives'` (`Prim.Box`) and a direct named import
 * (`import { Row, Col } from '.../elements/primitives'`, e.g. `chat/app/EmptyState.tsx`) — any local
 * alias, not a hardcoded `Prim`.
 */
export function collectPrimitiveBindings(sf) {
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
export function primitiveNameForTag(tagName, bindings) {
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

/** Has this element a `{...spread}`? Its prop set is then unknowable to a syntax-only gate. */
export const hasSpread = (el) => el.attributes.properties.some((a) => ts.isJsxSpreadAttribute(a));

/** The literal-named attributes on an element, as a Set of prop names. */
export function attrNames(el) {
  const out = new Set();
  for (const a of el.attributes.properties) {
    if (ts.isJsxAttribute(a) && ts.isIdentifier(a.name)) out.add(a.name.text);
  }
  return out;
}
