/**
 * Layer 1 — token-equivalence unit test (the root guarantee).
 *
 * Proves the Tamagui token/theme data (src/tamagui/tokens.generated.ts) resolves to the
 * BYTE-IDENTICAL CSS values the browser gets from src/theme.css, for both the light (:root)
 * and dark ([data-theme="dark"]) themes plus the radius/font scale. Both artifacts derive
 * from src/tokens/tokens.json; this equality assertion makes color/spacing/radius/font drift
 * between the Tailwind (web) and Tamagui (universal) render targets structurally impossible.
 *
 * See docs/react-native-tamagui-migration.md §3 (Layer 1) and §5. Runs in the root vitest
 * node env (no Tamagui runtime, no browser needed).
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { describe, it, expect } from 'vitest';

import { radius, fonts, themes } from '../tamagui/tokens.generated';
import { renderTokensModule } from '../../scripts/tamagui-tokens.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const cssRoot = join(here, '..');

const themeCss = readFileSync(join(cssRoot, 'theme.css'), 'utf8');
const generatedPath = join(cssRoot, 'tamagui/tokens.generated.ts');
const tokensJson = JSON.parse(
  readFileSync(join(cssRoot, 'tokens/tokens.json'), 'utf8'),
);

/** Parse `--name: value;` declarations out of a `{ … }` CSS block body into a map. */
function parseDecls(body: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of body.matchAll(/--([\w-]+)\s*:\s*([^;]+);/g)) {
    out[m[1].trim()] = m[2].trim();
  }
  return out;
}

/** Extract the body of the FIRST block matching a selector prefix (e.g. `:root`, `@theme`). */
function block(css: string, re: RegExp): string {
  const m = css.match(re);
  if (!m) throw new Error(`theme.css: block not found for ${re}`);
  return m[1];
}

// The plain `@theme { … }` block (radius + fonts) — NOT `@theme inline { … }`.
const themeBlock = parseDecls(block(themeCss, /@theme\s*\{([^}]*)\}/));
const rootBlock = parseDecls(block(themeCss, /:root\s*\{([^}]*)\}/));
const darkBlock = parseDecls(block(themeCss, /\[data-theme="dark"\]\s*\{([^}]*)\}/));

// The fully-resolved dark theme the browser computes: :root ⊕ [data-theme="dark"] overrides.
const resolvedDark = { ...rootBlock, ...darkBlock };

describe('Layer 1 — Tamagui ⇄ theme.css token parity', () => {
  it('radius scale matches @theme byte-for-byte', () => {
    for (const [name, value] of Object.entries(radius)) {
      expect(themeBlock[name], `radius token --${name}`).toBe(value);
    }
    // No radius token in theme.css is missing from the generated config.
    for (const name of Object.keys(themeBlock).filter((n) => n.startsWith('radius'))) {
      expect(radius, `theme.css --${name} must be in generated radius`).toHaveProperty(name);
    }
  });

  it('font scale matches @theme byte-for-byte', () => {
    for (const [name, value] of Object.entries(fonts)) {
      expect(themeBlock[name], `font token --${name}`).toBe(value);
    }
    for (const name of Object.keys(themeBlock).filter((n) => n.startsWith('font'))) {
      expect(fonts, `theme.css --${name} must be in generated fonts`).toHaveProperty(name);
    }
  });

  it('light theme matches :root byte-for-byte (every color, both directions)', () => {
    for (const [name, value] of Object.entries(themes.light)) {
      expect(rootBlock[name], `light color --${name}`).toBe(value);
    }
    for (const [name, value] of Object.entries(rootBlock)) {
      expect(themes.light[name as keyof typeof themes.light], `:root --${name} in generated`).toBe(
        value,
      );
    }
  });

  it('dark theme matches the resolved [data-theme="dark"] cascade byte-for-byte', () => {
    for (const [name, value] of Object.entries(themes.dark)) {
      expect(resolvedDark[name], `dark color --${name}`).toBe(value);
    }
    for (const [name, value] of Object.entries(resolvedDark)) {
      expect(themes.dark[name as keyof typeof themes.dark], `resolved dark --${name}`).toBe(value);
    }
  });

  it('every :root color also has a distinct-or-inherited dark value (no gaps)', () => {
    for (const name of Object.keys(themes.light)) {
      expect(themes.dark, `dark theme has --${name}`).toHaveProperty(name);
    }
  });
});

describe('generated Tamagui config is not stale', () => {
  it('src/tamagui/tokens.generated.ts matches the generator output', () => {
    const expected = renderTokensModule(tokensJson);
    const actual = readFileSync(generatedPath, 'utf8');
    expect(
      actual,
      'Run `pnpm --filter @lmthing/css generate` — the checked-in Tamagui token module is stale.',
    ).toBe(expected);
  });
});
