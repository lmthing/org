import { describe, expect, it, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync, readFileSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  allocatePort,
  nextRunId,
  snapshotProject,
  snapshotDir,
  seedRun,
  latestSessionId,
  serverUp,
  startRun,
  stopRun,
  mutateTableSchema,
  teamEnv,
} from './local.mjs';

const tmps = [];
const mkTmp = () => {
  const d = mkdtempSync(join(tmpdir(), 'lmscn-'));
  tmps.push(d);
  return d;
};
afterEach(() => {
  for (const d of tmps.splice(0)) rmSync(d, { recursive: true, force: true });
});

// Build a fake run whose data dir holds a `.lmthing` with one project (+ .data + a session) and a
// `system` tree that must NOT be snapshotted (it re-materializes on boot via --adopt-system-spaces).
function fakeRun(scenarioDir, runId, projectId = 'proj') {
  const dataDir = join(scenarioDir, 'runs', String(runId), 'data');
  const lm = join(dataDir, '.lmthing');
  mkdirSync(join(lm, projectId, 'database'), { recursive: true });
  writeFileSync(join(lm, projectId, 'database', 'items.json'), '{"columns":[]}');
  mkdirSync(join(lm, projectId, '.data'), { recursive: true });
  writeFileSync(join(lm, projectId, '.data', 'app.db'), 'SQLITE');
  mkdirSync(join(lm, projectId, 'sessions', 'sess-1'), { recursive: true });
  writeFileSync(join(lm, projectId, 'sessions', 'sess-1', 'snapshot.json'), '{}');
  writeFileSync(join(lm, 'sessions-ledger.jsonl'), '{}\n');
  mkdirSync(join(lm, 'system', 'spaces', 'user-thing'), { recursive: true });
  writeFileSync(join(lm, 'system', 'spaces', 'user-thing', 'instruct.md'), 'SYSTEM');
  mkdirSync(join(dataDir, 'store-apps'), { recursive: true });
  writeFileSync(join(dataDir, 'store-apps', 'catalog.json'), '[]');
  return { scenarioDir, runId, projectId, dataDir };
}

describe('allocatePort', () => {
  it('returns a distinct, usable TCP port each call', async () => {
    const a = await allocatePort();
    const b = await allocatePort();
    expect(a).toBeGreaterThan(0);
    expect(b).toBeGreaterThan(0);
    expect(a).not.toBe(b);
  });
});

describe('nextRunId', () => {
  it('is 1 for an empty scenario dir and max+1 otherwise', () => {
    const sc = mkTmp();
    expect(nextRunId(sc)).toBe(1);
    mkdirSync(join(sc, 'runs', '1'), { recursive: true });
    mkdirSync(join(sc, 'runs', '4'), { recursive: true });
    mkdirSync(join(sc, 'runs', 'latest'), { recursive: true }); // non-numeric ignored
    expect(nextRunId(sc)).toBe(5);
  });
});

describe('snapshotProject + seedRun', () => {
  it('snapshots the project (incl .data + sessions) and app catalog, EXCLUDING system', () => {
    const sc = mkTmp();
    const run = fakeRun(sc, 1);
    const snap = snapshotProject(run, 2);

    expect(snap).toBe(snapshotDir(sc, 1, 2));
    expect(existsSync(join(snap, '.lmthing', 'proj', 'database', 'items.json'))).toBe(true);
    expect(existsSync(join(snap, '.lmthing', 'proj', '.data', 'app.db'))).toBe(true);
    expect(existsSync(join(snap, '.lmthing', 'proj', 'sessions', 'sess-1', 'snapshot.json'))).toBe(true);
    expect(existsSync(join(snap, '.lmthing', 'sessions-ledger.jsonl'))).toBe(true);
    expect(existsSync(join(snap, 'store-apps', 'catalog.json'))).toBe(true);
    // system is re-adopted on boot — it must never be captured.
    expect(existsSync(join(snap, '.lmthing', 'system'))).toBe(false);
  });

  it('seeds a fresh data dir from a snapshot (round-trip)', () => {
    const sc = mkTmp();
    const snap = snapshotProject(fakeRun(sc, 1), 1);

    const dest = { dataDir: join(sc, 'runs', '2', 'data') };
    seedRun(dest, snap);
    expect(readFileSync(join(dest.dataDir, '.lmthing', 'proj', '.data', 'app.db'), 'utf8')).toBe('SQLITE');
    expect(existsSync(join(dest.dataDir, '.lmthing', 'proj', 'sessions', 'sess-1'))).toBe(true);
    expect(existsSync(join(dest.dataDir, 'store-apps', 'catalog.json'))).toBe(true);
    expect(existsSync(join(dest.dataDir, '.lmthing', 'system'))).toBe(false);
  });

  it('seeds from a BARE seed (repro fixture: the dir IS the .lmthing payload, no wrapper)', () => {
    const sc = mkTmp();
    // A committed repro seed is stored de-wrapped (no `.lmthing/` dir) so it escapes the gitignore:
    // the seed dir's contents ARE the payload.
    const bare = join(sc, 'seed');
    mkdirSync(join(bare, 'tanzania-trip', 'database'), { recursive: true });
    writeFileSync(join(bare, 'tanzania-trip', 'database', 'flags.json'), '{}');
    mkdirSync(join(bare, 'tanzania-trip', '.data'), { recursive: true });
    writeFileSync(join(bare, 'tanzania-trip', '.data', 'app.db'), 'SQLITE');

    const dest = { dataDir: join(sc, 'runs', '9', 'data') };
    seedRun(dest, bare);
    // wrapped back into `.lmthing/` at the destination
    expect(readFileSync(join(dest.dataDir, '.lmthing', 'tanzania-trip', '.data', 'app.db'), 'utf8')).toBe('SQLITE');
    expect(existsSync(join(dest.dataDir, '.lmthing', 'tanzania-trip', 'database', 'flags.json'))).toBe(true);
  });
});

