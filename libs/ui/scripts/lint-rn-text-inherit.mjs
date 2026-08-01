#!/usr/bin/env node
/**
 * lint-rn-text-inherit.mjs — the "a View has no text style to inherit FROM" gate.
 *
 * The quieter half of the bare-string bug that `lint-rn-text-children.mjs` catches. On web,
 * `<div style="font-size:11px; color:var(--muted-foreground)"><span>hi</span></div>` renders `hi`
 * small and muted: CSS text properties are INHERITED, so a container is a perfectly good place to
 * put them, and this codebase does that everywhere because it started as web. On native the same
 * markup is a `<View>` wrapping a `<Text>`, and:
 *
 *   - RN has no cascade. A `View`'s `fontSize`/`color` are simply not consulted for a child `Text`.
 *   - `NativeText` (`elements/primitives/_native.tsx#NativeText`) carries UNCONDITIONAL
 *     `fontFamily: '$body'` and `color: '$foreground'` defaults, because a `Text` with neither would
 *     render at the platform default face and near-black ink. Those defaults are what makes ordinary
 *     text work — and they are also what makes this bug SHAPE-PRESERVING: the leaf does not render
 *     blank, it renders in the wrong size, face or colour.
 *
 * So this is the failure mode nothing catches. The layout is right, the text is there, and every
 * gate is green — a `running` activity chip's label was `$foreground` at body size instead of
 * `$brand-2` at `$xs`, and the whole point of a status chip is that its colour IS the status. It
 * needs a machine to find, because a human reading either file sees correct-looking code.
 *
 * ## What it flags
 *
 * A TEXT_HOST (`Prim.Text`, `Prim.Pre`, …) with a NON_TEXT_HOST ancestor that sets a text-style prop
 * the text host does not itself restate. Ancestors ACCUMULATE — a nested `View` inherits nothing but
 * blocks nothing either, so `<Box fontSize="$xs"><Box><Text/></Box></Box>` is a finding, which is
 * exactly the `chat/app/inspector.tsx` k/v-pair shape a direct-child-only check misses. Descent
 * stops at the first text host: nested `Text` DOES inherit from `Text` on native, so
 * `<Text fontFamily="$mono"><Text>x</Text></Text>` is correct and silent.
 *
 * ## What it deliberately does NOT flag
 *
 *   - Any element in the chain with a `{...spread}` — its prop set is unknowable to a syntax-only
 *     gate, and guessing produces the one thing a gate must not have: noise that gets it disabled.
 *   - `textAlign`/`lineHeight` as inherited-from props. `textAlign` on a `View` is not text styling
 *     at all on native — it does nothing there, and the alignment a caller wants is `alignItems`, a
 *     separate bug this gate would only confuse. `lineHeight` on a container is almost always meant
 *     for the box's own rhythm.
 *   - Whether the value is CORRECT. `<Box color="$a"><Text color="$b">` passes: restating a
 *     different value is a deliberate override, and only the author knows which was meant.
 *
 * Usage: node libs/ui/scripts/lint-rn-text-inherit.mjs [dir …]   (defaults to the whole of `src`)
 */
import ts from 'typescript';
import { readFileSync } from 'node:fs';
import {
  uiSrc, walk, TEXT_HOSTS, NON_TEXT_HOSTS, collectPrimitiveBindings, primitiveNameForTag, hasSpread,
  attrNames,
} from './lib/primitives-ast.mjs';

const DEFAULT_DIRS = [uiSrc];

/**
 * The props that style TEXT and therefore need restating on the leaf. `textAlign` and `lineHeight`
 * are excluded on purpose — see the module docstring.
 */
const INHERITED_TEXT_PROPS = [
  'fontFamily', 'fontSize', 'fontWeight', 'fontStyle', 'color', 'letterSpacing', 'textTransform',
];

/**
 * Text hosts a caller CANNOT restate a face on, so reporting them produces an instruction nobody can
 * follow. `Prim.Option`'s props are `React.OptionHTMLAttributes<HTMLOptionElement>`
 * (`elements/primitives/controls.tsx#OptionProps`) — no style props at all, deliberately, because it
 * is documented there as a pure host passthrough. Its native fork IS a `NativeText`
 * (`controls.native.tsx#Option`), so the drop is real: `chat/app/replay.tsx`'s `1×/2×/4×/8×` speeds
 * render in body ink at body size on a phone rather than the `Select`'s `11px` muted.
 *
 * It is not fixed here because the native `Select` is a PLACEHOLDER — `controls.native.tsx`'s own
 * header says "a real native picker is a follow-up" — so it renders as a `View` with its options
 * stacked underneath and is not a working control on a phone at all. Facing its labels correctly
 * would be polish on something that does not function; the fix is the picker, and then this
 * exclusion goes.
 */
