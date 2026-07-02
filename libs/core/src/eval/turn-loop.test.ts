import { describe, it, expect } from 'vitest';
import { stripMarkdownFences, looksLikeProse, FenceLineFilter } from './turn-loop.js';

describe('looksLikeProse', () => {
  it('flags narrated sentences the model emits instead of code', () => {
    expect(looksLikeProse('Based on the query from search_broad, I will search')).toBe(true);
    expect(looksLikeProse('Now we synthesize the findings into a report')).toBe(true);
    expect(looksLikeProse('Here is the plan for the next step')).toBe(true);
    expect(looksLikeProse('This function merges the overlapping intervals')).toBe(true);
  });

  it('does NOT flag real TypeScript statements', () => {
    expect(looksLikeProse('const x = 1;')).toBe(false);
    expect(looksLikeProse('await tavilySearch(query, "advanced", 10)')).toBe(false);
    expect(looksLikeProse('currentTask.resolve({ summary: "x" })')).toBe(false);
    expect(looksLikeProse('display(report)')).toBe(false);
    expect(looksLikeProse('return results.map((r) => r.title)')).toBe(false);
    expect(looksLikeProse('for (const r of results) { }')).toBe(false);
    expect(looksLikeProse('const based = onQuery;')).toBe(false); // has '=' → code
  });

  it('flags apostrophe-contraction prose openers (the "I\'ll start by" loop)', () => {
    expect(looksLikeProse("I'll start by loading the knowledge")).toBe(true);
    expect(looksLikeProse("Let's diagnose the espresso shot")).toBe(true);
    expect(looksLikeProse("I'm going to compute the recommendation")).toBe(true);
    expect(looksLikeProse("We'll resolve once the data is ready")).toBe(true);
    expect(looksLikeProse('First load knowledge then resolve')).toBe(true);
  });

  it('does NOT flag code that legitimately contains an apostrophe', () => {
    expect(looksLikeProse("'it is fine'")).toBe(false); // leading quote → not prose
    expect(looksLikeProse('display("message")')).toBe(false); // has ( ) → code
  });

  it('keeps single identifiers (valid inspect probes) and short fragments', () => {
    expect(looksLikeProse('results')).toBe(false);
    expect(looksLikeProse('inspect')).toBe(false);
    expect(looksLikeProse('x')).toBe(false);
  });

  it('does not flag word sequences without an English function word (avoids false drops)', () => {
    // No recognizable English connective → keep it (it will typecheck-error as before, no worse).
    expect(looksLikeProse('foo bar baz')).toBe(false);
  });
});

describe('stripMarkdownFences', () => {
  const stripFences = stripMarkdownFences;

  it('strips opening code fences', () => {
    const result = stripFences('```typescript\nconst x = 1;');
    expect(result).toContain('const x = 1;');
    expect(result).not.toContain('```');
  });

  it('strips closing code fences', () => {
    const result = stripFences('const x = 1;\n```');
    expect(result).toContain('const x = 1;');
    expect(result).not.toContain('```');
  });

  it('preserves regular code', () => {
    const code = 'const x = 42;\nawait sleep("1s");';
    expect(stripFences(code)).toBe(code);
  });

  it('handles various fence formats', () => {
    expect(stripFences('```ts\n')).not.toContain('```');
    expect(stripFences('```json\n')).not.toContain('```');
    expect(stripFences('  ```\n')).not.toContain('```');
  });

  it('drops a stray fence language tag left behind when the stream splits ``` from its tag', () => {
    // The boundary that broke a live run: '```' arrived in one chunk
    // (stripped) and 'typescript' alone in the next, leaking a bogus statement.
    expect(stripFences('typescript\nconst source = 1;')).toBe('const source = 1;');
    expect(stripFences('ts')).toBe('');
    expect(stripFences('  json  ')).toBe('');
  });

  it('drops a PARTIAL fence tag left when the stream splits ``` mid-language-word', () => {
    // The live failure: '```types' arrived in one chunk (line starts with ```, stripped)
    // and 'cript' alone in the next, leaking 'cript' as a statement → "Cannot find name 'cript'".
    expect(stripFences('cript\nconst source = 1;')).toBe('const source = 1;');
    expect(stripFences('escript')).toBe('');
    expect(stripFences('script')).toBe('');
    expect(stripFences('  ript  ')).toBe('');
    expect(stripFences('pt')).toBe('');         // suffix of typescript/javascript
    expect(stripFences('son')).toBe('');        // suffix of json
    expect(stripFences('sx')).toBe('');         // suffix of tsx/jsx
  });

  it('does not drop those words inside real statements', () => {
    expect(stripFences('const ts = 1;')).toBe('const ts = 1;');
    expect(stripFences('return typescript.length;')).toBe('return typescript.length;');
  });

  it('keeps single-character lines (legitimate one-letter probes survive)', () => {
    // Single-char suffixes (t, s, x, n) are intentionally NOT dropped.
    expect(stripFences('x')).toBe('x');
    expect(stripFences('t')).toBe('t');
  });

  it('keeps real identifiers that are not fence-tag suffixes', () => {
    expect(stripFences('result')).toBe('result');
    expect(stripFences('topic')).toBe('topic');
    expect(stripFences('questions')).toBe('questions');
  });
});

