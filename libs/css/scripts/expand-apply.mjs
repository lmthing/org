#!/usr/bin/env node
/**
 * expand-apply.mjs — turn every `@apply` in a stylesheet into the plain CSS it compiles to,
 * then drop the `@reference` that only existed to resolve it.
 *
 * WHY NOT A HAND-WRITTEN TABLE. `docs/tamagui-final-steps.md` §4 suggested a "small second emitter"
 * over `classnames-to-props-map.mjs`. That map is the wrong source for this job twice over: it emits
 * Tamagui PROPS rather than declarations, and it only covers the utilities the codemod met on JSX.
 * The stylesheets use ~140 distinct utilities including arbitrary values (`rounded-[9px]`,
 * `tracking-[0.16em]`, `min-w-[160px]`), alpha shorthands (`bg-brand-3/10`, `shadow-brand-3/25`),
 * gradients, `ring-*`, `rotate-*` and `-translate-*`. Hand-translating those is ~140 chances to be
 * quietly wrong in a way no test would catch, because CSS never errors.
 *
 * So this asks TAILWIND to expand them, using the same compiler the app build uses. The output is
 * correct by construction, and this script's job is only to splice it back into the source file.
 *
 * HOW. For each `@apply a b c;` we compile a probe stylesheet with a single known selector carrying
 * that exact utility list, read the declarations Tailwind emits for it, and substitute them. `!`
 * suffixes (`flex!`) survive as `!important`, which several `display` rules deliberately rely on.
 *
 * Usage: node libs/css/scripts/expand-apply.mjs [--check] <file.css> …
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const THEME = resolve(HERE, '../src/theme.css');

// `@tailwindcss/node` is a dependency of `libs/cli` (it compiles Tailwind for agent-authored project
// app pages — a PRODUCT feature that outlives this migration), so resolve it from there.
const require = createRequire(resolve(HERE, '../../cli/package.json'));
const { compile } = await import(`file://${require.resolve('@tailwindcss/node')}`);

/** Compile one utility list and return its declarations, in Tailwind's own order. */
async function declarationsFor(utilities, referencePath) {
  // `@reference` pulls in the theme WITHOUT emitting it, exactly as the source files do.
  const probe = `@reference "${referencePath}";\n.__probe__ { @apply ${utilities}; }\n`;
  const compiler = await compile(probe, { base: dirname(referencePath), onDependency: () => {} });
  const out = compiler.build([]);
  // Everything inside the single `.__probe__` rule. Tailwind may also emit `@property`/`@supports`
  // preambles for custom properties (`--tw-*`); those are collected separately.
  const body = out.match(/\.__probe__\s*\{([\s\S]*?)\n\}/);
  if (!body) {
    const inline = out.match(/\.__probe__\s*\{([^}]*)\}/);
    if (!inline) throw new Error(`no .__probe__ rule emitted for: ${utilities}`);
    return { decls: inline[1].trim(), preamble: '' };
  }
  const preamble = out.slice(0, out.indexOf('.__probe__')).trim();
  return { decls: body[1].trim(), preamble };
}

const CHECK = process.argv.includes('--check');
const files = process.argv.slice(2).filter((a) => !a.startsWith('--'));
let touched = 0;
const preambles = new Set();

for (const file of files) {
  const src = readFileSync(file, 'utf8');
  const ref = src.match(/@reference\s+"([^"]+)"\s*;/);
  const referencePath = ref ? resolve(dirname(file), ref[1]) : THEME;

  // Only real directives — never one merely NAMED inside a comment.
  const withoutComments = src.replace(/\/\*[\s\S]*?\*\//g, (m) => ' '.repeat(m.length));
  const applies = [];
  const re = /@apply\s+([^;}]+);/g;
  let m;
  while ((m = re.exec(withoutComments))) applies.push({ start: m.index, end: re.lastIndex, list: m[1].trim() });

  if (!applies.length) {
    console.log(`  —    ${file}: no @apply`);
    continue;
  }

  let out = src;
  // Right-to-left so earlier offsets stay valid.
  for (const a of [...applies].reverse()) {
    const { decls, preamble } = await declarationsFor(a.list, referencePath);
    if (preamble) preambles.add(preamble);
    // Match the indentation of the `@apply` line so the result reads like hand-written CSS.
    const lineStart = out.lastIndexOf('\n', a.start) + 1;
    const indent = out.slice(lineStart, a.start).match(/^\s*/)[0];
    const formatted = decls
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean)
      .map((l) => indent + l)
      .join('\n')
      .trimStart();
    out = out.slice(0, a.start) + formatted + out.slice(a.end);
  }

  // The `@reference` existed only to resolve `@apply`. With none left, it is dead — and after phase 4
  // it would point at a file that is no longer a Tailwind entry.
  out = out.replace(/@reference\s+"[^"]+"\s*;\n?/, '');

  if (CHECK) {
    console.log(`  would expand ${applies.length} @apply in ${file}`);
  } else {
    writeFileSync(file, out);
    console.log(`✓ ${file}: ${applies.length} @apply → plain CSS`);
  }
  touched++;
}

if (preambles.size) {
  console.log(`\n[expand-apply] NOTE: ${preambles.size} utility group(s) emitted an @property/@supports preamble.`);
  console.log('These declare `--tw-*` custom properties and must be carried into a plain stylesheet:');
  for (const p of preambles) console.log(p.split('\n').slice(0, 4).join('\n'));
}
console.log(`\n[expand-apply] ${CHECK ? 'would expand' : 'expanded'} ${touched} file(s)`);
