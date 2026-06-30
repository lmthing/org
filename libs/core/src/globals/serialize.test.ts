import { describe, it, expect } from 'vitest';
import { serialize } from './serialize.js';

describe('serialize', () => {
  it('serializes primitives', () => {
    expect(serialize(null)).toBe('null');
    expect(serialize(undefined)).toBe('undefined');
    expect(serialize(true)).toBe('true');
    expect(serialize(false)).toBe('false');
    expect(serialize(42)).toBe('42');
    expect(serialize(3.14)).toBe('3.14');
  });

  it('serializes short strings', () => {
    expect(serialize('hello')).toBe('"hello"');
  });

  it('truncates long strings with length annotation', () => {
    const long = 'x'.repeat(300);
    const result = serialize(long);
    expect(result).toContain('chars total');
    expect(result.length).toBeLessThan(long.length);
  });

  it('serializes arrays', () => {
    expect(serialize([1, 2, 3])).toBe('[1, 2, 3]');
  });

  it('truncates large arrays', () => {
    const arr = Array.from({ length: 50 }, (_, i) => i);
    const result = serialize(arr);
    expect(result).toContain('items total');
  });

  it('serializes objects', () => {
    const result = serialize({ a: 1, b: 'hello' });
    expect(result).toContain('"a": 1');
    expect(result).toContain('"b": "hello"');
  });

  it('truncates objects with many keys', () => {
    const obj: Record<string, number> = {};
    for (let i = 0; i < 30; i++) obj[`key${i}`] = i;
    const result = serialize(obj);
    expect(result).toContain('keys total');
  });

  it('respects depthCap', () => {
    const deep = { a: { b: { c: { d: { e: { f: { g: 'deep' } } } } } } };
    const result = serialize(deep, { depthCap: 2 });
    expect(result).toContain('truncated');
    expect(result).not.toContain('"g"');
  });

  it('respects byteCap', () => {
    const big = { data: 'x'.repeat(5000) };
    const result = serialize(big, { byteCap: 100 });
    expect(result.length).toBeLessThanOrEqual(160); // cap + truncation message
    expect(result).toContain('truncated');
  });

  it('handles nested arrays', () => {
    const result = serialize([[1, 2], [3, 4]]);
    expect(result).toContain('[1, 2]');
  });

  it('handles nested objects', () => {
    const result = serialize({ a: { b: 1 } });
    expect(result).toContain('"b": 1');
  });

  it('handles ArrayBuffer', () => {
    const buf = new ArrayBuffer(16);
    const result = serialize(buf);
    expect(result).toContain('ArrayBuffer');
    expect(result).toContain('16');
  });
});
