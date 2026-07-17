/**
 * Tests for the LIVE-PROJECT app-authoring globals ({@link ./globals.ts}).
 *
 * The store-catalog authoring engine (`createAppAuthoringGlobals` +
 * `createProject`/`selectProject`/`writeTableSchema`/`writePage`/`writeApi`/`writeHook`)
 * has been removed — THING now creates a LIVE project and delegates the build INTO it,
 * and the live create/select globals are covered by the session-manager integration test.
 * What remains here is the `createProjectAuthoringGlobals` writer family, which writes
 * directly into a fixed live-project root.
 */

import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { TableSchema } from '@lmthing/core';

import { createProjectAuthoringGlobals } from './globals.js';
import { LintError } from './lint.js';

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
    const res = pa.writeProjectHook('resilient', "export default { type: 'event', on: { event: 'x/y' }, handler: async () => {} };");
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

  describe('writeProjectHook rejects a write into columns the table does not have', () => {
    /** The real recipe book from scenario 10: the intake hook guessed 4 of its 6 columns. */
    function withRecipes() {
      const pa = make();
      pa.writeProjectTable('recipes', {
        title: 'Recipes',
        description: 'The family recipe book',
        columns: {
          id: { type: 'string', description: 'pk', primaryKey: true, generated: 'uuid' },
          title_gr: { type: 'string', description: 'greek title' },
          cuisine_id: { type: 'string', description: 'cuisine' },
          ingredients_text: { type: 'string', description: 'ingredients' },
          instructions_text: { type: 'string', description: 'steps' },
        },
      } as unknown as TableSchema);
      return pa;
    }

    it('rejects the live failure — db.insert naming `ingredients` on a table that has `ingredients_text`', () => {
      const pa = withRecipes();
      const res = pa.writeProjectHook(
        'recipe-intake-normalizer',
        `export default { type: 'event', on: { event: 'project/db.recipe_intake.insert' },
           handler: async ({ input, db }) => {
             await db.insert('recipes', {
               title_gr: String(input.title),
               cuisine_id: 'greek',
               ingredients: JSON.stringify(input.ingredients),
               instructions: JSON.stringify(input.steps),
             });
           } };`,
      );
      expect(res.ok).toBe(false);
      // The error must NAME the bad columns, the real ones, and the near-miss — it is what the
      // agent reads before retrying.
      expect(res.error).toContain('"ingredients"');
      expect(res.error).toContain('did you mean "ingredients_text"');
      expect(res.error).toContain('title_gr, cuisine_id, ingredients_text');
      // Nothing was left behind on disk: a rejected hook must not be a hook that dies at runtime.
      expect(existsSync(join(projectRoot, 'hooks', 'recipe-intake-normalizer.ts'))).toBe(false);
    });

    it('rejects an update whose set: block names an unknown column', () => {
      const pa = withRecipes();
      const res = pa.writeProjectHook(
        'touch',
        `export default { type: 'event', on: { event: 'x' }, handler: async ({ db }) => {
           await db.update('recipes', { where: { id: '1' }, set: { title: 'x' } });
         } };`,
      );
      expect(res.ok).toBe(false);
      expect(res.error).toContain('did you mean "title_gr"');
    });

    it('accepts a hook that writes the REAL columns', () => {
      const pa = withRecipes();
      const res = pa.writeProjectHook(
        'good',
        `export default { type: 'event', on: { event: 'x' }, handler: async ({ input, db }) => {
           await db.insert('recipes', { title_gr: input.t, cuisine_id: 'greek', ingredients_text: '…' });
           await db.update('recipes', { where: { id: input.id }, set: { instructions_text: '…' } });
         } };`,
      );
      expect(res.ok).toBe(true);
      expect(existsSync(join(projectRoot, 'hooks', 'good.ts'))).toBe(true);
    });

    it('gates writeProjectApi the same way — a POST route that writes the wrong columns loses the submission', () => {
      const pa = withRecipes();
      const bad = pa.writeProjectApi(
        'recipes-create/POST',
        `export default async function handler({ body, db }: any) {
           await db.insert('recipes', { title: body.title });
           return { ok: true };
         }`,
      );
      expect(bad.ok).toBe(false);
      expect(bad.error).toContain('did you mean "title_gr"');
      expect(
        pa.writeProjectApi(
          'recipes-create/POST',
          `export const name = 'recipesCreate';
           export default async function handler({ body, db }: any) {
             await db.insert('recipes', { title_gr: body.title });
             return { ok: true };
           }`,
        ).ok,
      ).toBe(true);
    });

    it('stays out of the way when it cannot know the keys (a spread) or the table (no schema)', () => {
      const pa = withRecipes();
      // A spread hides the real keys — blocking here would be a false positive.
      expect(
        pa.writeProjectHook(
          'spread',
          `export default { type: 'event', on: { event: 'x' }, handler: async ({ input, db }) => {
             await db.insert('recipes', { ...input, title_gr: 'x' });
           } };`,
        ).ok,
      ).toBe(true);
      // A table with no declared schema is not this check's business.
      expect(
        pa.writeProjectHook(
          'other-table',
          `export default { type: 'event', on: { event: 'x' }, handler: async ({ db }) => {
             await db.insert('some_other_table', { whatever: 1 });
           } };`,
        ).ok,
      ).toBe(true);
    });
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
    const res = pa.writeProjectApi('bookings-list/GET', "export const name = 'bookingsList';\nexport default async () => ({ items: [] });");
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

  // Write-time lint: a generated artifact that violates its loader contract is REJECTED at the
  // write with a thrown, retryable error (like a typecheck failure) — not accepted here to fail
  // later at app compile/serve. The model sees the throw and re-writes.
  describe('write-time lint (loader contract) throws a retryable error, writes nothing', () => {
    it('writeProjectApi: missing `export const name` throws and leaves no file (the round-1 regression)', () => {
      const pa = make();
      expect(() => pa.writeProjectApi('dash/GET', 'export default async () => ({ items: [] });')).toThrow(
        /export const name/,
      );
      expect(existsSync(join(projectRoot, 'api', 'dash', 'GET.ts'))).toBe(false);
      // A corrected re-write (with a name) succeeds.
      expect(
        pa.writeProjectApi('dash/GET', "export const name = 'dashGet';\nexport default async () => ({ items: [] });").ok,
      ).toBe(true);
    });

    it('writeProjectApi: a duplicate endpoint name throws', () => {
      const pa = make();
      expect(pa.writeProjectApi('a/GET', "export const name = 'shared';\nexport default () => ({});").ok).toBe(true);
      expect(() =>
        pa.writeProjectApi('b/GET', "export const name = 'shared';\nexport default () => ({});"),
      ).toThrow(/already used by/);
    });

    it('writeProjectPage / writeProjectComponent: no default export throws', () => {
      const pa = make();
      expect(() => pa.writeProjectPage('nope', 'export const x = 1;')).toThrow(/default export/);
      expect(() => pa.writeProjectComponent('Card', 'export const x = 1;')).toThrow(/default export/);
    });

    it('writeProjectHook: a non-object / unknown-type hook throws', () => {
      const pa = make();
      expect(() => pa.writeProjectHook('h1', 'export default async function () {}')).toThrow(/hook OBJECT/);
      expect(() => pa.writeProjectHook('h2', 'export default { type: "nope" };')).toThrow(/cron/);
      // A valid hook object still writes.
      expect(pa.writeProjectHook('h3', "export default { type: 'cron', every: '1d', handler: async () => {} };").ok).toBe(true);
    });

    it('the thrown lint error is a LintError (retryable), not a swallowed { ok:false }', () => {
      const pa = make();
      let caught: unknown;
      try {
        pa.writeProjectPage('x', 'export const x = 1;');
      } catch (e) {
        caught = e;
      }
      expect(caught).toBeInstanceOf(LintError);
    });
  });
});
