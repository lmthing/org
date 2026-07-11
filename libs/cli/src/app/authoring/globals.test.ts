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

import { createAppAuthoringGlobals, createProjectAuthoringGlobals, type AppAuthoringGlobals } from './globals.js';

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

// ── Live-project authoring globals (plan S11) ──────────────────────────────────

describe('createProjectAuthoringGlobals', () => {
  let projectRoot: string;
  let republishCalls: number;

  beforeEach(() => {
    // A LIVE project root distinct from the catalog root — proves the writers target
    // the live project, not `store/projects/`.
    projectRoot = mkdtempSync(join(tmpdir(), 'lm-live-project-'));
    republishCalls = 0;
  });

  afterEach(() => {
    rmSync(projectRoot, { recursive: true, force: true });
  });

  function make() {
    return createProjectAuthoringGlobals({
      projectRoot,
      republish: () => {
        republishCalls += 1;
      },
    });
  }

  it('writeProjectHook lands hooks/<slug>.ts in the LIVE project (not the catalog) and republishes', () => {
    const pa = make();
    const src = "export default { type: 'event', on: { event: 'integration-slack/message.posted' } };";
    const res = pa.writeProjectHook('slack-watch', src);
    expect(res.ok).toBe(true);
    const target = join(projectRoot, 'hooks', 'slack-watch.ts');
    expect(existsSync(target)).toBe(true);
    expect(readFileSync(target, 'utf8')).toBe(src);
    // Republish fired exactly once after the successful write (goes live, no restart).
    expect(republishCalls).toBe(1);
    // Nothing leaked into a catalogRoot-shaped path.
    expect(existsSync(join(projectRoot, 'store'))).toBe(false);
  });

  it('writeProjectEvent lands events/<name>.ts and republishes', () => {
    const pa = make();
    const src =
      "export default { type: 'db', on: { table: 'feed_items', event: 'insert' }, emits: {}, emit: () => [] };";
    const res = pa.writeProjectEvent('feed-writes', src);
    expect(res.ok).toBe(true);
    expect(existsSync(join(projectRoot, 'events', 'feed-writes.ts'))).toBe(true);
    expect(republishCalls).toBe(1);
  });

  it('writeProjectFunction lands functions/<name>.ts under a camelCase identifier name', () => {
    const pa = make();
    const src = 'export default async function slackPostMessage(i: unknown) { return i; }';
    const res = pa.writeProjectFunction('slackPostMessage', src);
    expect(res.ok).toBe(true);
    expect(existsSync(join(projectRoot, 'functions', 'slackPostMessage.ts'))).toBe(true);
    expect(republishCalls).toBe(1);
  });

  it('rejects path traversal in every writer and does NOT republish on failure', () => {
    const pa = make();
    expect(pa.writeProjectHook('../../evil', 'x').ok).toBe(false);
    expect(pa.writeProjectEvent('../../evil', 'x').ok).toBe(false);
    // A camelCase-only regex already blocks a slash/dot in a function name.
    expect(pa.writeProjectFunction('../evil', 'x').ok).toBe(false);
    expect(republishCalls).toBe(0);
    // Nothing escaped the project root.
    expect(existsSync(join(projectRoot, '..', 'evil.ts'))).toBe(false);
  });

  it('rejects an invalid hook slug (uppercase/leading digit) — kebab only', () => {
    const pa = make();
    expect(pa.writeProjectHook('Slack', 'x').ok).toBe(false);
    expect(pa.writeProjectHook('1watch', 'x').ok).toBe(false);
    expect(republishCalls).toBe(0);
  });

  it('rejects a non-identifier function name but accepts camelCase', () => {
    const pa = make();
    expect(pa.writeProjectFunction('bad-name', 'x').ok).toBe(false); // hyphen is not an identifier
    expect(pa.writeProjectFunction('goodName', 'export default 1;').ok).toBe(true);
  });

  it('a throwing republish never fails the write (fire-and-forget)', () => {
    const pa = createProjectAuthoringGlobals({
      projectRoot,
      republish: () => {
        throw new Error('republish boom');
      },
    });
    const res = pa.writeProjectHook('resilient', 'export default {};');
    expect(res.ok).toBe(true);
    expect(existsSync(join(projectRoot, 'hooks', 'resilient.ts'))).toBe(true);
  });
});
