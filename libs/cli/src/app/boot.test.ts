/**
 * {@link bootProjectApp} — the per-project app boot sequence (steps 1–3):
 * conditional DR restore, open, and additive-vs-non-additive schema reconcile.
 *
 * Task 2A's real `./store.js` (`node:sqlite`-backed) is not merged when this
 * suite is authored, so we `vi.mock('./store.js')` with a **minimal functional
 * shim also backed by `node:sqlite`**, exercising boot against a real SQLite
 * file through task 2A's documented API surface only (`openProjectDb`,
 * `restoreFromSql`, `schemaToCreateTableSql`, and `ProjectDb.{raw,listTables,
 * tableColumns,dumpToSql,close}`). The integrator should confirm the suite stays
 * green against 2A's real module — the production import is unchanged
 * (`./store.js`).
 */
import { describe, it, expect, afterAll, vi } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// ── Minimal `node:sqlite`-backed shim for task 2A's ./store.js ───────────────
// The factory is hoisted; it must be self-contained (dynamic imports only).
vi.mock('./store.js', async () => {
  const { DatabaseSync } = await import('node:sqlite');
  const { mkdirSync } = await import('node:fs');
  const { dirname } = await import('node:path');

  const q = (id: string) => `"${id.replace(/"/g, '""')}"`;
  const affinity = (t: string) => (t === 'number' ? 'REAL' : t === 'boolean' ? 'INTEGER' : 'TEXT');

  function schemaToCreateTableSql(name: string, schema: any): string {
    const cols = Object.entries(schema.columns).map(([cn, c]: [string, any]) => {
      let d = `${q(cn)} ${affinity(c.type)}`;
      if (c.primaryKey) d += ' PRIMARY KEY';
      return d;
    });
    return `CREATE TABLE IF NOT EXISTS ${q(name)} (${cols.join(', ')})`;
  }

  function wrap(raw: any) {
    return {
      db: {} as any,
      async: {} as any,
      raw,
      listTables: (): string[] =>
        raw
          .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'`)
          .all()
          .map((r: any) => r.name),
      tableColumns: (t: string): string[] =>
        (raw.prepare(`PRAGMA table_info(${q(t)})`).all() as any[]).map((r) => r.name),
      dumpToSql: (): string => {
        let out = '';
        const tbls = raw
          .prepare(`SELECT name, sql FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'`)
          .all();
        for (const { name, sql } of tbls as any[]) {
          out += `${sql};\n`;
          const rows = raw.prepare(`SELECT * FROM ${q(name)}`).all();
          for (const row of rows as any[]) {
            const keys = Object.keys(row);
            const vals = keys.map((k) => {
              const v = row[k];
              if (v == null) return 'NULL';
              if (typeof v === 'number') return String(v);
              return `'${String(v).replace(/'/g, "''")}'`;
            });
            out += `INSERT INTO ${q(name)} (${keys.map(q).join(',')}) VALUES (${vals.join(',')});\n`;
          }
        }
        return out;
      },
      close: () => raw.close(),
    };
  }

  return {
    openProjectDb(dbPath: string, _opts?: unknown) {
      mkdirSync(dirname(dbPath), { recursive: true });
      const raw = new DatabaseSync(dbPath);
      raw.exec('PRAGMA foreign_keys = ON');
      return wrap(raw);
    },
    restoreFromSql(dbPath: string, sql: string) {
      mkdirSync(dirname(dbPath), { recursive: true });
      const raw = new DatabaseSync(dbPath);
      raw.exec(sql);
      raw.close();
    },
    schemaToCreateTableSql,
  };
});

import { bootProjectApp } from './boot.js';

const tmpDirs: string[] = [];
async function scratch(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'lm-boot-'));
  tmpDirs.push(dir);
  return dir;
}
afterAll(async () => {
  await Promise.all(tmpDirs.map((d) => rm(d, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })));
});

function feedItems(columns: Record<string, unknown>): unknown {
  return { title: 'Feed items', description: 'items', columns };
}
const BASE_COLS = {
  id: { type: 'string', description: 'unique id', primaryKey: true },
  title: { type: 'string', description: 'headline' },
};

async function writeSchema(root: string, name: string, schema: unknown): Promise<void> {
  const dbDir = join(root, 'database');
  await mkdir(dbDir, { recursive: true });
  await writeFile(join(dbDir, `${name}.json`), JSON.stringify(schema, null, 2), 'utf8');
}

function rowCount(pdb: any, table: string): number {
  return (pdb.raw.prepare(`SELECT COUNT(*) AS n FROM "${table}"`).get() as { n: number }).n;
}
function exists(p: string): Promise<boolean> {
  return stat(p).then(() => true, () => false);
}

describe('bootProjectApp — skip conditions', () => {
  it('returns null for a spaces-only project (no database/)', async () => {
    const root = await scratch();
    await mkdir(join(root, 'spaces'), { recursive: true });
    expect(await bootProjectApp(root)).toBeNull();
  });

  it('returns null for a project with an app dir but no tables', async () => {
    const root = await scratch();
    await mkdir(join(root, 'pages'), { recursive: true });
    expect(await bootProjectApp(root)).toBeNull();
  });
});

