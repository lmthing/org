import { describe, it, expect } from 'vitest';
import { applyQuery, formatInspectResult } from './inspect.js';

/**
 * Unit coverage for inspect()'s query engine. The end-to-end path (path/keys/count
 * through a real Session) lives in testing/harness-features.test.ts; here we pin the
 * pure transforms — especially filter/slice/search/sample, which the session test
 * doesn't reach — plus the VARIABLES formatter.
 */

describe('applyQuery', () => {
  it('path: walks a dotted path through objects and arrays', () => {
    expect(applyQuery({ a: { b: { c: 7 } } }, { path: 'a.b.c' })).toBe(7);
    expect(applyQuery({ items: [10, 20, 30] }, { path: 'items.1' })).toBe(20);
    expect(applyQuery({ a: 1 }, { path: 'a.missing' })).toBeUndefined();
  });

  it('keys: returns the object keys', () => {
    expect(applyQuery({ x: 1, y: 2, z: 3 }, { keys: true })).toEqual(['x', 'y', 'z']);
  });

  it('count: length of arrays/strings, key count of objects', () => {
    expect(applyQuery([1, 2, 3], { count: true })).toBe(3);
    expect(applyQuery('hello', { count: true })).toBe(5);
    expect(applyQuery({ a: 1, b: 2 }, { count: true })).toBe(2);
  });

  it('count composes after path (count the items at a path)', () => {
    expect(applyQuery({ list: [1, 2, 3, 4] }, { path: 'list', count: true })).toBe(4);
  });

  it('filter: keeps array items matching a predicate (with AND/OR)', () => {
    const arr = [{ n: 1, ok: true }, { n: 5, ok: false }, { n: 9, ok: true }];
    expect(applyQuery(arr, { filter: 'n > 1' })).toEqual([{ n: 5, ok: false }, { n: 9, ok: true }]);
    expect(applyQuery(arr, { filter: 'n > 1 AND ok == true' })).toEqual([{ n: 9, ok: true }]);
  });

  it('slice: returns the [start, end) window of an array', () => {
    expect(applyQuery([1, 2, 3, 4, 5], { slice: [1, 3] })).toEqual([2, 3]);
  });

  it('search: keeps array items whose JSON contains the term (case-insensitive)', () => {
    const arr = [{ name: 'Apple' }, { name: 'banana' }, { name: 'cherry' }];
    expect(applyQuery(arr, { search: 'BAN' })).toEqual([{ name: 'banana' }]);
  });

  it('sample: returns n items, or the whole array when n >= length', () => {
    const arr = [1, 2, 3, 4, 5];
    const sampled = applyQuery(arr, { sample: 3 }) as number[];
    expect(sampled).toHaveLength(3);
    for (const v of sampled) expect(arr).toContain(v);
    expect(applyQuery([1, 2], { sample: 10 })).toEqual([1, 2]); // n >= length → all
  });

  it('leaves non-array values untouched for array-only queries', () => {
    expect(applyQuery('plain', { slice: [0, 2] })).toBe('plain'); // slice only applies to arrays
  });
});

describe('formatInspectResult', () => {
  it('renders a VARIABLES block keyed by index', () => {
    const out = formatInspectResult([{ value: 42 }, { value: 'hi' }]);
    expect(out.split('\n')[0]).toBe('VARIABLES');
    expect(out).toContain('inspected[0]: 42');
    expect(out).toContain('inspected[1]: "hi"');
  });

  it('includes the queried path in the key when present', () => {
    const out = formatInspectResult([{ value: 7, query: { path: 'a.b' } }]);
    expect(out).toContain('inspected[0].a.b: 7');
  });
});
