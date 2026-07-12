import { describe, it, expect } from 'vitest';
import {
  COMMON_DTS,
  LIBRARY_DTS,
  LIBRARY_DTS_NO_ASK,
  EXEC_SHELL_DTS,
  WRITE_FILE_RAW_DTS,
  composeDbDts,
  API_CALL_DTS,
  PAGES_WRITE_DTS,
  API_WRITE_DTS,
  PROJECT_PAGE_DTS,
  PROJECT_API_DTS,
  HOOKS_WRITE_DTS,
  PROJECT_AUTHORING_DTS,
  PROJECT_MANAGE_DTS,
  WRITE_TABLE_SCHEMA_DTS,
  PROJECT_TABLE_DTS,
  STORE_READ_DTS,
  STORE_INSTALL_DTS,
  EVENTS_EMIT_DTS,
  CAPABILITY_DTS_FRAGMENTS,
  composeConnectionsDts,
} from './library-dts.js';

describe('library-dts write primitives are gated', () => {
  it('COMMON_DTS no longer declares execShell/writeFileRaw', () => {
    expect(COMMON_DTS).not.toContain('execShell');
    expect(COMMON_DTS).not.toContain('writeFileRaw');
  });

  it('LIBRARY_DTS still includes both write primitives via fragments', () => {
    expect(LIBRARY_DTS).toContain('declare function execShell(');
    expect(LIBRARY_DTS).toContain('declare function writeFileRaw(');
  });

  it('LIBRARY_DTS_NO_ASK also includes both write primitives but not ask', () => {
    expect(LIBRARY_DTS_NO_ASK).toContain('declare function execShell(');
    expect(LIBRARY_DTS_NO_ASK).toContain('declare function writeFileRaw(');
    expect(LIBRARY_DTS_NO_ASK).not.toContain('declare function ask');
  });

  it('the split fragments carry the verbatim signatures', () => {
    expect(EXEC_SHELL_DTS).toContain('execShell(cmd: string');
    expect(WRITE_FILE_RAW_DTS).toContain('writeFileRaw(path: string, content: string)');
  });
});

describe('composeDbDts', () => {
  it('returns empty string when no db capability is present', () => {
    expect(composeDbDts({})).toBe('');
  });

  it('read-only exposes query/tables but not write members', () => {
    const dts = composeDbDts({ read: true });
    expect(dts).toContain('declare const db: {');
    expect(dts).toContain('query(');
    expect(dts).toContain('tables(');
    expect(dts).not.toContain('insert(');
  });

  it('all three capabilities emit six members inside ONE declare const db', () => {
    const dts = composeDbDts({ read: true, write: true, schema: true });
    // exactly one db declaration
    expect(dts.match(/declare const db/g)?.length).toBe(1);
    for (const m of ['query(', 'tables(', 'insert(', 'update(', 'remove(', 'createTable(', 'addColumn(']) {
      expect(dts).toContain(m);
    }
  });

  it('db.* signatures are synchronous (no Promise)', () => {
    const dts = composeDbDts({ read: true, write: true, schema: true });
    expect(dts).not.toContain('Promise');
  });
});

describe('standalone capability fragments', () => {
  it('apiCall is value-yielding (Promise)', () => {
    expect(API_CALL_DTS).toContain('declare function apiCall(');
    expect(API_CALL_DTS).toContain('Promise<any>');
    expect(API_CALL_DTS.trim().length).toBeGreaterThan(0);
  });

  it('composeConnectionsDts types provider as the granted union and is value-yielding', () => {
    const dts = composeConnectionsDts(['google', 'slack']);
    expect(dts).toContain('declare function callConnection(');
    expect(dts).toContain("provider: 'google' | 'slack'");
    expect(dts).toContain('Promise<{ ok: boolean; status: number; data: any }>');
  });

  it('composeConnectionsDts falls back to `string` for an empty provider list', () => {
    expect(composeConnectionsDts([])).toContain('provider: string');
  });

  it('callConnection is capability-gated: absent from COMMON_DTS/LIBRARY_DTS (like apiCall)', () => {
    expect(COMMON_DTS).not.toContain('callConnection');
    expect(LIBRARY_DTS).not.toContain('callConnection');
    expect(CAPABILITY_DTS_FRAGMENTS['connections:use']).toBeUndefined();
  });

  it('the write helpers are non-empty one-liners', () => {
    for (const frag of [PAGES_WRITE_DTS, API_WRITE_DTS, HOOKS_WRITE_DTS]) {
      expect(frag.trim().length).toBeGreaterThan(0);
      expect(frag).not.toContain('\n');
      expect(frag).toContain('declare function');
    }
  });
});

