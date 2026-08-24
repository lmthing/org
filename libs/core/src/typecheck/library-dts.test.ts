import { describe, it, expect } from 'vitest';
import {
  COMMON_DTS,
  LIBRARY_DTS,
  LIBRARY_DTS_NO_ASK,
  EXEC_SHELL_DTS,
  REGISTER_SPACE_DTS,
  SCRATCH_DTS,
  composeDbDts,
  API_CALL_DTS,
  PROJECT_VIEW_DTS,
  PROJECT_API_DTS,
  PROJECT_AUTHORING_DTS,
  PROJECT_MANAGE_DTS,
  PROJECT_TABLE_DTS,
  STORE_READ_DTS,
  TEAM_READ_DTS,
  TEAM_POST_DTS,
  STORE_INSTALL_DTS,
  EVENTS_EMIT_DTS,
  KNOWLEDGE_WRITE_DTS,
  SELF_AUTHOR_DTS,
  CAPABILITY_DTS_FRAGMENTS,
  composeConnectionsDts,
  PROJECT_READ_DTS,
  PROCESS_EXIT_DTS,
  PROCESS_ENV_DTS,
} from './library-dts.js';
import { runTsc } from './tsc.js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

describe('library-dts write primitives are gated', () => {
  it('COMMON_DTS declares NONE of the generic fs primitives (execShell/writeFileRaw/readFileRaw)', () => {
    expect(COMMON_DTS).not.toContain('execShell');
    expect(COMMON_DTS).not.toContain('writeFileRaw');
    expect(COMMON_DTS).not.toContain('readFileRaw');
  });

  /**
   * The bundles used to re-append execShell/writeFileRaw/readFileRaw so `typecheckSource`
   * (host-tools.ts) saw the FULL global set when checking a standalone space-function
   * source. It never bought anything: `typecheckSource` DROPS "Cannot find name" (TS2304/
   * 2552) so a builder body naming an undeclared primitive was never reported either way.
   * What it did buy was three raw fs/shell primitives kept alive in a bundle exported from
   * the package index. `readFileRaw`/`writeFileRaw` now have no DTS fragment anywhere, and
   * `execShell` has exactly one declaration site: the engineer's `fs:scratch` sandbox.
   */
  it('no bundle declares the raw fs/shell primitives any more', () => {
    for (const bundle of [LIBRARY_DTS, LIBRARY_DTS_NO_ASK]) {
      expect(bundle).not.toContain('declare function execShell(');
      expect(bundle).not.toContain('declare function writeFileRaw(');
      expect(bundle).not.toContain('declare function readFileRaw(');
    }
  });

  it('LIBRARY_DTS_NO_ASK is LIBRARY_DTS without ask', () => {
    expect(LIBRARY_DTS).toContain('declare function ask');
    expect(LIBRARY_DTS_NO_ASK).not.toContain('declare function ask');
  });

  it('the split fragments carry the verbatim signatures', () => {
    expect(EXEC_SHELL_DTS).toContain('execShell(cmd: string');
    expect(REGISTER_SPACE_DTS).toContain('registerSpace(dir: string)');
    expect(SCRATCH_DTS).toContain('createScratch()');
  });

  /** `registerSpace` moved OUT of COMMON_DTS: its injection is gated on
   *  `caps.registerSpace`, so its declaration has to be gated the same way. */
  it('COMMON_DTS no longer declares registerSpace — it has its own gated fragment', () => {
    expect(COMMON_DTS).not.toContain('registerSpace');
    expect(REGISTER_SPACE_DTS).toContain('declare function registerSpace(');
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
    for (const m of ['query(', 'tables(', 'insert(', 'update(', 'createTable(', 'addColumn(']) {
      expect(dts).toContain(m);
    }
    // `remove` (hard delete) is a host-only primitive — NEVER on the model db surface.
    expect(dts).not.toContain('remove(');
  });

  it('db.* signatures are synchronous (no Promise)', () => {
    const dts = composeDbDts({ read: true, write: true, schema: true });
    expect(dts).not.toContain('Promise');
  });
});

