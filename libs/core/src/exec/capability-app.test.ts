import { describe, it, expect } from 'vitest';
import { buildAmbientDts } from './bootstrap.js';
import { sessionCapabilities, forkCapabilities, delegateCapabilities, intersectAppCaps } from './capability.js';
import type { AppCapabilities } from '../spaces/capabilities.js';

/**
 * Phase 1 registry invariants: the `capabilities:` grants drive BOTH the ambient DTS
 * (here) and injection (gated on projectRoot, see app-globals) in lockstep. "Cap not
 * granted ⇒ absent from the DTS" so a stray call fails typecheck — the same guarantee
 * the boolean flags give ask/fork/delegate.
 */
describe('intersectAppCaps — read-only roles lose write/authoring grants', () => {
  const full: AppCapabilities = {
    'db:read': { tables: ['a'] },
    'db:write': { tables: ['a'] },
    'db:schema': {},
    'pages:write': true,
    'api:write': true,
    'hooks:write': true,
    'api:call': { allow: ['x'] },
  };

  it('allowWrite:true passes the grants through unchanged', () => {
    expect(intersectAppCaps(full, true)).toEqual(full);
  });

  it('allowWrite:false keeps only read/outbound (db:read, api:call), drops every mutating/authoring grant', () => {
    const ro = intersectAppCaps(full, false);
    expect(ro).toEqual({ 'db:read': { tables: ['a'] }, 'api:call': { allow: ['x'] } });
    for (const dropped of ['db:write', 'db:schema', 'pages:write', 'api:write', 'hooks:write'] as const) {
      expect(ro[dropped]).toBeUndefined();
    }
  });

  it('forkCapabilities intersects by role: explore drops writes, general keeps them', () => {
    expect(forkCapabilities('explore', false, full).app).toEqual({ 'db:read': { tables: ['a'] }, 'api:call': { allow: ['x'] } });
    expect(forkCapabilities('general', false, full).app).toEqual(full);
  });
});

describe('buildAmbientDts — app-capability DTS composition', () => {
  const dtsFor = (app: AppCapabilities): string =>
    buildAmbientDts({ capabilities: { ...sessionCapabilities(true, app) } });

  it('no app grants ⇒ no db / apiCall / authoring declarations', () => {
    const dts = dtsFor({});
    expect(dts).not.toMatch(/declare const db\b/);
    expect(dts).not.toContain('apiCall');
    expect(dts).not.toContain('writePage');
    expect(dts).not.toContain('writeApi');
    expect(dts).not.toContain('writeHook');
  });

  it('db:read only ⇒ db has query/tables but NOT insert/createTable', () => {
    const dts = dtsFor({ 'db:read': { tables: ['x'] } });
    expect(dts).toMatch(/declare const db\b/);
    expect(dts).toContain('query(');
    expect(dts).toContain('tables(');
    expect(dts).not.toContain('insert(');
    expect(dts).not.toContain('createTable(');
  });

  it('db:read + db:write + db:schema ⇒ all verbs on one db object', () => {
    const dts = dtsFor({ 'db:read': {}, 'db:write': {}, 'db:schema': {} });
    for (const m of ['query(', 'tables(', 'insert(', 'update(', 'remove(', 'createTable(', 'addColumn(']) {
      expect(dts).toContain(m);
    }
    expect((dts.match(/declare const db\b/g) ?? []).length).toBe(1); // single db object
  });

  it('api:call / pages:write / api:write / hooks:write each add their own declaration', () => {
    expect(dtsFor({ 'api:call': { allow: ['x'] } })).toContain('apiCall');
    expect(dtsFor({ 'pages:write': true })).toContain('writePage');
    expect(dtsFor({ 'api:write': true })).toContain('writeApi');
    expect(dtsFor({ 'hooks:write': true })).toContain('writeHook');
  });

  it('delegate context composes app DTS the same way (grants flow to delegates)', () => {
    const dts = buildAmbientDts({ capabilities: { ...delegateCapabilities(true, { 'db:write': {} }) } });
    expect(dts).toContain('insert(');
  });
});
