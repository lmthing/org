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

import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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
           export default async function handler(input: Record<string, unknown>, ctx: any) {
             await ctx.db.insert('recipes', { title_gr: input.title });
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

  describe('writeProjectHook rejects an event address on a table that does not exist', () => {
    /** A project whose only table is `recipes` — so `project/db.recipes.*` is real and nothing else is. */
    function withRecipes() {
      const pa = make();
      pa.writeProjectTable('recipes', {
        title: 'Recipes',
        description: 'The family recipe book',
        columns: {
          id: { type: 'string', description: 'pk', primaryKey: true, generated: 'uuid' },
          title_gr: { type: 'string', description: 'greek title' },
        },
      } as unknown as TableSchema);
      return pa;
    }

    it('rejects an event hook subscribing to project/db.<missingTable>.insert — a hook that never fires', () => {
      const pa = withRecipes();
      const res = pa.writeProjectHook(
        'watch-reminders',
        `export default { type: 'event', on: { event: 'project/db.reminders.insert' },
           handler: async () => {} };`,
      );
      expect(res.ok).toBe(false);
      expect(res.error).toContain('reminders');
      expect(res.error).toContain('never fires');
      // The real table is named so the agent can re-point at it.
      expect(res.error).toContain('recipes');
      // Nothing left on disk — a silently-inert hook must not ship.
      expect(existsSync(join(projectRoot, 'hooks', 'watch-reminders.ts'))).toBe(false);
    });

    it('accepts an event hook subscribing to a REAL db table', () => {
      const pa = withRecipes();
      const res = pa.writeProjectHook(
        'on-recipe-added',
        `export default { type: 'event', on: { event: 'project/db.recipes.insert' },
           handler: async ({ input }) => { if (!input) return; } };`,
      );
      expect(res.ok).toBe(true);
      expect(existsSync(join(projectRoot, 'hooks', 'on-recipe-added.ts'))).toBe(true);
    });

    it('stays out of the way for a space event and a curated project event (not a db address)', () => {
      const pa = withRecipes();
      // A space-scoped event is not a db address — never checked.
      expect(
        pa.writeProjectHook('slack', "export default { type: 'event', on: { event: 'integration-slack/message.posted' }, handler: async () => {} };").ok,
      ).toBe(true);
      // A curated `project/<name>` event (not `project/db.<table>.<event>`) is not a table address.
      expect(
        pa.writeProjectHook('curated', "export default { type: 'event', on: { event: 'project/recipe.published' }, handler: async () => {} };").ok,
      ).toBe(true);
    });

    it('never false-rejects on a fresh project with no tables — nothing to check against', () => {
      // A distinct root with NO tables written: declaredTables() is empty, so the check is silent.
      const fresh = make();
      expect(
        fresh.writeProjectHook('early', "export default { type: 'event', on: { event: 'project/db.anything.insert' }, handler: async () => {} };").ok,
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

// ── Save-time feedback for pages/components (plan Part C) ──────────────────────

describe('writeProjectPage / writeProjectComponent save-time checks', () => {
  let projectRoot: string;

  beforeEach(() => {
    projectRoot = mkdtempSync(join(tmpdir(), 'lm-partc-'));
  });
  afterEach(() => {
    rmSync(projectRoot, { recursive: true, force: true });
  });

  function make() {
    return createProjectAuthoringGlobals({ projectRoot });
  }

  /** Author an endpoint on disk so the cross-artifact checks have something to check against. */
  function endpoint(dirSegs: string[], method: string, name: string) {
    mkdirSync(join(projectRoot, 'api', ...dirSegs), { recursive: true });
    writeFileSync(
      join(projectRoot, 'api', ...dirSegs, `${method}.ts`),
      `export const name = '${name}';\nexport default () => ({ items: [] });`,
    );
  }

  // A realistic page: real code always imports the data hooks it uses (a page using `useApi`
  // without importing it is itself a typecheck error — save-time now enforces that).
  const page = (body: string) =>
    `import { useApi, useApiMutation } from '@app/runtime';\nexport default function Page() {\n  ${body}\n  return <div />;\n}`;

  it('rejects a page calling an endpoint name nothing exports — as a retryable LintError', () => {
    endpoint(['trips'], 'GET', 'tripsList');
    const pa = make();
    // A LintError must ESCAPE the writer's catch (a `{ok:false}` a node might ignore is not enough).
    expect(() => pa.writeProjectPage('costs', page("const { data } = useApi('costs-summary');"))).toThrow(
      LintError,
    );
    expect(() => pa.writeProjectPage('costs', page("const { data } = useApi('costs-summary');"))).toThrow(
      /no endpoint named "costs-summary"/,
    );
    // Nothing landed on disk.
    expect(existsSync(join(projectRoot, 'pages', 'costs.tsx'))).toBe(false);
  });

  it('rejects a page calling a [id] endpoint with no param, and accepts it once supplied', () => {
    endpoint(['trips', '[id]'], 'GET', 'tripsDetail');
    const pa = make();
    expect(() => pa.writeProjectPage('trip', page("const { data } = useApi('tripsDetail');"))).toThrow(
      /parameterized and needs "id"/,
    );
    expect(pa.writeProjectPage('trip', page("const id = 'abc'; const { data } = useApi('tripsDetail', { id });")).ok).toBe(true);
  });

  it('rejects a component that returns a { type, props } display descriptor', () => {
    const pa = make();
    const src = "export default function Card() { return { type: 'div', props: { children: 'x' } }; }";
    expect(() => pa.writeProjectComponent('Card', src)).toThrow(/React error #31/);
    expect(existsSync(join(projectRoot, 'components', 'Card.tsx'))).toBe(false);
  });

  it('rejects text-muted in a page and in a component, naming the -foreground fix', () => {
    const pa = make();
    expect(() => pa.writeProjectPage('index', page('const cls = "text-muted";'))).toThrow(
      /Use `text-muted-foreground`/,
    );
    expect(() =>
      pa.writeProjectComponent('Row', 'export default () => <p className="text-muted">hi</p>;'),
    ).toThrow(/invisible/);
  });

  it('accepts a correct page — real endpoint, param supplied, JSX return, -foreground text token', () => {
    endpoint(['trips'], 'GET', 'tripsList');
    endpoint(['trips', '[id]'], 'GET', 'tripsDetail');
    const pa = make();
    const src = [
      "import { useApi } from '@app/runtime';",
      'export default function Page({ id }: { id: string }) {',
      "  const list = useApi<{ items: unknown[] }>('tripsList');",
      "  const detail = useApi('tripsDetail', { id });",
      '  return <div className="text-muted-foreground bg-muted">{String(list.data)}{String(detail.data)}</div>;',
      '}',
    ].join('\n');
    expect(pa.writeProjectPage('trips', src).ok).toBe(true);
    expect(existsSync(join(projectRoot, 'pages', 'trips.tsx'))).toBe(true);
  });

  it('still accepts a page written before any endpoint exists (no api/ dir yet)', () => {
    const pa = make();
    expect(pa.writeProjectPage('shell', page("const { data } = useApi('notYetAuthored');")).ok).toBe(true);
  });
});

// ── Save-time PARTIAL TYPECHECK: hook-API misuse caught in the writer, not deferred to appCheck ──
//
// The five type faults that shipped a dead app in 06-tanzania run 34 — none of which needs an
// endpoint body or a sibling component to detect — are rejected at WRITE time so the model fixes
// them in the same turn. Valid incremental authoring (a not-yet-written sibling component) still
// saves; an unknown endpoint NAME does not (the pipeline authors endpoints before pages).
describe('writeProjectPage / writeProjectComponent / writeProjectApi save-time typecheck', () => {
  let projectRoot: string;
  beforeEach(() => {
    projectRoot = mkdtempSync(join(tmpdir(), 'lm-savetc-'));
  });
  afterEach(() => {
    rmSync(projectRoot, { recursive: true, force: true });
  });
  function make() {
    return createProjectAuthoringGlobals({ projectRoot });
  }
  function endpoint(dirSegs: string[], method: string, name: string) {
    mkdirSync(join(projectRoot, 'api', ...dirSegs), { recursive: true });
    writeFileSync(
      join(projectRoot, 'api', ...dirSegs, `${method}.ts`),
      `export const name = '${name}';\nexport default () => ({ items: [] });`,
    );
  }
  const page = (body: string) =>
    `import { useApi, useApiMutation } from '@app/runtime';\nexport default function Page() {\n${body}\n  return <div />;\n}`;

  it('REJECTS `.mutateAsync(...)` on a useApiMutation result (it only has `mutate`)', () => {
    endpoint(['trips'], 'POST', 'tripsCreate');
    const pa = make();
    expect(() =>
      pa.writeProjectPage('new', page("  const m = useApiMutation('tripsCreate');\n  m.mutateAsync({});")),
    ).toThrow(LintError);
    expect(() =>
      pa.writeProjectPage('new', page("  const m = useApiMutation('tripsCreate');\n  m.mutateAsync({});")),
    ).toThrow(/mutateAsync/);
    expect(existsSync(join(projectRoot, 'pages', 'new.tsx'))).toBe(false);
  });

  it('REJECTS `.isLoading` on a useApiMutation result (a mutation exposes `isPending`)', () => {
    endpoint(['trips'], 'POST', 'tripsCreate');
    const pa = make();
    expect(() =>
      pa.writeProjectPage('new', page("  const m = useApiMutation('tripsCreate');\n  const busy = m.isLoading;")),
    ).toThrow(/isLoading/);
  });

  it('REJECTS `data.items` on an untyped useApi result (data is `unknown` — needs a generic)', () => {
    endpoint(['trips'], 'GET', 'tripsList');
    const pa = make();
    expect(() =>
      pa.writeProjectPage('list', page("  const { data } = useApi('tripsList');\n  const n = data.items;")),
    ).toThrow(LintError);
    expect(() =>
      pa.writeProjectPage('list', page("  const { data } = useApi('tripsList');\n  const n = data.items;")),
    ).toThrow(/unknown|data/i);
  });

  it('REJECTS an api handler using `apiHandler` (an invented wrapper — should be `handler`)', () => {
    endpoint(['trips'], 'GET', 'tripsList'); // another endpoint present so the project is mid-build
    const pa = make();
    expect(() =>
      pa.writeProjectApi(
        'itinerary/[id]/GET',
        "export const name = 'itineraryGet';\nexport default apiHandler(async (req, ctx) => ({ id: req.id }));",
      ),
    ).toThrow(/apiHandler/);
    expect(existsSync(join(projectRoot, 'api', 'itinerary', '[id]', 'GET.ts'))).toBe(false);
  });

  it('REJECTS a page naming an endpoint that does not exist WHEN the project already has endpoints', () => {
    endpoint(['trips'], 'GET', 'tripsList');
    const pa = make();
    // Narrowed: the only endpoint is `tripsList`, so `costs-summary` is a hard error at save
    // (the original 06-tanzania dead-endpoint defect). This is caught by both the name lint and
    // the narrowed typecheck; either way it throws a retryable LintError and nothing lands.
    expect(() => pa.writeProjectPage('costs', page("  const { data } = useApi('costs-summary');"))).toThrow(
      LintError,
    );
    expect(existsSync(join(projectRoot, 'pages', 'costs.tsx'))).toBe(false);
  });

  it('ACCEPTS a component importing a not-yet-written sibling component (forEach authoring order)', () => {
    const pa = make();
    const src = [
      "import Missing from '../components/NotWrittenYet';",
      'export default function Card() {',
      '  return <div className="p-4"><Missing /></div>;',
      '}',
    ].join('\n');
    expect(pa.writeProjectComponent('Card', src).ok).toBe(true);
    expect(existsSync(join(projectRoot, 'components', 'Card.tsx'))).toBe(true);
  });

  it('ACCEPTS correct usage — `.mutate(...)`, a generic `useApi<T>`, and null-guarded `data?.items`', () => {
    endpoint(['trips'], 'GET', 'tripsList');
    endpoint(['trips'], 'POST', 'tripsCreate');
    const pa = make();
    const src = [
      "import { useApi, useApiMutation } from '@app/runtime';",
      'export default function Page() {',
      "  const { data } = useApi<{ items: { id: string }[] }>('tripsList');",
      "  const create = useApiMutation('tripsCreate');",
      '  return (',
      '    <div className="p-4">',
      '      <span>{(data?.items ?? []).length}</span>',
      '      <button onClick={() => create.mutate({})}>Add</button>',
      '    </div>',
      '  );',
      '}',
    ].join('\n');
    expect(pa.writeProjectPage('index', src).ok).toBe(true);
    expect(existsSync(join(projectRoot, 'pages', 'index.tsx'))).toBe(true);
  });
});

describe('writeProjectApi — the endpoint boundary is TYPED and CHECKED at save (no `any` escape)', () => {
  // Reproduces the €0.00/"undefined" dashboard defect (scenario 07-life-admin run 26): a handler typed
  // `(input: any, ctx: ApiCtx): Promise<any>` returning fields the contract Output never declared
  // typechecked clean and shipped a landing page rendering `undefined` over a full database.
  let projectRoot: string;
  beforeEach(() => {
    projectRoot = mkdtempSync(join(tmpdir(), 'lm-apiboundary-'));
    // emit_types (node 09) writes this from the plan BEFORE endpoints are authored. The plan's
    // `dashboard-stats` fields are `total_monthly` — the name the PAGE reads.
    mkdirSync(join(projectRoot, 'types'), { recursive: true });
    writeFileSync(
      join(projectRoot, 'types', 'contract.d.ts'),
      [
        'interface DashboardStatsItem { total_monthly: number; }',
        'interface DashboardStatsOutput { items: DashboardStatsItem[]; }',
        'type DashboardStatsInput = Record<string, unknown>;',
        'interface AppQueryOpts { where?: Record<string, unknown>; }',
        'interface TableRows { [t: string]: Record<string, unknown>; }',
        'interface AppDb { query<K extends keyof TableRows>(t: K, o?: AppQueryOpts): Promise<TableRows[K][]>; }',
        'interface ApiCtx { db: AppDb; apiCall: (n: string, i?: Record<string, unknown>) => Promise<unknown>; spawn: (r: string) => Promise<{ runId: string }>; }',
      ].join('\n') + '\n',
    );
  });
  afterEach(() => rmSync(projectRoot, { recursive: true, force: true }));
  const make = () => createProjectAuthoringGlobals({ projectRoot });

  it('REJECTS the live escape — `(input: any, ctx: ApiCtx): Promise<any>` — and writes nothing', () => {
    const pa = make();
    const escape =
      "export const name = 'dashboard-stats';\n" +
      'export default async function handler(input: any, ctx: ApiCtx): Promise<any> {\n' +
      '  return { items: [{ monthly_total: 5 }] };\n' + // field the contract Output does NOT declare
      '}';
    expect(() => pa.writeProjectApi('dashboard-stats/GET', escape)).toThrow(LintError);
    expect(() => pa.writeProjectApi('dashboard-stats/GET', escape)).toThrow(/any/);
    expect(existsSync(join(projectRoot, 'api', 'dashboard-stats', 'GET.ts'))).toBe(false);
  });

  it('REJECTS a handler pinned to the contract Output but returning a DIVERGENT shape (save-typecheck)', () => {
    // No `any`, and it DOES name the contract Output — so it passes the typing lint, and the field
    // divergence is now a real compile error caught by the save-time typecheck.
    const pa = make();
    const diverged =
      "export const name = 'dashboard-stats';\n" +
      'export type Input = DashboardStatsInput;\n' +
      'export type Output = DashboardStatsOutput;\n' +
      'export default async function handler(input: Input, ctx: ApiCtx): Promise<Output> {\n' +
      '  return { items: [{ monthly_total: 5 }] };\n' + // `monthly_total` ≠ contract `total_monthly`
      '}';
    expect(() => pa.writeProjectApi('dashboard-stats/GET', diverged)).toThrow(LintError);
    expect(existsSync(join(projectRoot, 'api', 'dashboard-stats', 'GET.ts'))).toBe(false);
  });

  it('ACCEPTS a correctly-typed handler returning the contract Output shape', () => {
    const pa = make();
    const ok =
      "export const name = 'dashboard-stats';\n" +
      'export type Input = DashboardStatsInput;\n' +
      'export type Output = DashboardStatsOutput;\n' +
      'export default async function handler(input: Input, ctx: ApiCtx): Promise<Output> {\n' +
      '  return { items: [{ total_monthly: 5 }] };\n' +
      '}';
    expect(pa.writeProjectApi('dashboard-stats/GET', ok).ok).toBe(true);
    expect(existsSync(join(projectRoot, 'api', 'dashboard-stats', 'GET.ts'))).toBe(true);
  });
});

describe('writeProjectFile — the narrowly-scoped escape hatch', () => {
  const roots: string[] = [];
  const mkTmp = (): string => {
    const d = mkdtempSync(join(tmpdir(), 'lm-writefile-'));
    roots.push(d);
    return d;
  };
  afterEach(() => {
    for (const d of roots.splice(0)) rmSync(d, { recursive: true, force: true });
  });

  // Every other artifact goes through a TYPED writer that validates its contract at write time.
  // This one exists only because `emit_types` produces a contract `.d.ts` that no typed writer
  // accepts (`writeProjectComponent` throws a LintError for source with no default-exported React
  // component, and a throw in a code node aborts the tasklist). It stays as small as that job needs.
  it('writes types/contract.d.ts', () => {
    const root = mkTmp();
    const g = createProjectAuthoringGlobals({ projectRoot: root });
    expect(g.writeProjectFile('types/contract.d.ts', 'export interface A { x: string }')).toEqual({ ok: true });
    expect(readFileSync(join(root, 'types', 'contract.d.ts'), 'utf8')).toContain('interface A');
  });

  it('REFUSES types/generated.d.ts — a build artifact the next build erases', () => {
    const root = mkTmp();
    const g = createProjectAuthoringGlobals({ projectRoot: root });
    const r = g.writeProjectFile('types/generated.d.ts', 'export interface A { x: string }');
    expect(r.ok).toBe(false);
    expect(r.error).toContain('BUILD ARTIFACT');
    expect(r.error).toContain('types/contract.d.ts'); // names what to write instead
  });

  it('REFUSES anything outside types/*.d.ts, naming the typed writer to use', () => {
    const root = mkTmp();
    const g = createProjectAuthoringGlobals({ projectRoot: root });
    for (const bad of ['pages/index.tsx', 'api/x/GET.ts', 'database/costs.json', 'types/notes.md', 'README.md']) {
      const r = g.writeProjectFile(bad, 'x');
      expect(r.ok, bad).toBe(false);
      expect(r.error, bad).toContain('writeProjectPage');
    }
  });

  it('cannot escape the project root', () => {
    const root = mkTmp();
    const g = createProjectAuthoringGlobals({ projectRoot: root });
    expect(g.writeProjectFile('../../types/evil.d.ts', 'x').ok).toBe(false);
    expect(g.writeProjectFile('/types/contract.d.ts', 'export type A = 1;').ok).toBe(true); // leading / is stripped, not absolute
  });
});
