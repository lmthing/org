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

  it('does not emit a const-with-type-annotation prefix while the initializer is still streaming (live f-loss bug)', () => {
    // A chunk boundary landing right after the type annotation's `}` leaves the buffer
    // holding `const f: { ... }` — a GRAMMATICAL no-init declaration and therefore a
    // complete parse, but never a complete statement: `const` requires an initializer,
    // so this can only ever be a PREFIX of a longer declaration. Emitting it fails
    // typecheck ("'const' declarations must be initialized"), the declaring statement
    // never commits to accumulatedContext, and every later reference dies with
    // "Cannot find name 'f'". The detector must hold until the `=` arrives.
    const stmts = bd.feed('const f: { path: string; kind: string; errors: Array<{ line?: number }> }');
    expect(stmts).toHaveLength(0);
    // The rest of the declaration arrives in the next chunk: the declaration now
    // completes and emits WHOLE, followed by the resolve statement.
    const rest = bd.feed(' =\n  item as { path: string; kind: string; errors: Array<{ line?: number }> };\ncurrentTask.resolve(f.path);\n');
    expect(rest).toHaveLength(2);
    expect(rest[0]).toContain('const f');
    expect(rest[0]).toContain('item as');
    expect(rest[1]).toContain('currentTask.resolve(f.path)');
  });

  it('applies the same error-token gate to the multi-statement branch as the single-statement branch', () => {
    // The single-statement path refuses statements with missing/error tokens, but the
    // statements.length > 1 shortcut returns statements[0] with NO such check — so an
    // orphan fragment like ` = readProjectFile(item.path);` (a real parse error that can
    // never become valid) is EMITTED as a "statement" the moment any second statement
    // follows it in the same chunk. Downstream it fails typecheck with
    // "Declaration or statement expected." and the cascade that follows the prefix-cut
    // above turns into per-fragment retry noise.
    const stmts = bd.feed(' = readProjectFile(item.path);\nconst len = 1;\n');
    expect(stmts).toHaveLength(0);
    expect(bd.flush()).toContain(' = readProjectFile(item.path);');
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
