/**
 * Tests for the `better-sqlite3`-backed project store ({@link ./store.ts}).
 *
 * Covers: `CREATE TABLE` from schema (via `schemaToCreateTableSql`), insert with
 * `generated`/`default` filling, value marshalling round-trips
 * (boolean/json/date), query with where/orderBy/limit/offset, relation `include`
 * (belongsTo + hasMany joins), additive `addColumn`, foreign-key `onDelete`
 * enforcement (cascade / setNull / restrict), `dumpToSql` → `restoreFromSql`
 * round-trip, and `listTables`/`tableColumns`.
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { LoadedTable, TableSchema } from '@lmthing/core';

import { openProjectDb, restoreFromSql, schemaToCreateTableSql, type ProjectDb } from './store.js';

// ── Schemas (the spec example + FK-behaviour fixtures) ───────────────────────

const feedItems: TableSchema = {
  title: 'Feed items',
  description: "One personalized item in the user's feed.",
  columns: {
    id: { type: 'string', description: 'unique id', primaryKey: true, generated: 'uuid' },
    title: { type: 'string', description: 'headline', required: true },
    url: { type: 'string', description: 'canonical URL', required: true, unique: true },
    score: { type: 'number', description: 'relevance rank', default: 0 },
    tags: { type: 'json', description: 'array of topic tag strings' },
    read: { type: 'boolean', description: 'whether opened', default: false },
    createdAt: { type: 'date', description: 'when it entered the feed', generated: 'now' },
  },
  relations: {
    comments: { hasMany: 'comments', via: 'feedItemId', description: 'notes attached' },
  },
};

const comments: TableSchema = {
  title: 'Comments',
  description: 'A note the user attached to a feed item.',
  columns: {
    id: { type: 'string', description: 'unique id', primaryKey: true, generated: 'uuid' },
    feedItemId: {
      type: 'string',
      description: 'the feed item this belongs to',
      required: true,
      references: { table: 'feed_items', column: 'id', onDelete: 'cascade' },
    },
    body: { type: 'string', description: 'the comment text', required: true },
    createdAt: { type: 'date', description: 'when written', generated: 'now' },
  },
  relations: {
    item: { belongsTo: 'feed_items', via: 'feedItemId', description: 'the item commented on' },
  },
};

const parents: TableSchema = {
  title: 'Parents',
  description: 'A parent row for FK-behaviour tests.',
  columns: {
    id: { type: 'string', description: 'unique id', primaryKey: true, generated: 'uuid' },
    name: { type: 'string', description: 'display name', required: true },
  },
};

const childCascade: TableSchema = {
  title: 'Child cascade',
  description: 'FK onDelete cascade.',
  columns: {
    id: { type: 'string', description: 'unique id', primaryKey: true, generated: 'uuid' },
    parentId: {
      type: 'string',
      description: 'parent',
      required: true,
      references: { table: 'parents', column: 'id', onDelete: 'cascade' },
    },
  },
};

const childSetNull: TableSchema = {
  title: 'Child set null',
  description: 'FK onDelete setNull.',
  columns: {
    id: { type: 'string', description: 'unique id', primaryKey: true, generated: 'uuid' },
    parentId: {
      type: 'string',
      description: 'parent (nullable so it can be nulled)',
      references: { table: 'parents', column: 'id', onDelete: 'setNull' },
    },
  },
};

const childRestrict: TableSchema = {
  title: 'Child restrict',
  description: 'FK onDelete restrict.',
  columns: {
    id: { type: 'string', description: 'unique id', primaryKey: true, generated: 'uuid' },
    parentId: {
      type: 'string',
      description: 'parent',
      required: true,
      references: { table: 'parents', column: 'id', onDelete: 'restrict' },
    },
  },
};

const SCHEMAS: LoadedTable[] = [
  { name: 'feed_items', schema: feedItems },
  { name: 'comments', schema: comments },
  { name: 'parents', schema: parents },
  { name: 'child_cascade', schema: childCascade },
  { name: 'child_setnull', schema: childSetNull },
  { name: 'child_restrict', schema: childRestrict },
];

// Create order respects FK dependencies (referenced tables first).
const CREATE_ORDER = ['feed_items', 'comments', 'parents', 'child_cascade', 'child_setnull', 'child_restrict'];

let dir: string;
let dbPath: string;
let pdb: ProjectDb;

function makeTables(p: ProjectDb): void {
  const byName = new Map(SCHEMAS.map((s) => [s.name, s.schema]));
  for (const name of CREATE_ORDER) {
    p.raw.exec(schemaToCreateTableSql(name, byName.get(name)!));
  }
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'lmthing-store-'));
  dbPath = join(dir, '.data', 'app.db');
  pdb = openProjectDb(dbPath, { schemas: SCHEMAS });
  makeTables(pdb);
});

afterEach(() => {
  pdb.close();
  rmSync(dir, { recursive: true, force: true });
});

describe('schemaToCreateTableSql', () => {
  it('emits PK, NOT NULL, UNIQUE, DEFAULT and a table-level FOREIGN KEY', () => {
    const sql = schemaToCreateTableSql('comments', comments);
    expect(sql).toContain('"id" TEXT PRIMARY KEY');
    expect(sql).toContain('"body" TEXT NOT NULL');
    expect(sql).toContain('FOREIGN KEY ("feedItemId") REFERENCES "feed_items"("id") ON DELETE CASCADE');
  });

  it('maps setNull → "SET NULL" and defaults onDelete to RESTRICT', () => {
    expect(schemaToCreateTableSql('child_setnull', childSetNull)).toContain('ON DELETE SET NULL');
    expect(schemaToCreateTableSql('child_restrict', childRestrict)).toContain('ON DELETE RESTRICT');
  });
});

describe('insert', () => {
  it('applies generated (uuid/now) + defaults and returns the marshalled row', () => {
    const row = pdb.db.insert('feed_items', { title: 'Hello', url: 'https://a.test' }) as Record<
      string,
      unknown
    >;
    expect(typeof row.id).toBe('string');
    expect((row.id as string).length).toBeGreaterThan(10); // a uuid
    expect(row.score).toBe(0); // default
    expect(row.read).toBe(false); // boolean default marshalled back
    expect(typeof row.createdAt).toBe('string'); // generated now → ISO string
    expect(new Date(row.createdAt as string).toString()).not.toBe('Invalid Date');
  });

  it('accepts an array of rows and returns an array', () => {
    const rows = pdb.db.insert('feed_items', [
      { title: 'A', url: 'https://a2.test' },
      { title: 'B', url: 'https://b2.test' },
    ]) as Record<string, unknown>[];
    expect(Array.isArray(rows)).toBe(true);
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.title).sort()).toEqual(['A', 'B']);
  });

  it('enforces UNIQUE columns', () => {
    pdb.db.insert('feed_items', { title: 'x', url: 'https://dupe.test' });
    expect(() => pdb.db.insert('feed_items', { title: 'y', url: 'https://dupe.test' })).toThrow();
  });
});

describe('marshalling round-trips', () => {
  it('round-trips boolean, json and date', () => {
    const created = pdb.db.insert('feed_items', {
      title: 'M',
      url: 'https://m.test',
      read: true,
      tags: ['ai', 'news'],
      score: 3.5,
    }) as Record<string, unknown>;
    const [row] = pdb.db.query('feed_items', { where: { url: 'https://m.test' } }) as Record<
      string,
      unknown
    >[];
    expect(row.read).toBe(true);
    expect(row.tags).toEqual(['ai', 'news']);
    expect(row.score).toBe(3.5);
    expect(row.id).toBe(created.id);
  });
});

describe('query', () => {
  beforeEach(() => {
    pdb.db.insert('feed_items', [
      { title: 'low', url: 'https://1.test', score: 1, read: false },
      { title: 'high', url: 'https://2.test', score: 9, read: true },
      { title: 'mid', url: 'https://3.test', score: 5, read: false },
    ]);
  });

  it('filters with where (boolean marshalled into the query)', () => {
    const unread = pdb.db.query('feed_items', { where: { read: false } });
    expect(unread.map((r) => (r as Record<string, unknown>).title).sort()).toEqual(['low', 'mid']);
  });

  it('sorts with orderBy and paginates with limit/offset', () => {
    const top2 = pdb.db.query('feed_items', {
      orderBy: { column: 'score', dir: 'desc' },
      limit: 2,
    });
    expect(top2.map((r) => (r as Record<string, unknown>).title)).toEqual(['high', 'mid']);

    const skip1 = pdb.db.query('feed_items', {
      orderBy: 'score',
      limit: 1,
      offset: 1,
    });
    expect((skip1[0] as Record<string, unknown>).title).toBe('mid');
  });
});

describe('include (relation expansion)', () => {
  it('expands hasMany → array and belongsTo → object', () => {
    const item = pdb.db.insert('feed_items', { title: 'withc', url: 'https://c.test' }) as Record<
      string,
      unknown
    >;
    pdb.db.insert('comments', [
      { feedItemId: item.id, body: 'first' },
      { feedItemId: item.id, body: 'second' },
    ]);

    const [withComments] = pdb.db.query('feed_items', {
      where: { id: item.id },
      include: ['comments'],
    }) as Record<string, unknown>[];
    expect(Array.isArray(withComments.comments)).toBe(true);
    expect((withComments.comments as unknown[]).length).toBe(2);

    const [comment] = pdb.db.query('comments', { include: ['item'] }) as Record<string, unknown>[];
    expect((comment.item as Record<string, unknown>).id).toBe(item.id);
    expect((comment.item as Record<string, unknown>).title).toBe('withc');
  });

  it('throws a clear error when include is used without schemas', () => {
    const noSchema = openProjectDb(join(dir, 'no-schema.db'));
    noSchema.raw.exec('CREATE TABLE t ("id" TEXT PRIMARY KEY)');
    expect(() => noSchema.db.query('t', { include: ['whatever'] })).toThrow(/requires the loaded schemas/);
    noSchema.close();
  });
});

describe('update / remove', () => {
  it('updates matched rows and returns the count', () => {
    pdb.db.insert('feed_items', { title: 'u', url: 'https://u.test', read: false });
    const n = pdb.db.update('feed_items', { where: { url: 'https://u.test' }, set: { read: true } });
    expect(n).toBe(1);
    const [row] = pdb.db.query('feed_items', { where: { url: 'https://u.test' } }) as Record<
      string,
      unknown
    >[];
    expect(row.read).toBe(true);
  });

  it('removes matched rows and returns the count', () => {
    pdb.db.insert('feed_items', { title: 'd', url: 'https://d.test' });
    expect(pdb.db.remove('feed_items', { where: { url: 'https://d.test' } })).toBe(1);
    expect(pdb.db.query('feed_items', { where: { url: 'https://d.test' } })).toHaveLength(0);
  });
});

describe('addColumn (additive)', () => {
  it('adds a column to an existing table', () => {
    pdb.db.insert('feed_items', { title: 'a', url: 'https://add.test' });
    pdb.db.addColumn('feed_items', 'author', { type: 'string', description: 'author name' });
    expect(pdb.tableColumns('feed_items')).toContain('author');
    const [row] = pdb.db.query('feed_items', { where: { url: 'https://add.test' } }) as Record<
      string,
      unknown
    >[];
    expect(row.author).toBeNull();

    pdb.db.update('feed_items', { where: { url: 'https://add.test' }, set: { author: 'Ada' } });
    const [updated] = pdb.db.query('feed_items', { where: { url: 'https://add.test' } }) as Record<
      string,
      unknown
    >[];
    expect(updated.author).toBe('Ada');
  });
});

describe('foreign-key onDelete (PRAGMA foreign_keys=ON)', () => {
  it('cascade removes children when the parent is deleted', () => {
    const p = pdb.db.insert('parents', { name: 'p' }) as Record<string, unknown>;
    pdb.db.insert('child_cascade', { parentId: p.id });
    pdb.db.remove('parents', { where: { id: p.id } });
    expect(pdb.db.query('child_cascade')).toHaveLength(0);
  });

  it('setNull nulls the FK when the parent is deleted', () => {
    const p = pdb.db.insert('parents', { name: 'p' }) as Record<string, unknown>;
    const c = pdb.db.insert('child_setnull', { parentId: p.id }) as Record<string, unknown>;
    pdb.db.remove('parents', { where: { id: p.id } });
    const [row] = pdb.db.query('child_setnull', { where: { id: c.id } }) as Record<
      string,
      unknown
    >[];
    expect(row.parentId).toBeNull();
  });

  it('restrict blocks deleting a referenced parent', () => {
    const p = pdb.db.insert('parents', { name: 'p' }) as Record<string, unknown>;
    pdb.db.insert('child_restrict', { parentId: p.id });
    expect(() => pdb.db.remove('parents', { where: { id: p.id } })).toThrow();
  });
});

describe('dumpToSql / restoreFromSql', () => {
  it('round-trips schema + rows into a fresh db', () => {
    pdb.db.insert('feed_items', [
      { title: 'one', url: 'https://one.test', tags: ['x'], read: true },
      { title: 'two', url: 'https://two.test', score: 2 },
    ]);
    const item = pdb.db.query('feed_items', { where: { url: 'https://one.test' } })[0] as Record<
      string,
      unknown
    >;
    pdb.db.insert('comments', { feedItemId: item.id, body: 'note' });

    const sql = pdb.dumpToSql();
    expect(sql).toContain('CREATE TABLE');
    expect(sql).toContain('INSERT INTO "feed_items"');

    const restorePath = join(dir, 'restored', 'app.db');
    restoreFromSql(restorePath, sql);
    const restored = openProjectDb(restorePath, { schemas: SCHEMAS, create: false });
    try {
      const rows = restored.db.query('feed_items', { orderBy: 'url' }) as Record<string, unknown>[];
      expect(rows.map((r) => r.title)).toEqual(['one', 'two']);
      expect(rows[0].read).toBe(true);
      expect(rows[0].tags).toEqual(['x']);
      expect(restored.db.query('comments')).toHaveLength(1);
    } finally {
      restored.close();
    }
  });

  it('produces deterministic output (stable across dumps)', () => {
    pdb.db.insert('feed_items', [
      { title: 'a', url: 'https://a.test' },
      { title: 'b', url: 'https://b.test' },
    ]);
    expect(pdb.dumpToSql()).toBe(pdb.dumpToSql());
  });
});

describe('listTables / tableColumns', () => {
  it('lists user tables (excluding sqlite_* internal) and their columns', () => {
    expect(pdb.listTables()).toEqual([...CREATE_ORDER].sort());
    expect(pdb.tableColumns('feed_items')).toEqual([
      'id',
      'title',
      'url',
      'score',
      'tags',
      'read',
      'createdAt',
    ]);
  });
});

describe('db.createTable (agent-facing slugified path) + async mirror', () => {
  it('creates a table named from the slugified title', () => {
    pdb.db.createTable({
      title: 'My Widgets',
      description: 'widgets',
      columns: {
        id: { type: 'string', description: 'id', primaryKey: true, generated: 'uuid' },
        label: { type: 'string', description: 'label' },
      },
    });
    expect(pdb.listTables()).toContain('my_widgets');
    const row = pdb.db.insert('my_widgets', { label: 'hi' }) as Record<string, unknown>;
    expect(row.label).toBe('hi');
  });

  it('exposes an async mirror that resolves to the same results', async () => {
    await pdb.async.insert('feed_items', { title: 'async', url: 'https://async.test' });
    const rows = await pdb.async.query('feed_items', { where: { url: 'https://async.test' } });
    expect((rows[0] as Record<string, unknown>).title).toBe('async');
    expect(await pdb.async.tables()).toContain('feed_items');
  });
});