// The per-run schema constrains db table/column names to compile-time literal unions, so a
// hallucinated table or a typo'd column FAILS typecheck (retryable) instead of throwing at
// runtime. The concrete evidence: 07-life-admin run15 ~step 13 — THING read `type` instead of
// the real `policy_type` column, got an empty result, and FABRICATED "no home insurance". A
// gated DTS turns that silent wrong answer into a typecheck error that names the real columns.
describe('composeDbDts schema gating (shape)', () => {
  const schema = [
    { name: 'policies', columns: ['id', 'policy_type', 'premium'] },
    { name: 'claims', columns: ['id', 'amount'] },
  ];

  it('falls back to the loose string-typed members when NO schema is supplied (backward compat)', () => {
    const dts = composeDbDts({ read: true, write: true });
    expect(dts).toContain('query(table: string');
    expect(dts).not.toContain('__DbCols');
  });

  it('an EMPTY schema array also stays loose', () => {
    const dts = composeDbDts({ read: true }, []);
    expect(dts).toContain('query(table: string');
    expect(dts).not.toContain('__DbCols');
  });

  it('gates read+write table/column names when a schema is supplied to a non-authoring agent', () => {
    const dts = composeDbDts({ read: true, write: true }, schema);
    expect(dts).toContain('type __DbCols = {');
    expect(dts).toContain('"policies": "id" | "policy_type" | "premium"');
    expect(dts).toContain('query<T extends keyof __DbCols>');
    expect(dts).toContain('insert<T extends keyof __DbCols>');
    expect(dts).toContain('tables(): (keyof __DbCols)[]');
  });

  it('stays LOOSE for a db:schema HOLDER even with a schema (authoring is open-table)', () => {
    const dts = composeDbDts({ read: true, write: true, schema: true }, schema);
    expect(dts).not.toContain('__DbCols');
    expect(dts).toContain('query(table: string');
    expect(dts).toContain('createTable(');
  });
});

