import { describe, expect, it } from 'vitest';
import type { EndpointContract } from './schema.js';
import { buildApiCallDts, buildApiToolSignatures, buildClientApiDts } from './apicall-dts.js';

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

describe('buildClientApiDts', () => {
  const ep = (name: string, paramNames: string[] = []) => ({ name, paramNames });

  it('types the endpoint name as a literal union so an unknown name cannot compile', () => {
    const dts = buildClientApiDts([ep('costs-list'), ep('trip-summary')]);
    expect(dts).toContain("export type EndpointName = 'costs-list' | 'trip-summary';");
    expect(dts).toContain(
      "export function useApi<T = unknown>(name: 'costs-list' | 'trip-summary', input?: Record<string, unknown>, opts?: UseApiOptions): QueryResult<T>;",
    );
  });

  it('KEEPS the T type parameter — pages author useApi<Alert[]>(…) and must not break', () => {
    // Binding the return type to the endpoint's Output would reject every existing
    // call site in the shipped store apps. Names are narrowed; shapes are not.
    const dts = buildClientApiDts([ep('costs-list')]);
    expect(dts).toContain('useApi<T = unknown>');
    expect(dts).toContain('QueryResult<T>');
  });

  it('requires the route params of a [id] endpoint as a dedicated overload', () => {
    const dts = buildClientApiDts([ep('trips-detail', ['id']), ep('costs-list')]);
    // `input` is REQUIRED (no `?`) and spells out the param — calling it bare is an error.
    expect(dts).toContain(
      "export function useApi<T = unknown>(name: 'trips-detail', input: { id: string | number; [k: string]: unknown }, opts?: UseApiOptions): QueryResult<T>;",
    );
    // …and the param endpoint is EXCLUDED from the optional-input overload, so it can
    // never fall through to it.
    expect(dts).toContain(
      "export function useApi<T = unknown>(name: 'costs-list', input?: Record<string, unknown>, opts?: UseApiOptions): QueryResult<T>;",
    );
  });

  it('spells out every param of a multi-param route', () => {
    const dts = buildClientApiDts([ep('leg-day', ['legId', 'day'])]);
    expect(dts).toContain('input: { legId: string | number; day: string | number; [k: string]: unknown }');
  });

  it('narrows useApiMutation and its invalidates list to real endpoint names', () => {
    const dts = buildClientApiDts([ep('costs-create')]);
    expect(dts).toContain('useApiMutation<T = unknown>(name: EndpointName');
    expect(dts).toContain('invalidates?: EndpointName[]');
  });

  it('returns empty for a project with no endpoints, so the generic fallback is kept', () => {
    // An app mid-authoring (pages written before api/) must still compile.
    expect(buildClientApiDts([])).toBe('');
  });
});
