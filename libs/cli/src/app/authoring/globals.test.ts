/**
 * Tests for the Phase 9 app-authoring globals ({@link ./globals.ts}).
 *
 * Covers: createProject scaffolding + currentApp, duplicate/reserved-id
 * rejection, writeTableSchema requiring a selected project and validating via
 * `@lmthing/core`'s `validateTableSchema`, writePage/writeApi/writeHook
 * happy-paths, method/path-traversal rejection, and selectProject binding an
 * existing vs. missing app.
 */

import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { TableSchema } from '@lmthing/core';

import { createAppAuthoringGlobals, type AppAuthoringGlobals } from './globals.js';

let catalogRoot: string;
let authoring: AppAuthoringGlobals;

beforeEach(() => {
  catalogRoot = mkdtempSync(join(tmpdir(), 'lm-authoring-'));
  authoring = createAppAuthoringGlobals({ catalogRoot });
});

afterEach(() => {
  rmSync(catalogRoot, { recursive: true, force: true });
});

const validSchema: TableSchema = {
  title: 'Feed items',
  description: 'One personalized item in the feed.',
  columns: {
    id: { type: 'string', description: 'unique id', primaryKey: true, generated: 'uuid' },
    title: { type: 'string', description: 'headline', required: true },
  },
};

describe('createProject', () => {
  it('scaffolds the tree and sets currentApp', () => {
    const res = authoring.createProject('feed', { title: 'Feed App' });
    expect(res.ok).toBe(true);
    expect(res.appId).toBe('feed');
    const root = res.root!;
    expect(existsSync(join(root, 'package.json'))).toBe(true);
    expect(existsSync(join(root, 'project.json'))).toBe(true);
    for (const dir of ['database', 'pages', 'api', 'hooks', 'components', 'lib']) {
      expect(existsSync(join(root, dir))).toBe(true);
    }
    const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
    expect(pkg.name).toBe('@app/feed');
    expect(pkg.private).toBe(true);
    expect(pkg.type).toBe('module');
    const project = JSON.parse(readFileSync(join(root, 'project.json'), 'utf8'));
    expect(project.id).toBe('feed');
    expect(project.title).toBe('Feed App');
    expect(typeof project.createdAt).toBe('string');

    expect(authoring.currentApp()).toEqual({ id: 'feed', root });
  });

  it('defaults title to the id when omitted', () => {
    const res = authoring.createProject('notes');
    const project = JSON.parse(readFileSync(join(res.root!, 'project.json'), 'utf8'));
    expect(project.title).toBe('notes');
  });

  it('fails loud on a duplicate id', () => {
    expect(authoring.createProject('feed').ok).toBe(true);
    const res = authoring.createProject('feed');
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/already exists/);
  });

  it('rejects the reserved id "system"', () => {
    const res = authoring.createProject('system');
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/reserved/);
  });

  it('rejects an invalid slug', () => {
    expect(authoring.createProject('Feed').ok).toBe(false);
    expect(authoring.createProject('1feed').ok).toBe(false);
    expect(authoring.createProject('../evil').ok).toBe(false);
  });
});

describe('selectProject', () => {
  it('binds an existing app and sets currentApp', () => {
    const created = authoring.createProject('feed');
    // Fresh instance to prove selectProject (not createProject) does the binding.
    const authoring2 = createAppAuthoringGlobals({ catalogRoot });
    const res = authoring2.selectProject('feed');
    expect(res.ok).toBe(true);
    expect(res.root).toBe(created.root);
    expect(authoring2.currentApp()).toEqual({ id: 'feed', root: created.root });
  });

  it('fails loud for a non-existent app', () => {
    const res = authoring.selectProject('nope');
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/does not exist/);
  });
});

