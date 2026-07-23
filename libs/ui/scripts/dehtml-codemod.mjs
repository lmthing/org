#!/usr/bin/env node
/**
 * dehtml-codemod.mjs — the Phase-0 de-HTML codemod (Tamagui migration, Part I §7).
 *
 * Rewrites every raw JSX host tag in a surface file (chat/studio/computer) to the matching
 * @lmthing/ui passthrough primitive, so the surface speaks a single component vocabulary with
 * ZERO raw host tags — the RN-safety lint gate's requirement (§8).
 *
 * It uses the TypeScript AST (not regex), so it ONLY touches real JSX tag names — never host
 * tags that appear inside string literals (markdown, dangerouslySetInnerHTML), template
 * literals, comments, or TS generics. Primitives are imported under a namespace
 * (`import * as Prim`) so the injected names can never collide with a file's existing imports
 * (chat has its own Select/Input/Badge/… components). Only the tag NAME span is edited plus a
 * one-line namespace import — all attributes, children, refs and formatting are preserved, so
 * the render is byte-identical by construction (the primitives are proven byte-identical +
 * ref-forwarding in elements/primitives/index.test.tsx).
 *
 * Usage:
 *   node libs/ui/scripts/dehtml-codemod.mjs <file.tsx> [more.tsx …]   # rewrite in place
 *   node libs/ui/scripts/dehtml-codemod.mjs --check <file.tsx> …      # dry run, list changes
 */
import ts from 'typescript';
import { readFileSync, writeFileSync } from 'node:fs';
import { relative, dirname, resolve } from 'node:path';

const NS = 'Prim';
const PRIMITIVES_DIR = resolve(process.cwd(), 'libs/ui/src/elements/primitives');

// tag → { c: component, as?: value injected as `as="…"`, bool?: boolean attr to inject }
const MAP = {
  // Box (block containers)
  div: { c: 'Box' }, section: { c: 'Box', as: 'section' }, nav: { c: 'Box', as: 'nav' },
  header: { c: 'Box', as: 'header' }, footer: { c: 'Box', as: 'footer' },
  aside: { c: 'Box', as: 'aside' }, article: { c: 'Box', as: 'article' },
  main: { c: 'Box', as: 'main' }, figure: { c: 'Box', as: 'figure' },
  figcaption: { c: 'Box', as: 'figcaption' }, blockquote: { c: 'Box', as: 'blockquote' },
  details: { c: 'Box', as: 'details' }, summary: { c: 'Box', as: 'summary' },
  dl: { c: 'Box', as: 'dl' }, fieldset: { c: 'Box', as: 'fieldset' },
  // Text (inline + headings)
  span: { c: 'Text' }, p: { c: 'Text', as: 'p' }, strong: { c: 'Text', as: 'strong' },
  em: { c: 'Text', as: 'em' }, b: { c: 'Text', as: 'b' }, i: { c: 'Text', as: 'i' },
  small: { c: 'Text', as: 'small' }, label: { c: 'Text', as: 'label' },
  code: { c: 'Text', as: 'code' }, kbd: { c: 'Text', as: 'kbd' },
  dt: { c: 'Text', as: 'dt' }, dd: { c: 'Text', as: 'dd' },
  h1: { c: 'Text', as: 'h1' }, h2: { c: 'Text', as: 'h2' }, h3: { c: 'Text', as: 'h3' },
  h4: { c: 'Text', as: 'h4' }, h5: { c: 'Text', as: 'h5' }, h6: { c: 'Text', as: 'h6' },
  // Pressable / link
  button: { c: 'Pressable' }, a: { c: 'Link' },
  // Form controls
  input: { c: 'TextField' }, textarea: { c: 'TextArea' }, select: { c: 'Select' },
  option: { c: 'Option' }, form: { c: 'Form' },
  // Lists
  ul: { c: 'List' }, ol: { c: 'List', bool: 'ordered' }, li: { c: 'ListItem' },
  // Media
  img: { c: 'Image' }, audio: { c: 'Audio' }, video: { c: 'Video' }, iframe: { c: 'IFrame' },
  // Table
  table: { c: 'Table' }, thead: { c: 'Thead' }, tbody: { c: 'Tbody' }, tfoot: { c: 'Tfoot' },
  tr: { c: 'Tr' }, th: { c: 'Th' }, td: { c: 'Td' }, caption: { c: 'Caption' },
  // SVG (names mirror react-native-svg)
  svg: { c: 'Svg' }, path: { c: 'Path' }, rect: { c: 'Rect' }, circle: { c: 'Circle' },
  ellipse: { c: 'Ellipse' }, line: { c: 'Line' }, polyline: { c: 'Polyline' },
  polygon: { c: 'Polygon' }, g: { c: 'G' }, defs: { c: 'Defs' },
  linearGradient: { c: 'LinearGradient' }, radialGradient: { c: 'RadialGradient' },
  stop: { c: 'Stop' }, text: { c: 'SvgText' }, tspan: { c: 'Tspan' }, use: { c: 'Use' },
  clipPath: { c: 'ClipPath' }, mask: { c: 'Mask' },
  // Misc
  pre: { c: 'Pre' }, br: { c: 'Br' }, hr: { c: 'Hr' },
};