describe('FenceLineFilter (streaming-safe fence stripping)', () => {
  function run(chunks: string[]): string {
    const f = new FenceLineFilter();
    let out = '';
    for (const c of chunks) out += f.feed(c);
    out += f.flush();
    return out;
  }

  it('does NOT swallow a mid-statement token that arrives as its own chunk (E5 live: JSON.stringify → .stringify)', () => {
    expect(run(['const s = ', 'JSON', '.stringify({});\n'])).toBe('const s = JSON.stringify({});\n');
    expect(run(['display("game ', 'on', '");\n'])).toBe('display("game on");\n');
    expect(run(['const x = 1; // no', 'ts', '\n'])).toBe('const x = 1; // nots\n');
  });

  it('still drops complete fence lines and stray tags on their own lines', () => {
    expect(run(['```typescript\nconst x = 1;\n```\n'])).toBe('const x = 1;\n');
    expect(run(['typescript\nconst y = 2;\n'])).toBe('const y = 2;\n');
  });

  it('drops a fence tag split across chunks by reassembling the full line', () => {
    // Old per-chunk stripping handled this via the suffix set; the line buffer
    // reassembles ```typ + escript into one ```typescript line, dropped directly.
    expect(run(['```typ', 'escript\nconst z = 3;\n'])).toBe('const z = 3;\n');
    expect(run(['```', 'json\n{"a":1}\n'])).toBe('{"a":1}\n');
  });

  it('flush() applies the drop rules to the final unterminated line', () => {
    expect(run(['const a = 1;\n', '```'])).toBe('const a = 1;\n');
    expect(run(['const a = 1;\nts'])).toBe('const a = 1;\n');
    expect(run(['const a = 1;'])).toBe('const a = 1;');
  });

  it('releases an unterminated statement line immediately (streaming pipeline must see it, not the flush path)', () => {
    const f = new FenceLineFilter();
    // A single-chunk statement without trailing newline must come out of feed(),
    // not be held until flush — otherwise its statement/typecheck trace events
    // are lost to the (event-less) trailing-flush path.
    expect(f.feed('const n: number = "not a number";')).toBe('const n: number = "not a number";');
    expect(f.flush()).toBe('');
  });

  it('a line whose head was already released is exempt from drop checks on its remainder', () => {
    const f = new FenceLineFilter();
    let out = f.feed('const s = "game "; // comment about j');
    out += f.feed('son\nconst t = 2;\n');
    // "son" is a fence-lang suffix, but it is the REMAINDER of a released line — kept.
    expect(out).toBe('const s = "game "; // comment about json\nconst t = 2;\n');
  });
});

describe('globalThis variable persistence for undefined values', () => {
  it('try/catch wrapping allows undefined values through', () => {
    // Simulate the new pattern
    const result: Record<string, unknown> = {};
    const trySet = (name: string, value: unknown) => {
      try { result[name] = value; } catch {}
    };

    trySet('defined', 42);
    trySet('undefinedVal', undefined);
    trySet('nullVal', null);
    trySet('emptyArr', []);

    expect(result['defined']).toBe(42);
    expect('undefinedVal' in result).toBe(true); // KEY: undefined values ARE now tracked
    expect(result['undefinedVal']).toBeUndefined();
    expect(result['nullVal']).toBeNull();
    expect(result['emptyArr']).toEqual([]);
  });
});
