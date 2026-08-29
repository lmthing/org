import { describe, it, expect } from 'vitest';
import { extractBindingNames, emitVariables } from './variables.js';

describe('extractBindingNames', () => {
  it('extracts simple identifiers', () => {
    expect(extractBindingNames('const x = 42')).toEqual(['x']);
    expect(extractBindingNames('let foo = "bar"')).toEqual(['foo']);
    expect(extractBindingNames('var count = 0')).toEqual(['count']);
  });

  it('extracts typed declarations (TS type annotations)', () => {
    expect(extractBindingNames('const name: string = "hello"')).toEqual(['name']);
    expect(extractBindingNames('const items: any[] = []')).toEqual(['items']);
    expect(extractBindingNames('let results: Array<string> = []')).toEqual(['results']);
    expect(extractBindingNames('const count: number = 0')).toEqual(['count']);
  });

  it('extracts object destructuring', () => {
    expect(extractBindingNames('const { a, b } = obj')).toEqual(['a', 'b']);
    expect(extractBindingNames('const { x, y, z } = point')).toEqual(['x', 'y', 'z']);
  });

  it('extracts array destructuring', () => {
    expect(extractBindingNames('const [first, second] = arr')).toEqual(['first', 'second']);
  });

  it('strips leading comments', () => {
    expect(extractBindingNames('// a comment\nconst val = 5')).toEqual(['val']);
    expect(extractBindingNames('// comment\nlet typed: string = "x"')).toEqual(['typed']);
  });

  it('returns empty for non-declarations', () => {
    expect(extractBindingNames('await sleep("1s")')).toEqual([]);
    expect(extractBindingNames('display("hello")')).toEqual([]);
    expect(extractBindingNames('foo.push(bar)')).toEqual([]);
  });

  it('extracts function declarations (regression: E4 — later statements ReferenceError while typecheck passes)', () => {
    expect(extractBindingNames('function parseDuration(s: string): number {\n  return 0;\n}')).toEqual(['parseDuration']);
    expect(extractBindingNames('async function loadAll() {\n  return [];\n}')).toEqual(['loadAll']);
    expect(extractBindingNames('function* gen() { yield 1; }')).toEqual(['gen']);
    expect(extractBindingNames('// helper\nfunction helper() {}')).toEqual(['helper']);
  });

  it('extracts class declarations', () => {
    expect(extractBindingNames('class Parser {\n  parse() {}\n}')).toEqual(['Parser']);
    expect(extractBindingNames('abstract class Base {}')).toEqual(['Base']);
  });

  it('does not extract type-only declarations (no runtime binding exists)', () => {
    expect(extractBindingNames('type Opts = { a: number };')).toEqual([]);
    expect(extractBindingNames('interface Shape { x: number }')).toEqual([]);
  });

  it('handles complex types in declarations', () => {
    expect(extractBindingNames('const data: { key: string; val: number } = { key: "a", val: 1 }')).toEqual(['data']);
    expect(extractBindingNames('const fn: (x: number) => string = x => String(x)')).toEqual(['fn']);
  });

  it('extracts all names from multi-variable declarations (regression: const a=x, b=y, c=z)', () => {
    // Bug: non-greedy regex only captured the first declarator; b/c/d/e were never set in globalThis
    expect(extractBindingNames('const qAr=qA as any, qBr=qB as any, qCr=qC as any, qDr=qD as any, qEr=qE as any')).toEqual(['qAr', 'qBr', 'qCr', 'qDr', 'qEr']);
    expect(extractBindingNames('const a=1, b=2, c=3')).toEqual(['a', 'b', 'c']);
    expect(extractBindingNames('let x=foo(), y=bar()')).toEqual(['x', 'y']);
    // Single-var still works
    expect(extractBindingNames('const x = obj.y = z')).toEqual(['x']);
    // Nested commas inside value (e.g. arrow fn) — only top-level names extracted
    expect(extractBindingNames('const fn = (a, b=2) => a+b')).toEqual(['fn']);
    // Object literal value with commas — only top-level name extracted
    expect(extractBindingNames('const data = { a: 1, b: 2 }')).toEqual(['data']);
  });

  it('handles declarations with no initializer (so they propagate to globalThis)', () => {
    expect(extractBindingNames('let parsed;')).toEqual(['parsed']);
    expect(extractBindingNames('let parsed')).toEqual(['parsed']);
    expect(extractBindingNames('let a, b;')).toEqual(['a', 'b']);
    expect(extractBindingNames('let x: string;')).toEqual(['x']);
    expect(extractBindingNames('var result;')).toEqual(['result']);
  });

  it('handles no-initializer declarations whose type annotation has internal `;`/`,` (live bug: a flat [^=;] class stopped at the first one, dropping the binding — the model then hit "\'w\' is not defined" on the very next statement)', () => {
    expect(extractBindingNames('let w: { ok: boolean; error?: string };')).toEqual(['w']);
    expect(extractBindingNames('let w2: { ok: boolean; error?: string };')).toEqual(['w2']);
    expect(extractBindingNames('let pair: { a: number, b: number };')).toEqual(['pair']);
    expect(extractBindingNames('let cb: (a: number, b: number) => void;')).toEqual(['cb']);
    // Multi-line no-initializer declaration
    expect(extractBindingNames('let w: {\n  ok: boolean;\n  error?: string;\n};')).toEqual(['w']);
    // A multi-line WITH-initializer declaration must NOT be mistaken for no-init just
    // because the with-initializer regex above can't see an `=` past the first line —
    // hasTopLevelEquals must catch the `=` on the later line and bail out (same
    // no-names-extracted behavior as before this fix, not a regression).
    expect(extractBindingNames('let w: {\n  ok: boolean;\n} = { ok: true };')).toEqual([]);
  });
});