// Load-bearing: run the emitted DTS through the real typechecker (runTsc) and prove a bad
// table AND a bad column are REJECTED while valid + every dynamic call pattern the shipped
// agents use still PASS. Reverting composeDbDts to the ungated members turns the four
// "fails typecheck" cases green, so this test is load-bearing on the gating.
describe('schema-gated db DTS is enforced by tsc', () => {
  const gatedDts = composeDbDts(
    { read: true, write: true },
    [
      { name: 'policies', columns: ['id', 'policy_type', 'premium'] },
      { name: 'claims', columns: ['id', 'amount'] },
    ],
  );
  const check = (statement: string, sessionContext = ''): ReturnType<typeof runTsc> =>
    runTsc({ ambientDts: gatedDts, sessionContext, statement });

  it('a valid table + valid columns PASS (query, orderBy, insert)', () => {
    expect(check(`const r = db.query('policies', { where: { policy_type: 'home' }, orderBy: 'premium' });`).ok).toBe(true);
    expect(check(`const n = db.insert('claims', { amount: 100 });`).ok).toBe(true);
  });

  it('a hallucinated TABLE fails typecheck', () => {
    const r = check(`const r = db.query('policyz', { where: { policy_type: 'home' } });`);
    expect(r.ok).toBe(false);
  });

  it('a typo COLUMN in a where clause fails typecheck AND names the real columns', () => {
    const r = check(`const r = db.query('policies', { where: { type: 'home' } });`);
    expect(r.ok).toBe(false);
    // The diagnostic surfaces the real column names so the model can self-correct.
    expect(r.diagnostics.some((d) => /policy_type/.test(d.message))).toBe(true);
  });

  it('a typo COLUMN in insert values and in update set fails typecheck', () => {
    expect(check(`const n = db.insert('policies', { policy_typ: 'home' });`).ok).toBe(false);
    expect(check(`const n = db.update('policies', { where: { id: '1' }, set: { premiun: 1 } });`).ok).toBe(false);
  });

  it('a dynamic table from a db.tables() loop still PASSES (enumerate-then-query)', () => {
    expect(check(`for (const t of db.tables()) { db.query(t, { limit: 1 }); }`).ok).toBe(true);
  });

  it('an any-typed dynamic table + computed column key still PASSES (write_fact/retract_fact)', () => {
    expect(check(`db.query(up.table, { where: { [up.col]: up.val } });`, `const up: any = {};`).ok).toBe(true);
  });

  it('the LOOSE fallback (no schema) accepts an arbitrary table + column (no gating)', () => {
    const loose = composeDbDts({ read: true, write: true });
    const r = runTsc({ ambientDts: loose, sessionContext: '', statement: `const r = db.query('anything', { where: { whatever: 1 } });` });
    expect(r.ok).toBe(true);
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

  it('the live-project write helpers (api:write): writeProjectApi + the declarative writeProjectQuery (W7)', () => {
    // The legacy pages:write TSX writers (writeProjectPage/writeProjectComponent) are gone
    // entirely — writeProjectApi is the surviving hand-written-handler shape in this family,
    // alongside the declarative writeProjectQuery (W7 §7) added beside it.
    expect(PROJECT_API_DTS.trim().length).toBeGreaterThan(0);
    expect(PROJECT_API_DTS).toContain('declare function writeProjectApi(route: string, src: string)');
    expect(PROJECT_API_DTS).toContain('declare function writeProjectQuery(');
  });
});

// process-exit-typecheck-regression: PROCESS_EXIT_DTS is the env-free fragment buildAmbientDts
// emits unconditionally (bootstrap.test.ts pins the per-context contract); this file just pins
// its own shape and its independence from PROCESS_ENV_DTS (never both land in the same bundle).
describe('PROCESS_EXIT_DTS — the env-free process fragment (model-surface process.exit)', () => {
  it('declares process.exit but no env member', () => {
    expect(PROCESS_EXIT_DTS).toContain('declare const process:');
    expect(PROCESS_EXIT_DTS).toContain('exit(code?: number): never');
    expect(PROCESS_EXIT_DTS).not.toContain('env');
  });

  it('is NOT part of LIBRARY_DTS/LIBRARY_DTS_NO_ASK — those keep the full PROCESS_ENV_DTS (env+exit) instead, so the two `declare const process` fragments never collide in the same bundle', () => {
    expect(LIBRARY_DTS).not.toContain(PROCESS_EXIT_DTS);
    expect(LIBRARY_DTS_NO_ASK).not.toContain(PROCESS_EXIT_DTS);
    // Both bundles still carry the full env+exit shape via PROCESS_ENV_DTS, unchanged.
    expect(LIBRARY_DTS).toContain(PROCESS_ENV_DTS);
    expect(LIBRARY_DTS_NO_ASK).toContain(PROCESS_ENV_DTS);
  });
});

describe('CAPABILITY_DTS_FRAGMENTS registry', () => {
  it('maps the standalone capability ids and omits the db trio', () => {
    expect(CAPABILITY_DTS_FRAGMENTS).toEqual({
      'api:call': API_CALL_DTS,
      'views:write': PROJECT_VIEW_DTS,
      'api:write': PROJECT_API_DTS,
      'hooks:write': PROJECT_AUTHORING_DTS,
      'project:manage': PROJECT_MANAGE_DTS,
      'store:read': STORE_READ_DTS,
      'store:install': STORE_INSTALL_DTS,
      'events:emit': EVENTS_EMIT_DTS,
      'knowledge:write': KNOWLEDGE_WRITE_DTS,
      // The per-project THING rewriting its own space (appendSelfInstruct / writeSelfKnowledge / readSelf).
      'self:author': SELF_AUTHOR_DTS,
      // The team workspace this pod belongs to. Two ids on purpose — reading the channels and
      // the roster is not the same grant as posting into them.
      'team:read': TEAM_READ_DTS,
      'team:post': TEAM_POST_DTS,
    });
    // db:schema is composed onto the `db` object, but ALSO earns the standalone
    // writeTableSchema authoring global (emitted directly in buildAppCapabilityDts),
    // so it is deliberately NOT a flat-map entry.
    expect(CAPABILITY_DTS_FRAGMENTS['db:read']).toBeUndefined();
    expect(CAPABILITY_DTS_FRAGMENTS['db:schema']).toBeUndefined();
    // The legacy pages:write capability is gone — not a key that maps to anything.
    expect(CAPABILITY_DTS_FRAGMENTS['pages:write']).toBeUndefined();
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

  it('PROJECT_TABLE_DTS declares the live-project table writer (db:schema twin) and the declarative writeProjectEntity (W7)', () => {
    expect(PROJECT_TABLE_DTS).toContain('writeProjectTable(');
    expect(PROJECT_TABLE_DTS).toContain('writeProjectEntity(');
  });

  it('views:write / api:write earn the live-project writers (the catalog writers are gone)', () => {
    // views:write → the four spec writers (live project)
    expect(CAPABILITY_DTS_FRAGMENTS['views:write']).toContain('writeProjectView(');
    expect(CAPABILITY_DTS_FRAGMENTS['views:write']).toContain('writeProjectViewComponent(');
    expect(CAPABILITY_DTS_FRAGMENTS['views:write']).toContain('writeProjectViewLayout(');
    expect(CAPABILITY_DTS_FRAGMENTS['views:write']).toContain('writeProjectViewShell(');
    // api:write → writeProjectApi (live project)
    expect(CAPABILITY_DTS_FRAGMENTS['api:write']).toContain('writeProjectApi(');
  });

  // `system-appbuilder`'s central guarantee — "100% spec, zero WebView by construction" — used to
  // be enforced by keeping `views:write` and the legacy `pages:write` (freehand-TSX) capability
  // disjoint. Now it is enforced more strongly: the legacy capability and its writers
  // (`writeProjectPage`/`writeProjectComponent`/`buildApp`) are DELETED from the codebase, so they
  // appear in NO capability's DTS fragment at all — there is no id left that could hand them out.
  it('views:write earns the spec writers; the deleted legacy TSX writers appear in no fragment', () => {
    const views = CAPABILITY_DTS_FRAGMENTS['views:write'];

    // views:write earns the four spec writers…
    expect(views).toContain('writeProjectView(');
    expect(views).toContain('writeProjectViewComponent(');
    expect(views).toContain('writeProjectViewLayout(');
    expect(views).toContain('writeProjectViewShell(');
    // …and NOT the deleted TSX writers. (`writeProjectViewComponent` contains the substring
    // `writeProjectView`, so the TSX names are matched with their own open-paren.)
    expect(views).not.toContain('writeProjectPage(');
    expect(views).not.toContain('writeProjectComponent(');

    // The deleted globals appear in NO fragment in the registry, granted or not.
    for (const frag of Object.values(CAPABILITY_DTS_FRAGMENTS)) {
      expect(frag).not.toContain('writeProjectPage(');
      expect(frag).not.toContain('buildApp(');
    }
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

  it('the automator instruct names each reader\'s field and warns that readProjectFile(...).text aborts the turn', () => {
    const instruct = readFileSync(
      resolve(
        dirname(fileURLToPath(import.meta.url)),
        '../../system-spaces/system-appbuilder/agents/automator/instruct.md',
      ),
      'utf8',
    );
    const flat = instruct.replace(/\s+/g, ' ');
    // The body must carry the disambiguation itself — this is a rule that has to hold on a turn
    // that loaded no knowledge aspect, because it fires the moment the agent inspects a project.
    expect(flat).toMatch(/Field names differ by reader/i);
    // Each reader paired with ITS field, so the model has a correct thing to copy rather than a
    // memory of "the body field".
    expect(flat).toMatch(/`readProjectFile\(path\)` → read the body from \*\*`\.content`\*\*/);
    expect(flat).toMatch(/`readDocument\(id\)`[^.]*→ read from \*\*`\.text`\*\*/);
    expect(flat).toMatch(/`listProjectDir\(dir\)`[^.]*\*\*`\.entries`\*\*/);
    // And the mistake itself named as what it costs: a typecheck error that ends the turn before
    // any write lands (the 09-home-renovation loop).
    expect(flat).toMatch(/`readProjectFile\(\.\.\.\)\.text` is a typecheck error/);
    // It must NOT model the wrong pattern in a real CODE example — i.e. `readProjectFile('<path>').text`
    // with a quoted path arg. (The prose warning uses the `readProjectFile(...)` placeholder, which is
    // deliberately excluded so the guidance can name the mistake without tripping this guard.)
    expect(instruct).not.toMatch(/readProjectFile\(\s*['"][^)]*\)\.text\b/);
  });
});
