import { describe, expect, it } from 'vitest';
import type { EndpointContract } from './schema.js';
import { buildApiCallDts, buildApiToolSignatures } from './apicall-dts.js';

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

const GENERIC = 'declare function apiCall(name: string, input?: unknown): Promise<any>;';

describe('buildApiCallDts', () => {
  it('emits a literal-typed overload plus the trailing generic overload', () => {
    const dts = buildApiCallDts([contract()]);
    expect(dts).toContain(
      "declare function apiCall(name: 'markRead', input: { id: string }): Promise<{ ok: boolean }>;",
    );
    expect(dts).toContain(GENERIC);
    // Generic must come last (fallback).
    expect(dts.trimEnd().endsWith(GENERIC)).toBe(true);
  });

  it('returns just the generic overload when there are no endpoints', () => {
    expect(buildApiCallDts([])).toBe(GENERIC);
  });

  it('emits one overload per endpoint before the generic fallback', () => {
    const dts = buildApiCallDts([contract(), contract({ name: 'archive' })]);
    const lines = dts.split('\n');
    expect(lines).toHaveLength(3);
    expect(lines[0]).toContain("name: 'markRead'");
    expect(lines[1]).toContain("name: 'archive'");
    expect(lines[2]).toBe(GENERIC);
  });
});

describe('buildApiToolSignatures', () => {
  it('projects each endpoint to name/description/schemas', () => {
    const sigs = buildApiToolSignatures([contract()]);
    expect(sigs).toEqual([
      {
        name: 'markRead',
        description: 'Mark a message read',
        inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
        outputSchema: { type: 'object', properties: { ok: { type: 'boolean' } } },
      },
    ]);
  });

  it('filters by the allow-list when provided', () => {
    const sigs = buildApiToolSignatures(
      [contract(), contract({ name: 'archive' }), contract({ name: 'del' })],
      ['markRead', 'del'],
    );
    expect(sigs.map((s) => s.name)).toEqual(['markRead', 'del']);
  });

  it('returns all endpoints when no allow-list is given', () => {
    const sigs = buildApiToolSignatures([contract(), contract({ name: 'archive' })]);
    expect(sigs.map((s) => s.name)).toEqual(['markRead', 'archive']);
  });
});
