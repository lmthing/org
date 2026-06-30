import { describe, it, expect, beforeEach } from 'vitest';
import { BoundaryDetector } from './boundary.js';

describe('BoundaryDetector', () => {
  let bd: BoundaryDetector;

  beforeEach(() => {
    bd = new BoundaryDetector();
  });

  it('extracts a simple const declaration', () => {
    const stmts = bd.feed('const x = 1;\n');
    expect(stmts).toHaveLength(1);
    expect(stmts[0]).toContain('const x = 1');
  });

  it('does not emit until statement is complete', () => {
    let stmts = bd.feed('const x = ');
    expect(stmts).toHaveLength(0);
    stmts = bd.feed('1;');
    expect(stmts).toHaveLength(1);
    expect(stmts[0]).toContain('const x = 1;');
  });

  it('extracts multiple complete statements', () => {
    const stmts = bd.feed('const a = 1;\nconst b = 2;\n');
    expect(stmts).toHaveLength(2);
  });

  it('does not carve a bare identifier out of an apostrophe prose line', () => {
    // "I'll start by" parses as `I` + an unterminated string. The detector must NOT
    // emit just "I" (which would escape the prose-drop and fail typecheck). With no
    // newline yet, it waits; flush() then surfaces the whole prose line.
    const stmts = bd.feed("I'll start by loading the knowledge");
    expect(stmts).toHaveLength(0);
    expect(bd.flush()).toBe("I'll start by loading the knowledge");
  });

  it('surfaces a whole prose line (not a fragment) when code follows on the next line', () => {
    const stmts = bd.feed("I'll do this\nconst x = 1;\n");
    // First chunk returned is the entire prose line (for the turn loop to prose-drop),
    // followed by the real statement.
    expect(stmts[0]).toBe("I'll do this");
    expect(stmts.some((s) => s.includes('const x = 1'))).toBe(true);
  });

  it('handles block statements with closing brace', () => {
    const code = 'function hello() {\n  return 42;\n}\n';
    const stmts = bd.feed(code);
    expect(stmts).toHaveLength(1);
    expect(stmts[0]).toContain('function hello()');
  });

  it('handles arrow functions', () => {
    const code = 'const fn = (x: number) => x * 2;\n';
    const stmts = bd.feed(code);
    expect(stmts).toHaveLength(1);
  });

  it('handles incomplete block (no closing brace)', () => {
    const stmts = bd.feed('function hello() {\n  return 42;');
    expect(stmts).toHaveLength(0);
  });

  it('flush returns leftover partial text', () => {
    bd.feed('const x = ');
    expect(bd.flush()).toBe('const x = ');
  });

  it('reset clears the buffer', () => {
    bd.feed('const x = 1');
    bd.reset();
    expect(bd.flush()).toBe('');
  });

  it('handles streamed input one character at a time', () => {
    const code = 'const y = 42;';
    const all: string[] = [];
    for (const ch of code) {
      all.push(...bd.feed(ch));
    }
    // May not emit until full statement; feed trailing newline
    all.push(...bd.feed('\n'));
    expect(all.length).toBeGreaterThanOrEqual(1);
    expect(all.join('')).toContain('const y = 42');
  });

  it('handles destructuring', () => {
    const stmts = bd.feed('const { a, b } = obj;\n');
    expect(stmts).toHaveLength(1);
  });

  it('handles template literals', () => {
    const stmts = bd.feed('const s = `hello ${name}`;\n');
    expect(stmts).toHaveLength(1);
  });

  it('does not prematurely extract incomplete template literal', () => {
    const stmts = bd.feed('const s = `hello ');
    expect(stmts).toHaveLength(0);
  });

  it('handles if/else block', () => {
    const code = 'if (x > 0) {\n  y = 1;\n} else {\n  y = 0;\n}\n';
    const stmts = bd.feed(code);
    expect(stmts).toHaveLength(1);
  });

  it('handles expression statements', () => {
    const stmts = bd.feed('console.log("hi");\n');
    expect(stmts).toHaveLength(1);
  });

  it('handles await expression statement', () => {
    const stmts = bd.feed('await sleep("1s");\n');
    expect(stmts).toHaveLength(1);
  });
});