describe('emitVariables', () => {
  it('formats variable values', () => {
    const result = emitVariables({ x: 42, name: 'Alice' });
    expect(result).toContain('VARIABLES');
    expect(result).toContain('x: 42');
    expect(result).toContain('name: "Alice"');
  });

  it('includes SCOPE for declared variables not in vars', () => {
    const result = emitVariables({ x: 42 }, 'const y = 10\nconst x = 1');
    expect(result).toContain('SCOPE');
    // y should be in SCOPE (declared but not in current vars)
    expect(result).toMatch(/SCOPE.*y/);
    // x should NOT be in SCOPE (it's in vars)
    expect(result).not.toMatch(/SCOPE.*x/);
  });

  it('includes ALREADY EXECUTED for non-declaration statements', () => {
    const result = emitVariables({}, 'const x = 1\nawait sleep("1s")\ndisplay("hello")');
    expect(result).toContain('ALREADY EXECUTED');
    expect(result).toContain('await sleep("1s")');
  });

  it('handles empty vars', () => {
    const result = emitVariables({});
    expect(result).toContain('VARIABLES');
  });
});

describe('emitVariables — ALREADY-EXECUTED bounding & omission (small-model context cap)', () => {
  const bigContext = Array.from({ length: 600 }, (_, i) => `const v${i} = ${i};`).join('\n'); // ~9.6KB > 8k window

  it('bounds a huge echo on the SUCCESS path exactly like the error path', () => {
    // Regression: the error path capped this echo long ago; the far more frequent
    // yield-resume path never did — the quadratic driver of runaway-turn history.
    const out = emitVariables({ x: 1 }, bigContext);
    expect(out).toMatch(/earlier statements omitted/);
    expect(out).toContain('const v599 = 599;'); // recent tail kept verbatim
    expect(out).not.toContain('const v0 = 0;'); // early statement dropped from the echo
    // SCOPE line (from the FULL context) still advertises every binding.
    const scopeLine = out.split('\n').find((l) => l.startsWith('SCOPE')) ?? '';
    expect(scopeLine).toContain('v0');
    expect(scopeLine).toContain('v599');
  });

  it('omitExecuted leaves the echo out entirely but keeps the SCOPE line', () => {
    const out = emitVariables({ x: 1 }, bigContext, { omitExecuted: true });
    expect(out).not.toContain('ALREADY EXECUTED');
    expect(out).toContain('SCOPE');
  });
});
