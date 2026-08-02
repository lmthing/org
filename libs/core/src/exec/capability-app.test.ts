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
    'views:write': true,
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
    for (const dropped of ['db:write', 'db:schema', 'views:write', 'api:write', 'hooks:write'] as const) {
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
    expect(dts).not.toContain('writeProjectPage');
    expect(dts).not.toContain('writeProjectApi');
    expect(dts).not.toContain('writeProjectHook');
    expect(dts).not.toContain('writeProjectTable');
    expect(dts).not.toContain('createProject');
    expect(dts).not.toContain('selectProject');
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
    for (const m of ['query(', 'tables(', 'insert(', 'update(', 'createTable(', 'addColumn(']) {
      expect(dts).toContain(m);
    }
    // `remove` (hard delete) is host-only — absent from the model db surface even with db:write.
    expect(dts).not.toContain('remove(');
    expect((dts.match(/declare const db\b/g) ?? []).length).toBe(1); // single db object
  });

  it('api:call / views:write / api:write / hooks:write each add their own declaration', () => {
    expect(dtsFor({ 'api:call': { allow: ['x'] } })).toContain('apiCall');
    expect(dtsFor({ 'views:write': true })).toContain('writeProjectView(');
    expect(dtsFor({ 'api:write': true })).toContain('writeProjectApi');
    expect(dtsFor({ 'hooks:write': true })).toContain('writeProjectHook');
  });

  /**
   * `views:write` is the ONLY UI-authoring capability now that the legacy `pages:write`
   * (freehand-TSX) capability and its writers (`writeProjectPage`/`writeProjectComponent`/
   * `buildApp`) are deleted. The guarantee that used to be "each medium is absent from the
   * other's DTS" collapses to a stronger one: the legacy globals are absent from EVERY agent's
   * DTS, granted or not, because the format cannot represent freehand TSX at all — "renders
   * natively" holds by construction, not by a rule a weak model is asked to respect.
   */
  it('views:write earns the view-spec writers; the deleted legacy TSX writers appear nowhere', () => {
    const viewsOnly = dtsFor({ 'views:write': true });
    expect(viewsOnly).toContain('writeProjectView(');
    expect(viewsOnly).toContain('writeProjectViewComponent(');
    expect(viewsOnly).toContain('writeProjectViewLayout(');
    expect(viewsOnly).toContain('writeProjectViewShell(');
    // The legacy freehand-TSX writers and buildApp are gone entirely — not just ungranted.
    expect(viewsOnly).not.toContain('writeProjectPage(');
    expect(viewsOnly).not.toContain('writeProjectComponent(');
    expect(viewsOnly).not.toContain('buildApp(');

    const noGrants = dtsFor({});
    expect(noGrants).not.toContain('writeProjectView(');
    expect(noGrants).not.toContain('writeProjectPage(');
    expect(noGrants).not.toContain('writeProjectComponent(');
    expect(noGrants).not.toContain('buildApp(');
  });

  it('a read-only role loses views:write like every other authoring grant', () => {
    expect(intersectAppCaps({ 'views:write': true }, false)['views:write']).toBeUndefined();
  });

  it('db:schema ⇒ writeProjectTable authoring global in ADDITION to db.createTable', () => {
    const dts = dtsFor({ 'db:schema': {} });
    expect(dts).toContain('createTable('); // the db member
    expect(dts).toContain('writeProjectTable'); // the live-project authoring twin
    // db:read/db:write alone must NOT earn the table-authoring global
    expect(dtsFor({ 'db:read': {} })).not.toContain('writeProjectTable');
    expect(dtsFor({ 'db:write': {} })).not.toContain('writeProjectTable');
  });

  it('project:manage ⇒ createProject + selectProject declarations', () => {
    const dts = dtsFor({ 'project:manage': true });
    expect(dts).toContain('createProject(');
    expect(dts).toContain('selectProject(');
  });

  it('read-only role drops project:manage / db:schema authoring (intersectAppCaps)', () => {
    const full: AppCapabilities = { 'db:schema': {}, 'project:manage': true, 'db:read': {} };
    const ro = intersectAppCaps(full, false);
    expect(ro['project:manage']).toBeUndefined();
    expect(ro['db:schema']).toBeUndefined();
    expect(ro['db:read']).toEqual({});
  });

  it('delegate context composes app DTS the same way (grants flow to delegates)', () => {
    const dts = buildAmbientDts({ capabilities: { ...delegateCapabilities(true, { 'db:write': {} }) } });
    expect(dts).toContain('insert(');
  });

  it('connections:use ⇒ callConnection declared with the granted provider union; absent otherwise', () => {
    const dts = dtsFor({ 'connections:use': { providers: ['google', 'slack'] } });
    expect(dts).toContain('declare function callConnection(');
    expect(dts).toContain("provider: 'google' | 'slack'");
    expect(dtsFor({})).not.toContain('callConnection');
  });

  it('connections:use survives read-only intersection (outbound, like api:call)', () => {
    const app: AppCapabilities = { 'db:write': {}, 'connections:use': { providers: ['google'] } };
    const ro = intersectAppCaps(app, false);
    expect(ro['connections:use']).toEqual({ providers: ['google'] });
    expect(ro['db:write']).toBeUndefined();
  });
});