const UNSTYLEABLE_HOSTS = new Set(['Option']);

const roots = process.argv.slice(2);
const files = [];
for (const d of (roots.length ? roots : DEFAULT_DIRS)) walk(d, files);

const findings = [];
for (const file of files) {
  const sf = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const bindings = collectPrimitiveBindings(sf);
  if (bindings.namespaces.size === 0 && bindings.named.size === 0) continue;

  /**
   * Descend carrying `inherited`: prop name -> the container that set it. `blocked` is set once any
   * ancestor in the chain spreads, because from there down we cannot know what is or is not set.
   */
  const visit = (node, inherited, blocked) => {
    if (ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node)) {
      const open = ts.isJsxElement(node) ? node.openingElement : node;
      const prim = primitiveNameForTag(open.tagName, bindings);
      const spread = hasSpread(open);

      if (prim && TEXT_HOSTS.has(prim)) {
        // A text host with NOTHING IN IT cannot be rendering text, so it has no face to get wrong.
        // These exist as layout: `render-descriptor`'s divider drew its two rules as childless
        // `Prim.Text`s with a `borderTopWidth`, and `ide-file-tree`'s 16px spacer lined a file up
        // under the folder chevrons. Reporting them invites the fix that answers the gate — paste a
        // `fontSize` onto a span that renders no glyph — rather than the fix that is right, which is
        // that a box holding no text is a `Prim.Box`. (Both are now Boxes; this keeps the next one
        // from being talked into the wrong shape.)
        const empty = !ts.isJsxElement(node) ||
          node.children.every((c) => ts.isJsxText(c) && c.containsOnlyTriviaWhiteSpaces);
        if (!blocked && !spread && !empty && !UNSTYLEABLE_HOSTS.has(prim) && inherited.size) {
          const own = attrNames(open);
          const missing = [...inherited].filter(([p]) => !own.has(p));
          if (missing.length) {
            const { line, character } = sf.getLineAndCharacterOfPosition(open.getStart(sf));
            findings.push({
              file, line: line + 1, col: character + 1, tag: prim,
              detail: missing.map(([p, from]) => `${p} (from <${from}>)`).join(', '),
            });
          }
        }
        // A nested text host inherits from this one on native — stop accumulating, and stop
        // reporting, for everything below.
        for (const child of ts.isJsxElement(node) ? node.children : []) visit(child, new Map(), true);
        return;
      }

      let next = inherited;
      if (prim && NON_TEXT_HOSTS.has(prim)) {
        next = new Map(inherited);
        for (const p of INHERITED_TEXT_PROPS) if (attrNames(open).has(p)) next.set(p, prim);
      }
      // A non-primitive component (`<Button>`, `<AgentCard>`) is opaque: it may render a `Text` that
      // handles its own face, and its props are its own API rather than styles on a host. Neither
      // accumulate from it nor reset — pass what we have through, which is what web does.
      const nextBlocked = blocked || spread;
      for (const child of ts.isJsxElement(node) ? node.children : []) visit(child, next, nextBlocked);
      // Attribute VALUES can hold JSX (`icon={<Prim.Text/>}`, `renderRow={() => …}`). That JSX is not
      // rendered inside this element, so it starts clean.
      for (const a of open.attributes.properties) visit(a, new Map(), blocked);
      return;
    }
    ts.forEachChild(node, (c) => visit(c, inherited, blocked));
  };
  visit(sf, new Map(), false);
}

if (findings.length === 0) {
  console.log(`[lint-rn-text-inherit] ✓ every text leaf restates its container's text styling, across ${files.length} files`);
  process.exit(0);
}
for (const f of findings) {
  console.log(`${f.file}:${f.line}:${f.col}  unrestated-text-style  <${f.tag}> missing ${f.detail}`);
}
console.error(
  `\n[lint-rn-text-inherit] ✗ ${findings.length} text leaf(s) relying on CSS inheritance that RN does ` +
    `not have. Restate the prop on the text host (see primitives/_native.tsx#NativeText for why its ` +
    `unconditional $body/$foreground defaults make this shape-preserving and therefore invisible), ` +
    `or move the style off the container. Guarded by metro/suites/text-styling.tsx.`,
);
process.exit(1);
