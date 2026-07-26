import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * The standing gate for phase 4 of docs/tamagui-final-steps.md: Tailwind is gone from the design
 * system and the web surfaces, and must not come back by accident.
 *
 * It is deliberately a SOURCE-level test rather than a build assertion. A reintroduced `@apply` or
 * `@reference` still compiles today — `libs/cli` keeps a Tailwind compiler for project app pages — so
 * a build would not fail; it would just ship a stylesheet that silently loses its declarations the
 * next time it is bundled without that compiler. This catches it at the point of writing.
 *
 * The one place Tailwind is ALLOWED, and load-bearing: `libs/cli`, which compiles agent-authored
 * project app pages. That is a product feature, not migration residue.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const ORG = join(HERE, '../../..');

/** Directives that need a Tailwind compiler to mean anything. */
const DIRECTIVES = [
  '@import "tailwindcss"',
  "@import 'tailwindcss'",
  '@apply',
  '@reference',
  '@theme',
  '@source',
  '@custom-variant',
  '@plugin',
  '@utility',
];

function cssFiles(root: string): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      if (name === 'node_modules' || name === 'dist' || name === '__snapshots__') continue;
      const abs = join(dir, name);
      if (statSync(abs).isDirectory()) walk(abs);
      else if (name.endsWith('.css')) out.push(abs);
    }
  };
  walk(root);
  return out;
}

/** Strip comments — a directive NAMED in prose is not a directive, and these files discuss them. */
const code = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, '');

const TREES = ['libs/css/src', 'libs/ui/src', 'apps/web/src'];

describe('the design system and web surfaces are Tailwind-free', () => {
  const files = TREES.flatMap((t) => cssFiles(join(ORG, t)));

  it('finds the stylesheets it means to check', () => {
    // Guards against the walk silently matching nothing and the suite passing vacuously. The count
    // dropped from ~17 to 7 when the dead `libs/css/src/components/**` stylesheets were deleted —
    // every one of them had been superseded by a `props.ts` bag and imported by nothing.
    expect(files.length).toBeGreaterThan(5);
  });

  it.each(DIRECTIVES)('no stylesheet uses %s', (directive) => {
    const offenders = files.filter((f) => code(readFileSync(f, 'utf8')).includes(directive));
    expect(offenders.map((f) => relative(ORG, f))).toEqual([]);
  });

  it('no --tw-* variable survives — those resolve to nothing without Tailwind', () => {
    // `var(--tw-ring-shadow)` etc. are registered by Tailwind's `@property` rules. Left behind, they
    // make `box-shadow` compute to `none` and `border-style` to `none`, with no error anywhere.
    const offenders = files.filter((f) => code(readFileSync(f, 'utf8')).includes('--tw-'));
    expect(offenders.map((f) => relative(ORG, f))).toEqual([]);
  });

  it('theme.css still emits the --color-* aliases SPIKE A1 resolves against', () => {
    const theme = readFileSync(join(ORG, 'libs/css/src/theme.css'), 'utf8');
    // Every Tamagui `$color` token becomes `var(--color-<name>)`. These used to be a side effect of
    // `@theme inline` registering Tailwind colour utilities; now they are stated directly, and if they
    // ever stop being emitted every colour in the app resolves to nothing.
    expect(theme).toMatch(/--color-background:\s*var\(--background\)/);
    expect(theme).toMatch(/--color-agent:\s*var\(--agent\)/);
    expect((theme.match(/--color-[a-z0-9-]+:/g) ?? []).length).toBeGreaterThan(90);
  });

  it('theme.css pulls in preflight, INTO the base layer', () => {
    const theme = readFileSync(join(ORG, 'libs/css/src/theme.css'), 'utf8');
    // `layer(base)` is load-bearing: unlayered, preflight's `border: 0 solid` would outrank
    // `apps/web/src/index.css`'s own `@layer base` and reset every border to `currentcolor`.
    expect(theme).toContain('@import "./preflight.css" layer(base);');
    expect(theme).toContain('@layer base, components, utilities;');
  });

  it('preflight keeps the resets the primitives assume', () => {
    const pf = readFileSync(join(ORG, 'libs/css/src/preflight.css'), 'utf8');
    expect(pf).toMatch(/box-sizing:\s*border-box/);
    expect(pf).toMatch(/border:\s*0 solid/); // Prim.Pressable renders a <button> and assumes this
    expect(code(pf)).not.toContain('--default-font-family'); // Tailwind's var, resolved away
    expect(code(pf)).toContain('var(--font-sans)'); // ours, deliberately preserved
  });
});

describe('libs/cli keeps Tailwind — it is a product feature', () => {
  it('still compiles Tailwind for agent-authored project app pages', () => {
    const pages = readFileSync(join(ORG, 'libs/cli/src/app/build/pages.ts'), 'utf8');
    expect(pages).toContain("from '@tailwindcss/node'");
    // Phase 4 made this file bring its OWN Tailwind: it used to inherit it from theme.css.
    expect(pages).toContain('@import "tailwindcss/theme" layer(theme);');
    expect(pages).toContain('@import "tailwindcss/utilities" layer(utilities);');
    // …and rebuild the token→utility bridge that `@theme inline` used to provide, or a page's
    // `bg-background` compiles to nothing.
    expect(pages).toContain('renderTokenTheme');
  });
});
