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

  it('flags sentence prose that ends in a semicolon (live: "Cannot find name \'Wait\'")', () => {
    // The model narrates in code position and ends the sentence with `;`. The
    // code-punctuation guard treats ANY `;` as code, so the line survives the prose
    // drop and burns a retry on exactly:
    //   Cannot find name 'Wait'.; Left side of comma operator is unused and has no side effects.
    // A comma after the first word plus English function words is still prose — a real
    // TS statement cannot start `Wait, ` (two sequence expressions in one line is not a
    // shape models emit as code, and the all-word-like guard below keeps it conservative).
    expect(looksLikeProse('Wait, I need to read the shell first;')).toBe(true);
    expect(looksLikeProse('Sure, let me check the nav entries;')).toBe(true);
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

  it('drops prose that QUOTES code in backticks / bracketed paths (live: "Unexpected keyword or identifier" cascade)', () => {
    // Model prose ABOUT code quotes identifiers — "Now I'll create the `views/books/[id]`
    // detail page." — so the sentence hit `` ` ``/`[`/`]` and was classified as code,
    // then evaluated, producing the largest single error group of the live build
    // ("Unexpected keyword or identifier." 2-6x per chunk, "Module declaration names
    // may only use quoted strings", "A type predicate is …"). Backticked spans and
    // bare bracketed path segments are stripped BEFORE the code-punctuation guard.
    expect(looksLikeProse('Now I\'ll create the `views/books/[id]` detail page.')).toBe(true);
    expect(looksLikeProse('The comments I wrote outside of `//` syntax caused the parse error.')).toBe(true);
    expect(looksLikeProse('Next, let me wire the `books-list` query into the list section.')).toBe(true);
    expect(looksLikeProse('I\'ve added `api/book-create/POST.ts` — now the edit form.')).toBe(true);
    // Bare bracketed path segment, no backticks at all.
    expect(looksLikeProse('Now the page under views [id] is wired into the section.')).toBe(true);
  });

  it('does NOT drop real code that contains backticks or bracketed paths (regression guards)', () => {
    // Real statements keep their operators (`=`, parens, braces) OUTSIDE any literal,
    // so stripping the quoted spans can never make them read as prose.
    expect(looksLikeProse('const q = `SELECT * FROM books`;')).toBe(false); // `=` survives the strip
    expect(looksLikeProse("writeProjectView('books', { kind: 'list' });")).toBe(false);
    expect(looksLikeProse('type X = { a: string };')).toBe(false);
    expect(looksLikeProse('await writePage(`views/books/[id]`, spec);')).toBe(false); // parens + await survive
    expect(looksLikeProse("const path = 'views/books/[id]';")).toBe(false);
    expect(looksLikeProse('render(`books-list`)')).toBe(false);
    expect(looksLikeProse('result[0]')).toBe(false); // strip leaves `result` → <3 words → kept
    expect(looksLikeProse('items[i]')).toBe(false);
  });

  it('keeps a lone template literal and an UNPAIRED backtick (conservative: never drop real code)', () => {
    // A lone template-literal probe: stripping empties the string → keep as code.
    expect(looksLikeProse('`SELECT * FROM books`;')).toBe(false);
    expect(looksLikeProse('db `books`')).toBe(false); // tagged template → `db` → <3 words → kept
    // An unpaired backtick is left in place, trips the punctuation guard → kept as code,
    // even when the surrounding text reads like prose.
    expect(looksLikeProse('Now I\'ll create the `views/books/[id] detail page.')).toBe(false);
  });

  it('keeps comments, closers and think tags', () => {
    expect(looksLikeProse('// creates the detail page for views/books/[id]')).toBe(false);
    expect(looksLikeProse('}')).toBe(false);
    expect(looksLikeProse('});')).toBe(false);
    expect(looksLikeProse('</think>')).toBe(false); // prior regression — guard ordering handles it
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
