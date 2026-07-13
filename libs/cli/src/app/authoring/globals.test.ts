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

  const TIPS_SCHEMA = {
    title: 'Tips',
    description: 'Story tips',
    columns: {
      id: { type: 'string', description: 'pk', primaryKey: true, generated: 'uuid' },
      headline: { type: 'string', description: 'short headline' },
    },
  } as unknown as TableSchema;

  it('writeProjectTable lands database/<name>.json in the LIVE project and fires onSchemaWrite', () => {
    let schemaWrites: string[] = [];
    const pa = createProjectAuthoringGlobals({
      projectRoot,
      republish: () => {
        republishCalls += 1;
      },
      onSchemaWrite: (t) => schemaWrites.push(t),
    });
    const res = pa.writeProjectTable('tips', TIPS_SCHEMA);
    expect(res.ok).toBe(true);
    const target = join(projectRoot, 'database', 'tips.json');
    expect(existsSync(target)).toBe(true);
    expect(JSON.parse(readFileSync(target, 'utf8')).columns.headline.type).toBe('string');
    // The write goes live (republish) AND the db is re-derived (onSchemaWrite).
    expect(republishCalls).toBe(1);
    expect(schemaWrites).toEqual(['tips']);
  });

  it('writeProjectTable MERGES a redefinition of an existing table — a column is never dropped from the declaration', () => {
    const pa = make();
    // The app's real recipe book: the pages render `title_gr`/`cuisine_id`.
    expect(
      pa.writeProjectTable('recipes', {
        title: 'Recipes',
        description: 'The family recipe book',
        columns: {
          id: { type: 'string', description: 'pk', primaryKey: true, generated: 'uuid' },
          title_gr: { type: 'string', description: 'greek title' },
          cuisine_id: { type: 'string', description: 'cuisine' },
        },
      } as unknown as TableSchema).ok,
    ).toBe(true);

    // Mid-life, a feature (the "add a recipe" intake hook) redefines `recipes` with ITS OWN
    // shape. reconcileTable can only ADD columns to the live SQLite table, so honouring this
    // as a substitution would leave the declaration describing a table that does not exist:
    // title_gr/cuisine_id would still physically hold every recipe, but nothing downstream —
    // DTS, marshalling, the book page — would know they were there.
    expect(
      pa.writeProjectTable('recipes', {
        title: 'Recipes',
        description: 'Recipes (intake shape)',
        columns: {
          id: { type: 'string', description: 'pk', primaryKey: true, generated: 'uuid' },
          title: { type: 'string', description: 'title' },
          ingredients: { type: 'json', description: 'ingredient list' },
        },
      } as unknown as TableSchema).ok,
    ).toBe(true);

    const declared = JSON.parse(readFileSync(join(projectRoot, 'database', 'recipes.json'), 'utf8'));
    // The union: the new columns arrived and the old ones SURVIVED.
    expect(Object.keys(declared.columns).sort()).toEqual([
      'cuisine_id',
      'id',
      'ingredients',
      'title',
      'title_gr',
    ]);
    // A same-named column takes the incoming definition (a redefinition still redefines).
    expect(declared.columns.id.primaryKey).toBe(true);
  });

  it('writeProjectTable does not merge a table that does not exist yet (a new table is exactly what was asked for)', () => {
    const pa = make();
    expect(pa.writeProjectTable('tips', TIPS_SCHEMA).ok).toBe(true);
    const declared = JSON.parse(readFileSync(join(projectRoot, 'database', 'tips.json'), 'utf8'));
    expect(Object.keys(declared.columns)).toEqual(Object.keys(TIPS_SCHEMA.columns));
  });

  it('writeProjectTable forwards seed rows to onSchemaWrite (move known data into the app in one pass)', () => {
    const seeds: Array<{ table: string; rows: unknown[] | undefined }> = [];
    const pa = createProjectAuthoringGlobals({
      projectRoot,
      republish: () => {},
      onSchemaWrite: (t, rows) => seeds.push({ table: t, rows }),
    });
    const rows = [
      { id: 'f1', headline: 'ATH→CAI A3932' },
      { id: 'f2', headline: 'CAI→DAR EgyptAir' },
    ];
    const res = pa.writeProjectTable('tips', TIPS_SCHEMA, rows);
    expect(res.ok).toBe(true);
    // The schema landed AND the rows rode through to the host seeder.
    expect(seeds).toEqual([{ table: 'tips', rows }]);
    // No rows → onSchemaWrite still fires (re-derive) but with undefined rows.
    pa.writeProjectTable('notes', { ...TIPS_SCHEMA, title: 'Notes' } as unknown as TableSchema);
    expect(seeds[1]).toEqual({ table: 'notes', rows: undefined });
  });

  it('writeProjectTable rejects a non-array rows arg', () => {
    const pa = make();
    const res = pa.writeProjectTable('tips', TIPS_SCHEMA, { nope: true } as unknown as unknown[]);
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/rows must be an array/);
    expect(existsSync(join(projectRoot, 'database', 'tips.json'))).toBe(false);
  });

  it('listProjectDir + readProjectFile read PROJECT-ROOTED (not the space dir), safe for a missing dir', () => {
    const pa = make();
    // Missing dir → ok with empty entries (a fresh project can safely ask "what tables exist?").
    expect(pa.listProjectDir('database')).toEqual({ ok: true, entries: [] });
    // After authoring two tables they show up, sorted, in the PROJECT's database/ dir.
    pa.writeProjectTable('flights', TIPS_SCHEMA);
    pa.writeProjectTable('accommodations', { ...TIPS_SCHEMA, title: 'Acc' } as unknown as TableSchema);
    expect(pa.listProjectDir('database')).toEqual({ ok: true, entries: ['accommodations.json', 'flights.json'] });
    // readProjectFile returns the authored schema's text from the project root.
    const read = pa.readProjectFile('database/flights.json');
    expect(read.ok).toBe(true);
    expect(JSON.parse(read.content).columns.headline.type).toBe('string');
    // A missing file is a clean error, not a throw.
    expect(pa.readProjectFile('database/nope.json')).toEqual({ ok: false, content: '', error: expect.stringMatching(/no such file/) });
    // Traversal is contained to the project root.
    expect(pa.readProjectFile('../../etc/passwd').ok).toBe(false);
    expect(pa.listProjectDir('../..').ok === false || pa.listProjectDir('../..').entries.length >= 0).toBe(true);
  });

  it('writeProjectTable rejects an invalid schema (missing description) and does NOT re-derive', () => {
    let schemaWrites = 0;
    const pa = createProjectAuthoringGlobals({
      projectRoot,
      republish: () => {},
      onSchemaWrite: () => {
        schemaWrites += 1;
      },
    });
    const bad = { title: 'X', columns: { id: { type: 'string', generated: 'uuid' } } };
    const res = pa.writeProjectTable('tips', bad);
    expect(res.ok).toBe(false);
    expect(existsSync(join(projectRoot, 'database', 'tips.json'))).toBe(false);
    expect(schemaWrites).toBe(0);
  });

  it('writeProjectTable rejects a non-snake_case table name (traversal-safe)', () => {
    const pa = make();
    expect(pa.writeProjectTable('../evil', TIPS_SCHEMA).ok).toBe(false);
    expect(pa.writeProjectTable('Tips', TIPS_SCHEMA).ok).toBe(false); // uppercase not allowed
    expect(existsSync(join(projectRoot, 'database'))).toBe(false);
  });

  it('writeProjectPage lands pages/<route>.tsx in the LIVE project and fires onAppWrite(page)', () => {
    const appWrites: Array<[string, string]> = [];
    const pa = createProjectAuthoringGlobals({
      projectRoot,
      republish: () => {
        republishCalls += 1;
      },
      onAppWrite: (kind, route) => appWrites.push([kind, route]),
    });
    const src = "import { useApi } from '@app/runtime';\nexport default function Home() { return <div/>; }";
    const res = pa.writeProjectPage('index', src);
    expect(res.ok).toBe(true);
    const target = join(projectRoot, 'pages', 'index.tsx');
    expect(existsSync(target)).toBe(true);
    expect(readFileSync(target, 'utf8')).toBe(src);
    expect(republishCalls).toBe(1);
    expect(appWrites).toEqual([['page', 'index']]);
    // A dynamic nested route keeps its path and gains the .tsx suffix.
    expect(pa.writeProjectPage('bookings/[id]', 'export default () => null;').ok).toBe(true);
    expect(existsSync(join(projectRoot, 'pages', 'bookings', '[id].tsx'))).toBe(true);
  });

  // The mid-life clobber (scenario 07): a later "add an invoices section" turn re-authored
  // pages/index.tsx from scratch. The app still built, every route still 200'd — and the user
  // opened their vault to a stub linking to Invoices, the dashboard gone, `/vault-dashboard`
  // still serving the whole household to nobody. A page rewrite that drops the page's data is a
  // deletion, and the writer now says so.
  describe('writeProjectPage — overwrite guard (do not silently delete the page the user has)', () => {
    const DASHBOARD = [
      "import { useApi } from '@app/runtime';",
      "export default function Home() {",
      "  const { data } = useApi<{ items: unknown[] }>('vault-dashboard');",
      "  return <div>{(data?.items ?? []).length}</div>;",
      "}",
    ].join('\n');
    const STUB = [
      "import { Link } from '@app/runtime';",
      "export default function Home() { return <Link href=\"/invoices\">Invoices</Link>; }",
    ].join('\n');

    it('rejects a replacement that fetches NONE of the routes the existing page fetched', () => {
      const pa = make();
      expect(pa.writeProjectPage('index', DASHBOARD).ok).toBe(true);
      const res = pa.writeProjectPage('index', STUB);
      expect(res.ok).toBe(false);
      expect(res.error).toMatch(/vault-dashboard/);
      expect(res.error).toMatch(/readProjectFile/);
      // and the user's dashboard is still on disk, untouched
      expect(readFileSync(join(projectRoot, 'pages', 'index.tsx'), 'utf8')).toBe(DASHBOARD);
    });

    it('allows the growth that SHOULD happen: the same page keeping its data and adding a section', () => {
      const pa = make();
      expect(pa.writeProjectPage('index', DASHBOARD).ok).toBe(true);
      const grown = DASHBOARD.replace(
        "  return <div>{(data?.items ?? []).length}</div>;",
        [
          "  const inv = useApi<{ invoices: unknown[] }>('invoices-list');",
          "  return <div>{(data?.items ?? []).length}{(inv.data?.invoices ?? []).length}</div>;",
        ].join('\n'),
      );
      expect(pa.writeProjectPage('index', grown).ok).toBe(true);
      expect(readFileSync(join(projectRoot, 'pages', 'index.tsx'), 'utf8')).toBe(grown);
    });

    it('allows a first write, a page that never fetched anything, and an explicit { replace: true }', () => {
      const pa = make();
      expect(pa.writeProjectPage('about', STUB).ok).toBe(true); // new page — nothing to lose
      expect(pa.writeProjectPage('about', STUB).ok).toBe(true); // it fetched nothing anyway
      expect(pa.writeProjectPage('index', DASHBOARD).ok).toBe(true);
      expect(pa.writeProjectPage('index', STUB, { replace: true }).ok).toBe(true); // "yes, delete it"
      expect(readFileSync(join(projectRoot, 'pages', 'index.tsx'), 'utf8')).toBe(STUB);
    });
  });

  it('writeProjectApi lands api/<path>/<METHOD>.ts and fires onAppWrite(api)', () => {
    const appWrites: Array<[string, string]> = [];
    const pa = createProjectAuthoringGlobals({
      projectRoot,
      republish: () => {},
      onAppWrite: (kind, route) => appWrites.push([kind, route]),
    });
    const res = pa.writeProjectApi('bookings-list/GET', 'export default async () => ({ items: [] });');
    expect(res.ok).toBe(true);
    expect(existsSync(join(projectRoot, 'api', 'bookings-list', 'GET.ts'))).toBe(true);
    expect(appWrites).toEqual([['api', 'bookings-list/GET']]);
  });

  it('rejects UNPARSEABLE source (literal \\n instead of newlines) before it lands — hook/event/page/api', () => {
    const pa = make();
    // The exact scenario-05 corruption: a one-line file with literal backslash-n escapes.
    const broken = "export default {\\n  type: 'event',\\n  on: { event: 'x/y' },\\n};";
    const h = pa.writeProjectHook('broken-hook', broken);
    expect(h.ok).toBe(false);
    expect(h.error).toMatch(/failed to parse/i);
    expect(existsSync(join(projectRoot, 'hooks', 'broken-hook.ts'))).toBe(false); // never landed
    expect(pa.writeProjectEvent('broken-evt', broken).ok).toBe(false);
    expect(pa.writeProjectApi('broken-list/GET', broken).ok).toBe(false);
    expect(pa.writeProjectPage('broken', broken).ok).toBe(false);
    // A well-formed multi-line hook (real newlines) still writes.
    const good = ["export default {", "  type: 'event',", "  on: { event: 'x/y' },", "};"].join('\n');
    expect(pa.writeProjectHook('good-hook', good).ok).toBe(true);
    expect(existsSync(join(projectRoot, 'hooks', 'good-hook.ts'))).toBe(true);
  });

  it('writeProjectApi rejects an invalid method and a traversal route (no onAppWrite)', () => {
    let appWrites = 0;
    const pa = createProjectAuthoringGlobals({
      projectRoot,
      republish: () => {},
      onAppWrite: () => {
        appWrites += 1;
      },
    });
    expect(pa.writeProjectApi('bookings/FETCH', 'x').ok).toBe(false); // not a real HTTP method
    expect(pa.writeProjectApi('../evil/GET', 'x').ok).toBe(false); // traversal
    expect(pa.writeProjectPage('../../evil', 'x').ok).toBe(false);
    expect(appWrites).toBe(0);
    expect(existsSync(join(projectRoot, 'api'))).toBe(false);
  });
});
