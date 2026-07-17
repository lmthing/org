import { describe, it, expect } from 'vitest';
import {
  COMMON_DTS,
  LIBRARY_DTS,
  LIBRARY_DTS_NO_ASK,
  EXEC_SHELL_DTS,
  WRITE_FILE_RAW_DTS,
  READ_FILE_RAW_DTS,
  SCRATCH_DTS,
  composeDbDts,
  API_CALL_DTS,
  PROJECT_PAGE_DTS,
  PROJECT_COMPONENT_DTS,
  PROJECT_API_DTS,
  PROJECT_AUTHORING_DTS,
  PROJECT_MANAGE_DTS,
  PROJECT_TABLE_DTS,
  STORE_READ_DTS,
  STORE_INSTALL_DTS,
  EVENTS_EMIT_DTS,
  KNOWLEDGE_WRITE_DTS,
  CAPABILITY_DTS_FRAGMENTS,
  composeConnectionsDts,
  PROJECT_READ_DTS,
} from './library-dts.js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

describe('library-dts write primitives are gated', () => {
  it('COMMON_DTS declares NONE of the generic fs primitives (execShell/writeFileRaw/readFileRaw)', () => {
    expect(COMMON_DTS).not.toContain('execShell');
    expect(COMMON_DTS).not.toContain('writeFileRaw');
    // readFileRaw moved OUT of COMMON_DTS (it was the last always-declared raw primitive) —
    // it is internal-only now, present only in the LIBRARY_DTS bundle for typecheckSource.
    expect(COMMON_DTS).not.toContain('readFileRaw');
  });

  it('LIBRARY_DTS still includes all three raw primitives via fragments (for typecheckSource)', () => {
    expect(LIBRARY_DTS).toContain('declare function execShell(');
    expect(LIBRARY_DTS).toContain('declare function writeFileRaw(');
    expect(LIBRARY_DTS).toContain('declare function readFileRaw(');
  });

  it('LIBRARY_DTS_NO_ASK also includes all three raw primitives but not ask', () => {
    expect(LIBRARY_DTS_NO_ASK).toContain('declare function execShell(');
    expect(LIBRARY_DTS_NO_ASK).toContain('declare function writeFileRaw(');
    expect(LIBRARY_DTS_NO_ASK).toContain('declare function readFileRaw(');
    expect(LIBRARY_DTS_NO_ASK).not.toContain('declare function ask');
  });

  it('the split fragments carry the verbatim signatures', () => {
    expect(EXEC_SHELL_DTS).toContain('execShell(cmd: string');
    expect(WRITE_FILE_RAW_DTS).toContain('writeFileRaw(path: string, content: string)');
    expect(READ_FILE_RAW_DTS).toContain('readFileRaw(path: string');
    expect(SCRATCH_DTS).toContain('createScratch()');
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

  it('the live-project write helpers are non-empty one-liners', () => {
    for (const frag of [PROJECT_PAGE_DTS, PROJECT_API_DTS, PROJECT_COMPONENT_DTS]) {
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
      'pages:write': [PROJECT_PAGE_DTS, PROJECT_COMPONENT_DTS].join('\n'),
      'api:write': PROJECT_API_DTS,
      'hooks:write': PROJECT_AUTHORING_DTS,
      'project:manage': PROJECT_MANAGE_DTS,
      'store:read': STORE_READ_DTS,
      'store:install': STORE_INSTALL_DTS,
      'events:emit': EVENTS_EMIT_DTS,
      'knowledge:write': KNOWLEDGE_WRITE_DTS,
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
    // hooks:write is now the live-project writers ONLY (the catalog writeHook is gone).
    expect(CAPABILITY_DTS_FRAGMENTS['hooks:write']).toContain('writeProjectHook(');
  });

  it('PROJECT_MANAGE_DTS declares createProject + selectProject', () => {
    expect(PROJECT_MANAGE_DTS).toContain('createProject(');
    expect(PROJECT_MANAGE_DTS).toContain('selectProject(');
  });

  it('PROJECT_TABLE_DTS declares the live-project table writer (db:schema twin)', () => {
    expect(PROJECT_TABLE_DTS).toContain('writeProjectTable(');
  });

  it('pages:write / api:write earn the live-project writers (the catalog writers are gone)', () => {
    // pages:write → writeProjectPage + writeProjectComponent (live project)
    expect(CAPABILITY_DTS_FRAGMENTS['pages:write']).toContain('writeProjectPage(');
    expect(CAPABILITY_DTS_FRAGMENTS['pages:write']).toContain('writeProjectComponent(');
    // api:write → writeProjectApi (live project)
    expect(CAPABILITY_DTS_FRAGMENTS['api:write']).toContain('writeProjectApi(');
  });
});

// A live scenario (09-home-renovation) repeatedly hit a RECOVERED typecheck error inside the
// automator: `Property 'text' does not exist on type '{ ok; content; error }'` — the model read a
// `readProjectFile()` result via `.text` (readDocument's field) instead of `.content`. The two
// readers return DIFFERENT field names; the automator instruct must document `readProjectFile`'s
// `.content` explicitly so the model has a correct example to copy. These tests lock both the DTS
// shape and the instruct guidance that a fix like that depends on.
describe('project-file reader field names are unambiguous (readProjectFile.content vs readDocument.text)', () => {
  it('PROJECT_READ_DTS: readProjectFile returns .content (a project file body is content, not text)', () => {
    expect(PROJECT_READ_DTS).toContain('readProjectFile(path: string): { ok: boolean; content: string');
    // The field is content, never text — text belongs to readDocument (an attachment).
    expect(PROJECT_READ_DTS).not.toMatch(/readProjectFile\([^)]*\):\s*{[^}]*\btext\b/);
  });

  it('the automator instruct shows readProjectFile(...).content and warns off .text', () => {
    const instruct = readFileSync(
      resolve(
        dirname(fileURLToPath(import.meta.url)),
        '../../system-spaces/system-appbuilder/agents/automator/instruct.md',
      ),
      'utf8',
    );
    // It must give the model a correct example to copy: reading a project file's body via .content.
    expect(instruct).toMatch(/readProjectFile\([^)]*\)\.content/);
    // It must NOT model the wrong pattern in a real CODE example — i.e. `readProjectFile('<path>').text`
    // with a quoted path arg. (The prose warning uses the `readProjectFile(...)` placeholder, which is
    // deliberately excluded so the guidance can name the mistake without tripping this guard.)
    expect(instruct).not.toMatch(/readProjectFile\(\s*['"][^)]*\)\.text\b/);
    // And it must explicitly disambiguate the two readers' fields.
    expect(instruct).toMatch(/\.content\b.*NOT\s+\.text|NOT\s+\.text.*readDocument/is);
  });
});