describe('CAPABILITY_DTS_FRAGMENTS registry', () => {
  it('maps the standalone capability ids and omits the db trio', () => {
    expect(CAPABILITY_DTS_FRAGMENTS).toEqual({
      'api:call': API_CALL_DTS,
      'pages:write': [PAGES_WRITE_DTS, PROJECT_PAGE_DTS].join('\n'),
      'api:write': [API_WRITE_DTS, PROJECT_API_DTS].join('\n'),
      'hooks:write': [HOOKS_WRITE_DTS, PROJECT_AUTHORING_DTS].join('\n'),
      'project:manage': PROJECT_MANAGE_DTS,
      'store:read': STORE_READ_DTS,
      'store:install': STORE_INSTALL_DTS,
      'events:emit': EVENTS_EMIT_DTS,
    });
    // db:schema is composed onto the `db` object, but ALSO earns the standalone
    // writeTableSchema authoring global (emitted directly in buildAppCapabilityDts),
    // so it is deliberately NOT a flat-map entry.
    expect(CAPABILITY_DTS_FRAGMENTS['db:read']).toBeUndefined();
    expect(CAPABILITY_DTS_FRAGMENTS['db:schema']).toBeUndefined();
  });

  it('PROJECT_AUTHORING_DTS declares the three live-project writers under hooks:write', () => {
    expect(PROJECT_AUTHORING_DTS).toContain('writeProjectHook(');
    expect(PROJECT_AUTHORING_DTS).toContain('writeProjectEvent(');
    expect(PROJECT_AUTHORING_DTS).toContain('writeProjectFunction(');
    // hooks:write earns BOTH the catalog writeHook and the live-project writers.
    expect(CAPABILITY_DTS_FRAGMENTS['hooks:write']).toContain('writeHook(');
    expect(CAPABILITY_DTS_FRAGMENTS['hooks:write']).toContain('writeProjectHook(');
  });

  it('PROJECT_MANAGE_DTS declares createProject + selectProject; WRITE_TABLE_SCHEMA_DTS declares writeTableSchema', () => {
    expect(PROJECT_MANAGE_DTS).toContain('createProject(');
    expect(PROJECT_MANAGE_DTS).toContain('selectProject(');
    expect(WRITE_TABLE_SCHEMA_DTS).toContain('writeTableSchema(');
  });

  it('PROJECT_TABLE_DTS declares the live-project table writer (db:schema twin)', () => {
    expect(PROJECT_TABLE_DTS).toContain('writeProjectTable(');
  });

  it('pages:write / api:write earn BOTH the catalog and live-project writers', () => {
    // pages:write → writePage (catalog) + writeProjectPage (live project)
    expect(CAPABILITY_DTS_FRAGMENTS['pages:write']).toContain('writePage(');
    expect(CAPABILITY_DTS_FRAGMENTS['pages:write']).toContain('writeProjectPage(');
    // api:write → writeApi (catalog) + writeProjectApi (live project)
    expect(CAPABILITY_DTS_FRAGMENTS['api:write']).toContain('writeApi(');
    expect(CAPABILITY_DTS_FRAGMENTS['api:write']).toContain('writeProjectApi(');
  });
});
