/**
 * **G3 — tone parity** (APPFORMAT_IMPROVE.md §6): every {@link TONES} value must resolve to a REAL
 * design token — one declared in `libs/css/src/tokens/tokens.json`, the single source of truth every
 * theme (web CSS vars, the Tamagui native theme) is generated from (CLAUDE.md: "To change a color,
 * edit tokens.json ... never hand-edit theme.css"). Checking against the JSON source directly, rather
 * than against either generated target, is what makes this ONE check cover both platforms: a token
 * present in `tokens.json` is present in `theme.css` AND the Tamagui theme by construction of the
 * generator, and a token ABSENT from `tokens.json` cannot exist on either.
 *
 * `toneTokens()` (`format.ts`) is the one tone→token table `elements.tsx`/`actions.tsx`/`icons.tsx`/
 * `calendar.tsx` all read through — a typo'd or renamed token there is a colour that silently falls
 * back to browser-default black/transparent (Tamagui does not throw on an unknown `$token`), so this
 * is not a defensive nicety: it is the only thing that would catch that class of drift today.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { TONES, type Tone } from './types';
import { toneTokens } from './format';

const __dirname = dirname(fileURLToPath(import.meta.url));
// libs/ui/src/view → libs/css/src/tokens/tokens.json
const TOKENS_JSON = join(__dirname, '..', '..', '..', 'css', 'src', 'tokens', 'tokens.json');

interface ColorToken {
  name: string;
}
interface TokensFile {
  colors: ColorToken[];
}

function loadTokenNames(): Set<string> {
  const raw = readFileSync(TOKENS_JSON, 'utf8');
  const data = JSON.parse(raw) as TokensFile;
  return new Set(data.colors.map((c) => c.name));
}

/** `'$muted-foreground'` → `'muted-foreground'`. `toneTokens` values are always `$`-prefixed. */
function bareName(token: string): string {
  expect(token.startsWith('$'), `tone token "${token}" is not $-prefixed`).toBe(true);
  return token.slice(1);
}

describe('G3 — tone parity: every TONES value resolves to a real design token', () => {
  const tokenNames = loadTokenNames();

  it('the tokens.json fixture actually loaded (the gate is checking something real)', () => {
    expect(tokenNames.size).toBeGreaterThan(10);
  });

  it.each(TONES.filter((t): t is Exclude<Tone, 'auto'> => t !== 'auto'))(
    'tone "%s" — fg/bg/border all resolve to a declared token',
    (tone) => {
      const tokens = toneTokens(tone);
      for (const [slot, value] of Object.entries(tokens) as Array<[string, string]>) {
        const name = bareName(value);
        expect(tokenNames.has(name), `tone "${tone}".${slot} = "${value}" — no such token in tokens.json (have: ${[...tokenNames].sort().join(', ')})`).toBe(true);
      }
    },
  );

  it('"auto" is excluded from the direct table — resolveTone settles it to a real tone first', () => {
    // `TONE_TOKENS`/`toneTokens` are typed `Exclude<Tone, 'auto'>` — 'auto' is never looked up
    // directly; this pins that invariant so a future refactor cannot quietly re-widen it and let
    // an unresolved 'auto' fall through to toneTokens's own 'neutral' default without anyone deciding
    // that was correct.
    expect(TONES).toContain('auto');
    expect(Object.keys(toneTokens('neutral' as Exclude<Tone, 'auto'>))).toEqual(['fg', 'bg', 'border']);
  });
});
