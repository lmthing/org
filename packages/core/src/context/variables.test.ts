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

  it('handles complex types in declarations', () => {
    expect(extractBindingNames('const data: { key: string; val: number } = { key: "a", val: 1 }')).toEqual(['data']);
    expect(extractBindingNames('const fn: (x: number) => string = x => String(x)')).toEqual(['fn']);
  });

  it('handles declarations with no initializer (so they propagate to globalThis)', () => {
    expect(extractBindingNames('let parsed;')).toEqual(['parsed']);
    expect(extractBindingNames('let parsed')).toEqual(['parsed']);
    expect(extractBindingNames('let a, b;')).toEqual(['a', 'b']);
    expect(extractBindingNames('let x: string;')).toEqual(['x']);
    expect(extractBindingNames('var result;')).toEqual(['result']);
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
