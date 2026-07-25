/**
 * {@link loadProjectApp} — reads `database/*.json` (fail-loud validation),
 * reports app-dir presence flags, and tolerates a spaces-only project (the
 * synthetic `system` project has no app layer).
 *
 * Filesystem only — no db engine, no model turn loop.
 */
import { describe, it, expect, afterAll } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { loadProjectApp } from './loader.js';

const tmpDirs: string[] = [];
async function scratch(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'lm-loader-'));
  tmpDirs.push(dir);
  return dir;
}
afterAll(async () => {
  await Promise.all(tmpDirs.map((d) => rm(d, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })));
});

const FEED_ITEMS = {
  title: 'Feed items',
  description: 'One personalized item in the user\'s feed.',
  columns: {
    id: { type: 'string', description: 'unique id', primaryKey: true, generated: 'uuid' },
    title: { type: 'string', description: 'headline shown in the feed', required: true },
    url: { type: 'string', description: 'canonical source URL', required: true, unique: true },
    score: { type: 'number', description: 'relevance rank', default: 0 },
    read: { type: 'boolean', description: 'whether the user opened it', default: false },
  },
  relations: {
    comments: { hasMany: 'comments', via: 'feedItemId', description: 'notes the user attached' },
  },
};

const COMMENTS = {
  title: 'Comments',
  description: 'A note the user attached to a feed item.',
  columns: {
    id: { type: 'string', description: 'unique id', primaryKey: true, generated: 'uuid' },
    feedItemId: {
      type: 'string',
      description: 'the feed item this comment belongs to',
      required: true,
      references: { table: 'feed_items', column: 'id', onDelete: 'cascade' },
    },
    body: { type: 'string', description: 'the comment text', required: true },
  },
  relations: {
    item: { belongsTo: 'feed_items', via: 'feedItemId', description: 'the item being commented on' },
  },
};

async function writeDb(root: string, files: Record<string, unknown>): Promise<void> {
  const dbDir = join(root, 'database');
  await mkdir(dbDir, { recursive: true });
  for (const [name, schema] of Object.entries(files)) {
    await writeFile(join(dbDir, `${name}.json`), JSON.stringify(schema, null, 2), 'utf8');
  }
}

describe('loadProjectApp — database + flags', () => {
  it('loads scratch schemas and reports dir-presence flags', async () => {
    const root = await scratch();
    await writeDb(root, { feed_items: FEED_ITEMS, comments: COMMENTS });
    await mkdir(join(root, 'pages'), { recursive: true });

    const app = await loadProjectApp(root);

    expect(app.tables.map((t) => t.name)).toEqual(['comments', 'feed_items']); // sorted
    const feed = app.tables.find((t) => t.name === 'feed_items');
    expect(feed?.schema.columns.title?.description).toBe('headline shown in the feed');
    expect(app.hasPages).toBe(true);
    expect(app.hasApi).toBe(false);
    expect(app.hasHooks).toBe(false);
    expect(app.hasApp).toBe(true);
  });

  it('sees api/ and hooks/ dirs', async () => {
    const root = await scratch();
    await writeDb(root, { feed_items: FEED_ITEMS, comments: COMMENTS });
    await mkdir(join(root, 'api'), { recursive: true });
    await mkdir(join(root, 'hooks'), { recursive: true });

    const app = await loadProjectApp(root);
    expect(app.hasApi).toBe(true);
    expect(app.hasHooks).toBe(true);
    expect(app.hasPages).toBe(false);
    expect(app.hasApp).toBe(true);
  });
});

describe('loadProjectApp — spaces-only tolerance (the `system` project)', () => {
  it('returns an empty, appless result when there is no database/ (or any app dir)', async () => {
    const root = await scratch();
    // Only a spaces/ dir — mirrors <root>/system/ structure.
    await mkdir(join(root, 'spaces', 'system-global'), { recursive: true });

    const app = await loadProjectApp(root);
    expect(app.tables).toEqual([]);
    expect(app.hasPages).toBe(false);
    expect(app.hasApi).toBe(false);
    expect(app.hasHooks).toBe(false);
    expect(app.hasApp).toBe(false);
  });

  it('an empty database/ dir yields no tables but hasApp true', async () => {
    const root = await scratch();
    await mkdir(join(root, 'database'), { recursive: true });
    const app = await loadProjectApp(root);
    expect(app.tables).toEqual([]);
    expect(app.hasApp).toBe(true);
  });
});

describe('loadProjectApp — fail-loud', () => {
  it('throws on a schema violation (missing column description)', async () => {
    const root = await scratch();
    const bad = {
      title: 'Bad',
      description: 'missing a column description',
      columns: {
        id: { type: 'string', description: 'id', primaryKey: true },
        oops: { type: 'string' }, // no description
      },
    };
    await writeDb(root, { bad });
    await expect(loadProjectApp(root)).rejects.toThrow(/description/i);
  });

  it('throws on invalid JSON', async () => {
    const root = await scratch();
    const dbDir = join(root, 'database');
    await mkdir(dbDir, { recursive: true });
    await writeFile(join(dbDir, 'broken.json'), '{ not valid json', 'utf8');
    await expect(loadProjectApp(root)).rejects.toThrow(/invalid JSON/i);
  });
});