/** Collect edits for one file. Returns { text, changed, count } (text unchanged if no edits). */
function transform(file, text) {
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  /** @type {{start:number,end:number,replacement:string}[]} */
  const edits = [];
  let firstImportStart = null;

  const visit = (node) => {
    if (firstImportStart === null && ts.isImportDeclaration(node)) {
      firstImportStart = node.getStart(sf);
    }
    if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
      const t = node.tagName;
      if (ts.isIdentifier(t) && MAP[t.text]) {
        const m = MAP[t.text];
        edits.push({ start: t.getStart(sf), end: t.getEnd(), replacement: `${NS}.${m.c}` });
        const inject = m.as ? ` as="${m.as}"` : m.bool ? ` ${m.bool}` : '';
        if (inject) edits.push({ start: t.getEnd(), end: t.getEnd(), replacement: inject });
      }
    } else if (ts.isJsxClosingElement(node)) {
      const t = node.tagName;
      if (ts.isIdentifier(t) && MAP[t.text]) {
        edits.push({ start: t.getStart(sf), end: t.getEnd(), replacement: `${NS}.${MAP[t.text].c}` });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);

  if (edits.length === 0) return { text, changed: false, count: 0 };

  // Inject the namespace import before the first import (or at file top).
  let rel = relative(dirname(resolve(file)), PRIMITIVES_DIR).replace(/\\/g, '/');
  if (!rel.startsWith('.')) rel = './' + rel;
  const importLine = `import * as ${NS} from '${rel}/index.js';\n`;
  const at = firstImportStart ?? 0;
  edits.push({ start: at, end: at, replacement: importLine });

  // Apply descending so offsets stay valid; ties: inserts (start===end) after replacements.
  edits.sort((a, b) => b.start - a.start || b.end - a.end);
  let out = text;
  for (const e of edits) out = out.slice(0, e.start) + e.replacement + out.slice(e.end);
  const tagEdits = edits.filter((e) => e.end > e.start).length;
  return { text: out, changed: true, count: tagEdits };
}

const args = process.argv.slice(2);
const check = args[0] === '--check';
const files = (check ? args.slice(1) : args).filter((a) => a.endsWith('.tsx'));
let total = 0;
for (const file of files) {
  const src = readFileSync(file, 'utf8');
  const { text, changed, count } = transform(file, src);
  if (changed) {
    total += count;
    if (check) console.log(`${file}: ${count} host tags`);
    else {
      writeFileSync(file, text);
      console.log(`✓ ${file}: rewrote ${count} host tags`);
    }
  }
}
console.log(`[dehtml-codemod] ${check ? 'would rewrite' : 'rewrote'} ${total} host tags in ${files.length} files`);
