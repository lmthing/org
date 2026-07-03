import { describe, expect, it } from 'vitest';
import type { EndpointContract } from './schema.js';
import { makeInputValidator, makeValidatorMap } from './validate.js';

function contract(over: Partial<EndpointContract> = {}): EndpointContract {
  return {
    name: 'markRead',
    method: 'POST',
    routePath: '/messages/[id]/read',
    description: 'Mark a message read',
    inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
    outputSchema: { type: 'object', properties: { ok: { type: 'boolean' } } },
    inputTsType: '{ id: string }',
    outputTsType: '{ ok: boolean }',
    ...over,
  };
}

describe('makeInputValidator', () => {
  it('accepts a valid input', () => {
    const validate = makeInputValidator({
      type: 'object',
      properties: { id: { type: 'string' } },
      required: ['id'],
    });
    const result = validate({ id: 'x' });
    expect(result).toEqual({ ok: true, value: { id: 'x' } });
  });

  it('rejects a missing required field with details', () => {
    const validate = makeInputValidator({
      type: 'object',
      properties: { id: { type: 'string' } },
      required: ['id'],
    });
    const result = validate({});
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected failure');
    expect(Array.isArray(result.details)).toBe(true);
    expect((result.details as unknown[]).length).toBeGreaterThan(0);
  });

  it('coerces a query-string number under a number schema', () => {
    const validate = makeInputValidator({
      type: 'object',
      properties: { n: { type: 'number' } },
    });
    const result = validate({ n: '5' });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected success');
    expect(result.value.n).toBe(5);
    expect(typeof result.value.n).toBe('number');
  });

  it('coerces a query-string boolean under a boolean schema', () => {
    const validate = makeInputValidator({
      type: 'object',
      properties: { flag: { type: 'boolean' } },
    });
    const result = validate({ flag: 'true' });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected success');
    expect(result.value.flag).toBe(true);
  });
});

describe('makeValidatorMap', () => {
  it('keys by endpoint name', () => {
    const map = makeValidatorMap([contract()]);
    expect(map.has('markRead')).toBe(true);
    const validator = map.get('markRead')!;
    expect(validator({ id: 'x' })).toEqual({ ok: true, value: { id: 'x' } });
    expect(validator({}).ok).toBe(false);
  });

  it('also keys by "<METHOD> <routePath>"', () => {
    const map = makeValidatorMap([contract()]);
    expect(map.has('POST /messages/[id]/read')).toBe(true);
  });
});