describe('writeTableSchema', () => {
  it('fails when no project is selected', () => {
    const res = authoring.writeTableSchema('items', validSchema);
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/no project selected/);
  });

  it('rejects an invalid schema (missing description) via validateTableSchema', () => {
    authoring.createProject('feed');
    const bad = { title: 'X', columns: { id: { type: 'string', primaryKey: true } } };
    const res = authoring.writeTableSchema('items', bad);
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/description/);
  });

  it('writes a valid schema to database/<name>.json', () => {
    const { root } = authoring.createProject('feed');
    const res = authoring.writeTableSchema('items', validSchema);
    expect(res.ok).toBe(true);
    const written = JSON.parse(readFileSync(join(root!, 'database', 'items.json'), 'utf8'));
    expect(written).toEqual(validSchema);
  });

  it('accepts a snake_case table name (the universal db convention)', () => {
    // Regression: table names are snake_case (feed_items, raw_items) — the kebab-case
    // id/hook slug regex rejected the underscore, silently sinking every db schema.
    const { root } = authoring.createProject('feed');
    const res = authoring.writeTableSchema('feed_items', validSchema);
    expect(res.ok).toBe(true);
    expect(readFileSync(join(root!, 'database', 'feed_items.json'), 'utf8')).toContain('columns');
  });

  it('rejects a hyphenated table name (would break unquoted CREATE TABLE)', () => {
    authoring.createProject('feed');
    const res = authoring.writeTableSchema('feed-items', validSchema);
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/snake_case/);
  });

  it('rejects path traversal in the table name', () => {
    authoring.createProject('feed');
    const res = authoring.writeTableSchema('../../evil', validSchema);
    expect(res.ok).toBe(false);
  });
});

describe('writePage', () => {
  it('writes pages/index.tsx', () => {
    const { root } = authoring.createProject('feed');
    const res = authoring.writePage('index', 'export default function Page() { return null; }');
    expect(res.ok).toBe(true);
    expect(existsSync(join(root!, 'pages', 'index.tsx'))).toBe(true);
  });

  it('writes a nested dynamic route pages/items/[id].tsx', () => {
    const { root } = authoring.createProject('feed');
    const res = authoring.writePage('items/[id]', 'export default function Page() { return null; }');
    expect(res.ok).toBe(true);
    expect(existsSync(join(root!, 'pages', 'items', '[id].tsx'))).toBe(true);
  });

  it('rejects path traversal', () => {
    authoring.createProject('feed');
    const res = authoring.writePage('../../etc/passwd', 'x');
    expect(res.ok).toBe(false);
  });

  it('fails when no project is selected', () => {
    const res = authoring.writePage('index', 'x');
    expect(res.ok).toBe(false);
  });
});

describe('writeApi', () => {
  it('writes api/feed-list/GET.ts', () => {
    const { root } = authoring.createProject('feed');
    const res = authoring.writeApi('feed-list/GET', 'export default async function handler() {}');
    expect(res.ok).toBe(true);
    expect(existsSync(join(root!, 'api', 'feed-list', 'GET.ts'))).toBe(true);
  });

  it('writes a nested dynamic endpoint api/articles/[id]/POST.ts', () => {
    const { root } = authoring.createProject('feed');
    const res = authoring.writeApi('articles/[id]/POST', 'export default async function handler() {}');
    expect(res.ok).toBe(true);
    expect(existsSync(join(root!, 'api', 'articles', '[id]', 'POST.ts'))).toBe(true);
  });

  it('rejects a bad method', () => {
    authoring.createProject('feed');
    const res = authoring.writeApi('feed-list/FETCH', 'x');
    expect(res.ok).toBe(false);
  });

  it('rejects path traversal', () => {
    authoring.createProject('feed');
    const res = authoring.writeApi('../../feed-list/GET', 'x');
    expect(res.ok).toBe(false);
  });
});

describe('writeHook', () => {
  it('writes hooks/<slug>.ts', () => {
    const { root } = authoring.createProject('feed');
    const res = authoring.writeHook('nightly-digest', 'export default async function hook() {}');
    expect(res.ok).toBe(true);
    expect(existsSync(join(root!, 'hooks', 'nightly-digest.ts'))).toBe(true);
  });

  it('rejects path traversal', () => {
    authoring.createProject('feed');
    const res = authoring.writeHook('../../evil', 'x');
    expect(res.ok).toBe(false);
  });

  it('fails when no project is selected', () => {
    const res = authoring.writeHook('nightly-digest', 'x');
    expect(res.ok).toBe(false);
  });
});
