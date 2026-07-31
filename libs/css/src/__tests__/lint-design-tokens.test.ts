import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * End-to-end tests for the design-token gate, run as a SUBPROCESS against fixture files.
 *
 * The linter is a top-level script — it walks argv and calls `process.exit` on import — so there is
 * nothing to unit-test. Running it the way CI does is also the more honest test: it covers the argv
 * handling, the walk and the reporting, not just a regex.
 *
 * These exist because the gate learned to skip comments. That fix removes findings, which is the
 * dangerous direction for a linter: a stripper that is slightly too eager stops reporting REAL
 * violations and the gate goes quietly green. So most of what follows is not "does it ignore
 * comments" but "does it still catch everything else" — code beside a comment, code after a URL,
 * strings, and CSS, where `//` is not a comment at all.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const LINTER = join(HERE, '../../scripts/lint-design-tokens.mjs');

let dir: string;

/** Write a fixture and return the linter's findings for it, as `line:col kind` strings. */
function lint(name: string, source: string): string[] {
  const target = join(dir, name);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, source, 'utf8');
  let stdout = '';
  try {
    stdout = execFileSync('node', [LINTER, target], { encoding: 'utf8' });
  } catch (e) {
    // exit 1 is the "violations found" path; the report is still on stdout.
    stdout = (e as { stdout?: string }).stdout ?? '';
  }
  return stdout
    .split('\n')
    .filter((l) => l.includes(`${name}:`))
    .map((l) => {
      const m = /:(\d+):(\d+)\s+(\S+)/.exec(l);
      return m ? `${m[1]}:${m[2]} ${m[3]}` : l;
    });
}

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'ds-lint-'));
});
afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('lint-design-tokens — what it still catches', () => {
  it('flags a raw hex in code', () => {
    expect(lint('a.tsx', `export const c = '#ff0000'\n`)).toEqual(['1:19 raw-hex']);
  });

  it('flags a raw hex inside a className string', () => {
    expect(lint('b.tsx', `const x = <div className="text-[#abcdef]" />\n`)).toHaveLength(1);
  });

  it('flags a stock Tailwind colour utility', () => {
    expect(lint('c.tsx', `const x = <div className="bg-gray-500" />\n`)).toEqual([
      '1:27 stock-tailwind-color',
    ]);
  });

  it('flags a non-token rgb()', () => {
    expect(lint('d.css', `.a { color: rgb(1, 2, 3); }\n`)).toEqual(['1:13 raw-color-fn']);
  });

  it('still allows a token-built colour function', () => {
    expect(lint('e.css', `.a { color: rgb(var(--foreground)); }\n`)).toEqual([]);
  });
});

describe('lint-design-tokens — comments are not styling', () => {
  it('ignores a hex in a line comment', () => {
    expect(lint('f.tsx', `// the old value was #ff0000\nexport const a = 1\n`)).toEqual([]);
  });

  it('ignores rgb() named in a JSDoc block — the icons.tsx regression', () => {
    // `view/icons.tsx` resolves $token paints to a real rgb() for React Native SVG, and the JSDoc
    // explaining WHY tripped the gate on the word alone. Prose about colour is not colour.
    const src = [
      '/**',
      ' * A resolved `rgb()`/hex is valid on BOTH targets, so one code path serves both.',
      ' */',
      'export const a = 1',
    ].join('\n');
    expect(lint('g.tsx', `${src}\n`)).toEqual([]);
  });

  it('ignores a hex in a CSS block comment', () => {
    expect(lint('h.css', `/* was #ff0000 */\n.a { color: var(--foreground); }\n`)).toEqual([]);
  });
});