describe('latestSessionId', () => {
  it('returns the newest session dir, or null when there are none', () => {
    const sc = mkTmp();
    const run = fakeRun(sc, 1);
    expect(latestSessionId(run, 'proj')).toBe('sess-1');
    // A second, newer session wins (mtimes set explicitly so the test doesn't race sub-ms creation).
    const sessions = join(run.dataDir, '.lmthing', 'proj', 'sessions');
    const dir = join(sessions, 'sess-2');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'snapshot.json'), '{}');
    utimesSync(join(sessions, 'sess-1'), new Date(1_000_000), new Date(1_000_000));
    utimesSync(dir, new Date(2_000_000), new Date(2_000_000));
    expect(latestSessionId(run, 'proj')).toBe('sess-2');
    expect(latestSessionId(run, 'no-such-project')).toBeNull();
  });
});

describe('mutateTableSchema', () => {
  function fakeSchemaRun(sc) {
    const run = fakeRun(sc, 1, 'proj');
    const schemaPath = join(run.dataDir, '.lmthing', 'proj', 'database', 'expenses.json');
    writeFileSync(
      schemaPath,
      JSON.stringify({
        title: 'Expenses',
        columns: {
          id: { type: 'string', primaryKey: true, generated: 'uuid' },
          total: { type: 'number' },
          note: { type: 'string' },
        },
      }),
    );
    return { run, schemaPath };
  }

  it('retypes an existing column non-additively, leaving other columns untouched', () => {
    const sc = mkTmp();
    const { run, schemaPath } = fakeSchemaRun(sc);
    const result = mutateTableSchema(run, 'proj', 'expenses', { column: 'total', type: 'string' });
    expect(result).toEqual({ table: 'expenses', path: schemaPath, change: { column: 'total', type: 'string' } });
    const schema = JSON.parse(readFileSync(schemaPath, 'utf8'));
    expect(schema.columns.total.type).toBe('string');
    expect(schema.columns.note.type).toBe('string'); // untouched
    expect(schema.columns.id.primaryKey).toBe(true); // untouched
  });

  it('moves the primary key to a different existing column', () => {
    const sc = mkTmp();
    const { run, schemaPath } = fakeSchemaRun(sc);
    mutateTableSchema(run, 'proj', 'expenses', { movePrimaryKeyTo: 'note' });
    const schema = JSON.parse(readFileSync(schemaPath, 'utf8'));
    expect(schema.columns.note.primaryKey).toBe(true);
    expect(schema.columns.id.primaryKey).toBeUndefined();
  });

  it('throws when the named column does not exist (never silently no-ops)', () => {
    const sc = mkTmp();
    const { run } = fakeSchemaRun(sc);
    expect(() => mutateTableSchema(run, 'proj', 'expenses', { column: 'nope', type: 'string' })).toThrow(/no column "nope"/);
    expect(() => mutateTableSchema(run, 'proj', 'expenses', { movePrimaryKeyTo: 'nope' })).toThrow(/no column "nope"/);
  });

  it('throws on a malformed change descriptor', () => {
    const sc = mkTmp();
    const { run } = fakeSchemaRun(sc);
    expect(() => mutateTableSchema(run, 'proj', 'expenses', {})).toThrow(/change must be/);
  });
});

describe('teamEnv', () => {
  it('contributes NOTHING for a personal run — the existing scenarios must not see this option', () => {
    expect(teamEnv({})).toEqual({});
    expect(teamEnv({ teamMode: false, teamId: 'ignored' })).toEqual({});
    expect(teamEnv(undefined)).toEqual({});
  });

  it('turns on team mode (which is what registers /api/team/*) and names the team', () => {
    expect(teamEnv({ teamMode: true, teamId: 'acme' })).toEqual({
      LMTHING_TEAM_MODE: '1',
      LMTHING_TEAM_ID: 'acme',
    });
    // A team run with no id still gets one: `LMTHING_TEAM_ID` only labels notifications, but an
    // undefined env value would be dropped by spawn() and read back as ''.
    expect(teamEnv({ teamMode: true })).toEqual({ LMTHING_TEAM_MODE: '1', LMTHING_TEAM_ID: 'team' });
  });
});

// Booting a real `pnpm lmthing serve` (tsx) is slow, so gate it behind LM_LIVE=1. It proves the
// per-run spawn (`--cwd <data>`) lands its `.lmthing` under the run dir AND that stopRun frees the
// port — the two things unit tests over fake dirs can't.
describe.skipIf(!process.env.LM_LIVE)('startRun / stopRun (live)', () => {
  it('boots a server whose .lmthing is the run data dir, then stopRun frees the port', async () => {
    const sc = mkTmp();
    const run = await startRun({ scenarioDir: sc, runId: 1, projectId: 'user', scenarioId: 'probe' });
    try {
      expect(await serverUp(run.base)).toBe(true);
      expect(existsSync(join(run.dataDir, '.lmthing'))).toBe(true);
    } finally {
      stopRun(run);
    }
    for (let i = 0; i < 20 && (await serverUp(run.base)); i++) await new Promise((r) => setTimeout(r, 500));
    expect(await serverUp(run.base)).toBe(false);
  }, 180000);
});