describe('bootProjectApp — fresh create + additive evolution', () => {
  it('creates declared tables on a fresh project', async () => {
    const root = await scratch();
    await writeSchema(root, 'feed_items', feedItems(BASE_COLS));

    const pdb = await bootProjectApp(root);
    expect(pdb).not.toBeNull();
    expect(pdb!.listTables()).toContain('feed_items');
    expect(pdb!.tableColumns('feed_items').sort()).toEqual(['id', 'title']);
    expect(await exists(join(root, '.data', 'app.db'))).toBe(true);
    pdb!.close();
  });

  it('applies an additive ALTER ADD COLUMN when a new column is declared', async () => {
    const root = await scratch();
    await writeSchema(root, 'feed_items', feedItems(BASE_COLS));
    (await bootProjectApp(root))!.close();

    // Add a new column to the JSON and re-boot (app.db already exists → no restore).
    await writeSchema(
      root,
      'feed_items',
      feedItems({ ...BASE_COLS, score: { type: 'number', description: 'rank', default: 0 } }),
    );
    const pdb = await bootProjectApp(root);
    expect(pdb!.tableColumns('feed_items').sort()).toEqual(['id', 'score', 'title']);
    pdb!.close();
  });
});

describe('bootProjectApp — a schema divergence never bricks the project', () => {
  // A live scenario (09-home-renovation): the automator dropped the `label` column from
  // budget_lines.json while the live sqlite kept it. reconcileTable threw, and because
  // getProjectAppGlobals runs bootProjectApp at SESSION INIT, the whole project was bricked — every
  // session errored with a fully-swallowed error and a non-technical user could not even open the app
  // to ask THING to fix it. Dropping a column is harmless (SQLite keeps the orphan, the app reads only
  // declared columns, no data is lost), so boot must tolerate it, not fail loud.
  it('tolerates a dropped/orphaned live column and still boots (keeps the column, no data loss)', async () => {
    const root = await scratch();
    await writeSchema(
      root,
      'feed_items',
      feedItems({ ...BASE_COLS, extra: { type: 'string', description: 'to be dropped' } }),
    );
    let pdb = await bootProjectApp(root);
    pdb!.raw.prepare('INSERT INTO feed_items (id, title, extra) VALUES (?, ?, ?)').run('a', 'hi', 'keepme');
    pdb!.close();

    // Drop `extra` from the declared schema → the live column is now orphaned.
    await writeSchema(root, 'feed_items', feedItems(BASE_COLS));
    pdb = await bootProjectApp(root); // must NOT throw
    expect(pdb).not.toBeNull();
    // The orphaned column is kept (no destructive migration) and the pre-existing row survives.
    expect(pdb!.tableColumns('feed_items')).toContain('extra');
    expect(rowCount(pdb!, 'feed_items')).toBe(1);
    pdb!.close();
  });

  it('isolates a genuinely dangerous divergence (type conflict) to that table — the app still boots', async () => {
    const root = await scratch();
    // Seed two tables; `feed_items.title` is text.
    await writeSchema(root, 'feed_items', feedItems(BASE_COLS));
    await writeSchema(root, 'other', feedItems(BASE_COLS));
    (await bootProjectApp(root))!.close();

    // Re-declare feed_items.title as a NUMBER (text↔numeric conflict → reconcileTable throws for it).
    await writeSchema(
      root,
      'feed_items',
      feedItems({ ...BASE_COLS, title: { type: 'number', description: 'now numeric' } }),
    );
    const pdb = await bootProjectApp(root); // the bad table is skipped, boot still succeeds
    expect(pdb).not.toBeNull();
    // The healthy table is fully usable — the one divergent table did not brick the project.
    expect(pdb!.listTables()).toEqual(expect.arrayContaining(['feed_items', 'other']));
    pdb!.raw.prepare('INSERT INTO other (id, title) VALUES (?, ?)').run('x', 'still works');
    expect(rowCount(pdb!, 'other')).toBe(1);
    pdb!.close();
  });
});

describe('bootProjectApp — conditional DR restore', () => {
  it('rebuilds app.db from app.sql when the db file is absent', async () => {
    const root = await scratch();
    await writeSchema(root, 'feed_items', feedItems(BASE_COLS));

    // Boot, insert a row, dump to app.sql, then remove app.db.
    let pdb = await bootProjectApp(root);
    (pdb as any).raw.prepare(`INSERT INTO "feed_items" (id, title) VALUES ('c1', 'kept')`).run();
    const dump = (pdb as any).dumpToSql();
    pdb!.close();
    await writeFile(join(root, '.data', 'app.sql'), dump, 'utf8');
    await rm(join(root, '.data', 'app.db'), { force: true });

    // Re-boot with app.db absent + app.sql present → restored.
    pdb = await bootProjectApp(root);
    expect(rowCount(pdb, 'feed_items')).toBe(1);
    pdb!.close();
  });

  it('never clobbers a live app.db even when app.sql exists', async () => {
    const root = await scratch();
    await writeSchema(root, 'feed_items', feedItems(BASE_COLS));

    // Live db holds row A.
    let pdb = await bootProjectApp(root);
    (pdb as any).raw.prepare(`INSERT INTO "feed_items" (id, title) VALUES ('a', 'live')`).run();
    pdb!.close();

    // A stale app.sql that would insert a DIFFERENT row B — must NOT be applied.
    await writeFile(
      join(root, '.data', 'app.sql'),
      `INSERT INTO "feed_items" (id, title) VALUES ('b', 'stale');\n`,
      'utf8',
    );

    pdb = await bootProjectApp(root);
    expect(rowCount(pdb, 'feed_items')).toBe(1); // only row A survived
    const ids = (pdb as any).raw.prepare(`SELECT id FROM "feed_items"`).all().map((r: any) => r.id);
    expect(ids).toEqual(['a']);
    pdb!.close();

    // Sanity: readFile still shows the stale sql untouched on disk.
    expect(await readFile(join(root, '.data', 'app.sql'), 'utf8')).toContain('stale');
  });
});