describe('lint-design-tokens — the false-negative traps', () => {
  it('still flags code on the SAME line as a trailing comment', () => {
    expect(lint('i.tsx', `export const a = '#ff0000' // was fine\n`)).toEqual(['1:19 raw-hex']);
  });

  it('still flags code AFTER a multi-line block comment', () => {
    const src = ['/*', ' * nothing to see', ' */', `export const a = '#ff0000'`].join('\n');
    expect(lint('j.tsx', `${src}\n`)).toEqual(['4:19 raw-hex']);
  });

  it('still flags a hex after a URL on the same line — `//` in a string is not a comment', () => {
    // The reason the stripper tracks string literals at all. Without it everything after the `//`
    // in the URL would be blanked and this violation would vanish.
    expect(lint('k.tsx', `const a = { doc: 'https://x.dev/p', c: '#ff0000' }\n`)).toHaveLength(1);
  });

  it('treats `//` in CSS as content, not a comment — CSS has no line comments', () => {
    expect(lint('l.css', `.a { background: url(//cdn/x.png); color: #ff0000; }\n`)).toHaveLength(1);
  });

  it('does not let an apostrophe inside a comment swallow the next line', () => {
    // `don't` opens a quote if comments are scanned as code; everything after would be "in a
    // string" and the real violation below would be missed.
    expect(lint('m.tsx', `// don't do this\nexport const a = '#ff0000'\n`)).toEqual(['2:19 raw-hex']);
  });
});

describe('lint-design-tokens — the escape hatches still work', () => {
  it('honours ds-lint-ok on the offending line', () => {
    // The marker lives in a comment, so it must be matched against the ORIGINAL line even though
    // the scan runs on the stripped one.
    expect(lint('n.tsx', `export const a = '#ff0000' // ds-lint-ok\n`)).toEqual([]);
  });

  it('honours ds-lint-file-ok anywhere in the file', () => {
    expect(lint('o.tsx', `// ds-lint-file-ok\nexport const a = '#ff0000'\n`)).toEqual([]);
  });
});

/**
 * The bare CSS colour KEYWORD rule.
 *
 * The gate believed it covered raw colour and did not: it checked hex, `rgb()/hsl()` and the stock
 * Tailwind palette, so `color="red"` sailed straight through and shipped in the chat surface's
 * required-field asterisk. `pnpm lint:tokens` was green the whole time.
 *
 * The risk of a rule matching bare English words is false positives, so most of what follows is
 * the NEGATIVE direction — a linter that cries wolf on the word "white" in prose gets escaped
 * everywhere and then catches nothing.
 */
describe('lint-design-tokens — bare colour keywords', () => {
  it('flags a colour prop set to a keyword', () => {
    expect(lint('k1.tsx', `<Text color="red" />\n`)).toEqual(['1:7 raw-color-keyword']);
  });

  it('flags the object-literal form too', () => {
    expect(lint('k2.tsx', `const s = { backgroundColor: 'white' }\n`)).toEqual(['1:13 raw-color-keyword']);
  });

  it('flags a React Native colour prop', () => {
    expect(lint('k3.tsx', `<View shadowColor="black" />\n`)).toEqual(['1:7 raw-color-keyword']);
  });

  it('does NOT flag the same word in prose', () => {
    expect(lint('k4.tsx', `// the red one is the destructive token\nexport const a = 1\n`)).toEqual([]);
  });

  it('does NOT flag a word that merely contains a colour name', () => {
    // `white-space`, `isBlackListed`, `greenfield` — the reason this rule matches only the
    // right-hand side of a colour-carrying prop rather than the words themselves.
    expect(lint('k5.tsx', `const whiteSpace = 'nowrap'\nconst isBlackListed = true\n`)).toEqual([]);
  });

  it('does NOT flag a token whose NAME contains a colour', () => {
    expect(lint('k6.tsx', `<Text color="$foreground" backgroundColor="var(--white-ish)" />\n`)).toEqual([]);
  });

  it('does NOT flag the legitimate non-colours', () => {
    // `transparent`/`currentColor`/`inherit` are real answers, not slips.
    expect(
      lint('k7.tsx', `<Box backgroundColor="transparent" borderColor="currentColor" color="inherit" />\n`),
    ).toEqual([]);
  });

  it('honours ds-lint-ok, for the cases that are deliberate', () => {
    // e.g. the IDE preview iframe, which frames arbitrary user HTML that assumes a white page and
    // must NOT follow the app into dark mode.
    expect(lint('k8.tsx', `<iframe style={{ backgroundColor: 'white' }} /> // ds-lint-ok\n`)).toEqual([]);
  });
})
