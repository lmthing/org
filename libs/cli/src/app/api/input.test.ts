/**
 * Method-aware input assembly ({@link ./input.ts}) — one Input object, path
 * params always win, GET/DELETE from query, POST/PATCH/PUT from body, lenient
 * non-object body, pass-through validator.
 */
import { describe, it, expect } from 'vitest';
import {
  assembleInput,
  passThroughValidator,
  parseQuery,
  type HttpMethod,
} from './input.js';

describe('assembleInput', () => {
  it('GET merges query + path params (path wins on key clash)', () => {
    const input = assembleInput('GET', { id: 'p1' }, { id: 'q1', unreadOnly: 'true' }, undefined);
    expect(input).toEqual({ id: 'p1', unreadOnly: 'true' });
  });

  it('DELETE reads its non-path input from the query string', () => {
    const input = assembleInput('DELETE', { id: '7' }, { soft: 'true' }, undefined);
    expect(input).toEqual({ id: '7', soft: 'true' });
  });

  it('POST merges body + path params (path wins)', () => {
    const input = assembleInput('POST', { id: 'p1' }, {}, { id: 'body-id', title: 'hi' });
    expect(input).toEqual({ id: 'p1', title: 'hi' });
  });

  it.each<HttpMethod>(['PATCH', 'PUT'])('%s reads its non-path input from the body', (method) => {
    const input = assembleInput(method, {}, {}, { title: 'hi' });
    expect(input).toEqual({ title: 'hi' });
  });

  it('ignores the body for query methods', () => {
    const input = assembleInput('GET', {}, { a: '1' }, { b: 2 });
    expect(input).toEqual({ a: '1' });
  });

  it('leniently wraps a non-object (array) body as {} then merges params', () => {
    expect(assembleInput('POST', { id: '1' }, {}, [1, 2, 3])).toEqual({ id: '1' });
  });

  it('leniently wraps a primitive / null body', () => {
    expect(assembleInput('POST', { id: '1' }, {}, 'nope')).toEqual({ id: '1' });
    expect(assembleInput('POST', {}, {}, null)).toEqual({});
  });

  it('returns a fresh object (does not mutate inputs)', () => {
    const params = { id: 'p1' };
    const body = { title: 'hi' };
    const input = assembleInput('POST', params, {}, body);
    expect(input).not.toBe(params);
    expect(input).not.toBe(body);
    expect(body).toEqual({ title: 'hi' });
  });
});

describe('passThroughValidator', () => {
  it('accepts every input unchanged (no coercion in Phase 3)', () => {
    const input = { id: '1', unreadOnly: 'true' };
    const res = passThroughValidator(input);
    expect(res).toEqual({ ok: true, value: input });
    if (res.ok) expect(res.value).toBe(input);
  });
});

describe('parseQuery', () => {
  it('parses a search string into a flat string map', () => {
    expect(parseQuery('?a=1&b=two')).toEqual({ a: '1', b: 'two' });
  });
  it('accepts a bare (no leading ?) search string', () => {
    expect(parseQuery('a=1')).toEqual({ a: '1' });
  });
  it('repeated keys are last-wins', () => {
    expect(parseQuery('a=1&a=2')).toEqual({ a: '2' });
  });
  it('empty string → empty object', () => {
    expect(parseQuery('')).toEqual({});
  });
});
