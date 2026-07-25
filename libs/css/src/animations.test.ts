import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Phase 2 of docs/tamagui-final-steps.md moved the keyframe layer out of
 * `libs/ui/src/chat/app/styles.css` — a second `@import "tailwindcss"` entry, loaded by the `/chat`
 * ROUTE — into `animations.css`, a plain stylesheet on the APP entry.
 *
 * P0 (`pnpm test:surface`) covers the computed result of that move for the classes it renders, but
 * it cannot cover three things, and each is a silent failure:
 *
 *   1. `.streaming-cursor` animates its `::after`, and the P0 walk reads `getComputedStyle(el)`
 *      with no pseudo-element argument, so the cursor's motion is invisible to it;
 *   2. whether `animations.css` still depends on Tailwind. It compiles fine either way TODAY,
 *      because Tailwind is still there — it would break in phase 4, far from the cause;
 *   3. whether the rules were COPIED rather than MOVED. Duplicates in both files agree on computed
 *      style, so P0 passes while the chat entry quietly keeps ownership.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const ORG = join(HERE, '../../..');

const animations = readFileSync(join(HERE, 'animations.css'), 'utf8');
const markdown = readFileSync(join(HERE, 'components/markdown/index.css'), 'utf8');
const chatEntry = readFileSync(join(ORG, 'libs/ui/src/chat/app/styles.css'), 'utf8');
const appEntry = readFileSync(join(ORG, 'apps/web/src/index.css'), 'utf8');
const message = readFileSync(join(ORG, 'libs/ui/src/chat/app/Message.tsx'), 'utf8');

/** Strip comments so a rule NAMED in prose is never mistaken for a rule DECLARED. */
const code = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, '');

describe('animations.css is Tailwind-free', () => {
  // The entire reason the file exists: it has to survive the phase-4 deletion untouched.
  it.each(['@import "tailwindcss"', '@apply', '@theme', '@reference', '@custom-variant'])(
    'does not use %s',
    (directive) => {
      expect(code(animations)).not.toContain(directive);
    },
  );

  it('uses design tokens for color, never a raw value', () => {
    // Mirrors the lint:tokens gate, scoped to this file's declarations.
    const colorDecls = code(animations).match(/(?:^|[\s;{])(?:color|background(?:-color)?|border-color)\s*:\s*([^;}]+)/g) ?? [];
    expect(colorDecls.length).toBeGreaterThan(0);
    for (const decl of colorDecls) expect(decl).toMatch(/var\(--/);
  });
});

describe('the lm-* keyframe family survived the move intact', () => {
  // Timings are pinned because `animation-name`/`-duration`/`-iteration-count` are in the P0
  // audited set: a change here is a baseline delta, and these are the values that shipped.
  const CLASSES: Array<[string, string, string]> = [
    ['lm-spin', 'lm-spin', '1.2s linear infinite'],
    ['lm-fade-in', 'lm-fade-in', '150ms ease-out'],
    ['lm-slide-in-right', 'lm-slide-in-right', '200ms ease-out'],
    ['lm-pulse', 'lm-pulse', '2s ease-in-out infinite'],
  ];

  it.each(CLASSES)('.%s animates %s %s', (cls, frames, timing) => {
    expect(code(animations)).toContain(`.${cls} { animation: ${frames} ${timing}; }`);
    expect(code(animations)).toMatch(new RegExp(`@keyframes ${frames}\\s*\\{`));
  });

  it('defines .streaming-cursor::after — the rule P0 cannot see', () => {
    const rule = code(animations).match(/\.streaming-cursor::after\s*\{[^}]*\}/)?.[0];
    expect(rule).toBeDefined();
    expect(rule).toContain("content: '▋'");
    expect(rule).toContain('animation: lm-stream-cursor 0.8s step-end infinite');
    expect(code(animations)).toMatch(/@keyframes lm-stream-cursor\s*\{/);
  });

  it('disables the lm-* classes under prefers-reduced-motion', () => {
    const block = code(animations).match(/@media \(prefers-reduced-motion: reduce\)\s*\{[\s\S]*?\n\}/)?.[0];
    expect(block).toBeDefined();
    for (const cls of CLASSES.map(([c]) => c)) expect(block).toContain(`.${cls}`);
    expect(block).toContain('.streaming-cursor::after { animation: none; }');
  });
});

describe("Tailwind's animate-* utilities are reproduced exactly", () => {
  /*
   * Golden values, read out of Tailwind v4's compiled output rather than remembered:
   *   --animate-spin:  spin 1s linear infinite
   *   --animate-pulse: pulse 2s cubic-bezier(.4, 0, .6, 1) infinite
   * with `@keyframes spin { to { transform: rotate(360deg) } }` and
   * `@keyframes pulse { 50% { opacity: .5 } }`.
   *
   * The class AND keyframe names are Tailwind's deliberately — `animation-name` is audited by P0, so
   * renaming these is a computed-style delta at every call site, not a free cleanup.
   */
  it('.animate-spin matches Tailwind exactly', () => {
    expect(code(animations)).toContain('.animate-spin { animation: spin 1s linear infinite; }');
    expect(code(animations)).toMatch(/@keyframes spin\s*\{\s*to\s*\{\s*transform: rotate\(360deg\);?\s*\}\s*\}/);
  });

  it('.animate-pulse matches Tailwind exactly', () => {
    expect(code(animations)).toContain('.animate-pulse { animation: pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite; }');
    expect(code(animations)).toMatch(/@keyframes pulse\s*\{\s*50%\s*\{\s*opacity: 0\.5;?\s*\}\s*\}/);
  });

  it('does not alias them onto lm-spin/lm-pulse, whose timings differ', () => {
    expect(code(animations)).not.toMatch(/\.animate-spin\s*\{[^}]*lm-spin/);
    expect(code(animations)).not.toMatch(/\.animate-pulse\s*\{[^}]*lm-pulse/);
  });
});

describe('the move left nothing behind in the Tailwind entry', () => {
  // A COPY would pass P0 — both files would agree. Only absence proves the move.
  it.each([
    '@keyframes lm-spin',
    '@keyframes lm-fade-in',
    '@keyframes lm-slide-in-right',
    '@keyframes lm-pulse',
    '@keyframes lm-stream-cursor',
    '.streaming-cursor::after',
    'prefers-reduced-motion',
    '.lm-prose',
  ])('chat/app/styles.css no longer declares %s', (fragment) => {
    expect(code(chatEntry)).not.toContain(fragment);
  });

  it('chat/app/styles.css is still the second Tailwind entry — phase 2 does not delete it', () => {
    // It still owns base/reset styling and the `--lm-*` bridge; phase 4 relocates those.
    expect(chatEntry).toContain('@import "tailwindcss"');
    expect(code(chatEntry)).toContain('--lm-bg');
  });
});

describe('every moved rule is reachable from where it is used', () => {
  it('animations.css is imported from the APP entry, not a route', () => {
    expect(appEntry).toContain('@import "@lmthing/css/animations.css"');
  });

  it('.lm-prose lives in the markdown stylesheet', () => {
    expect(code(markdown)).toContain('.lm-prose {');
    expect(code(markdown)).toContain('.lm-prose pre code { background: none; padding: 0; }');
  });

  it('Message.tsx imports the stylesheet that now owns .lm-prose', () => {
    // `.lm-prose` renders wherever a Message does; the markdown stylesheet is component-scoped
    // (side-effect imported), so without this import it would only arrive if some OTHER component
    // pulled it in first.
    expect(message).toContain("className=\"lm-prose\"");
    expect(message).toContain("import '@lmthing/css/components/markdown/index.css'");
  });
});
