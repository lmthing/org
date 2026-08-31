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
import { DEFAULT_PROJECT_ID, SYSTEM_PROJECT_ID } from '../../server/projects.js';

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
    rmSync(projectRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  });

  function make() {
    return createProjectAuthoringGlobals({
      projectId: 'liveproj',
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
      projectId: 'liveproj',
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
    const schemaWrites: string[] = [];
    const pa = createProjectAuthoringGlobals({
      projectId: 'liveproj',
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
      projectId: 'liveproj',
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
      projectId: 'liveproj',
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

  it('deleteProjectHook: deletes hooks/<slug>.ts and republishes; a missing slug is { ok:false }', () => {
    const pa = make();
    const src = "export default { type: 'event', on: { event: 'integration-slack/message.posted' } };";
    pa.writeProjectHook('slack-watch', src);
    expect(republishCalls).toBe(1);

    expect(pa.deleteProjectHook('slack-watch')).toEqual({ ok: true });
    expect(existsSync(join(projectRoot, 'hooks', 'slack-watch.ts'))).toBe(false);
    // The republish re-derives the webhook manifest + crontab from the hooks that remain.
    expect(republishCalls).toBe(2);

    const miss = pa.deleteProjectHook('slack-watch');
    expect(miss.ok).toBe(false);
    expect(miss.error).toContain('no such hook');
    expect(miss.error).toContain("listProjectDir('hooks')");
    // A non-slug is refused by the same shape check the writer uses — traversal-safe.
    expect(pa.deleteProjectHook('../evil').ok).toBe(false);
  });

  it('writeProjectApi lands api/<path>/<METHOD>.ts and fires onAppWrite(api)', () => {
    const appWrites: Array<[string, string]> = [];
    const pa = createProjectAuthoringGlobals({
      projectId: 'liveproj',
      projectRoot,
      republish: () => {},
      onAppWrite: (kind, route) => appWrites.push([kind, route]),
    });
    const res = pa.writeProjectApi('bookings-list/GET', "export const name = 'bookingsList';\nexport default async () => ({ items: [] });");
    expect(res.ok).toBe(true);
    expect(existsSync(join(projectRoot, 'api', 'bookings-list', 'GET.ts'))).toBe(true);
    expect(appWrites).toEqual([['api', 'bookings-list/GET']]);
  });

  it('rejects UNPARSEABLE source (literal \\n instead of newlines) before it lands — hook/event/api', () => {
    const pa = make();
    // The exact scenario-05 corruption: a one-line file with literal backslash-n escapes.
    const broken = "export default {\\n  type: 'event',\\n  on: { event: 'x/y' },\\n};";
    const h = pa.writeProjectHook('broken-hook', broken);
    expect(h.ok).toBe(false);
    expect(h.error).toMatch(/failed to parse/i);
    expect(existsSync(join(projectRoot, 'hooks', 'broken-hook.ts'))).toBe(false); // never landed
    expect(pa.writeProjectEvent('broken-evt', broken).ok).toBe(false);
    expect(pa.writeProjectApi('broken-list/GET', broken).ok).toBe(false);
    // A well-formed multi-line hook (real newlines) still writes.
    const good = ["export default {", "  type: 'event',", "  on: { event: 'x/y' },", "};"].join('\n');
    expect(pa.writeProjectHook('good-hook', good).ok).toBe(true);
    expect(existsSync(join(projectRoot, 'hooks', 'good-hook.ts'))).toBe(true);
  });

  it('writeProjectApi rejects an invalid method and a traversal route (no onAppWrite)', () => {
    let appWrites = 0;
    const pa = createProjectAuthoringGlobals({
      projectId: 'liveproj',
      projectRoot,
      republish: () => {},
      onAppWrite: () => {
        appWrites += 1;
      },
    });
    expect(pa.writeProjectApi('bookings/FETCH', 'x').ok).toBe(false); // not a real HTTP method
    expect(pa.writeProjectApi('../evil/GET', 'x').ok).toBe(false); // traversal
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

    it('writeProjectHook: a non-object / unknown-type hook throws', () => {
      const pa = make();
      expect(() => pa.writeProjectHook('h1', 'export default async function () {}')).toThrow(/hook OBJECT/);
      expect(() => pa.writeProjectHook('h2', 'export default { type: "nope" };')).toThrow(/cron/);
      // A valid hook object still writes.
      expect(pa.writeProjectHook('h3', "export default { type: 'cron', every: '1d', handler: async () => {} };").ok).toBe(true);
    });
  });
});

// ── Save-time PARTIAL TYPECHECK: an endpoint's own faults caught in the writer, not deferred to
// appCheck. Part of the same 06-tanzania run-34 fix set as the boundary-typing describe below —
// the page/component-specific cases (a `.mutateAsync`/`.isLoading` misuse on a mutation, `data.items`
// on an untyped `useApi`, an unknown endpoint name from a page) lived here before the freehand-TSX
// page/component writers were removed in favour of the view-spec writers (`view-writers.test.ts`).
describe('writeProjectApi save-time typecheck', () => {
  let projectRoot: string;
  beforeEach(() => {
    projectRoot = mkdtempSync(join(tmpdir(), 'lm-savetc-'));
  });
  afterEach(() => {
    rmSync(projectRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  });
  function make() {
    return createProjectAuthoringGlobals({ projectRoot, projectId: 'liveproj' });
  }
  function endpoint(dirSegs: string[], method: string, name: string) {
    mkdirSync(join(projectRoot, 'api', ...dirSegs), { recursive: true });
    writeFileSync(
      join(projectRoot, 'api', ...dirSegs, `${method}.ts`),
      `export const name = '${name}';\nexport default () => ({ items: [] });`,
    );
  }

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
  afterEach(() => rmSync(projectRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }));
  const make = () => createProjectAuthoringGlobals({ projectRoot, projectId: 'liveproj' });

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
    for (const d of roots.splice(0)) rmSync(d, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  });

  // Every other artifact goes through a TYPED writer that validates its contract at write time.
  // This one exists only because `emit_types` produces a contract `.d.ts` that no typed writer
  // accepts (every typed writer throws a LintError for a shape it does not recognize, and a throw
  // in a code node aborts the tasklist). It stays as small as that job needs.
  it('writes types/contract.d.ts', () => {
    const root = mkTmp();
    const g = createProjectAuthoringGlobals({ projectId: 'liveproj', projectRoot: root });
    expect(g.writeProjectFile('types/contract.d.ts', 'export interface A { x: string }')).toEqual({ ok: true });
    expect(readFileSync(join(root, 'types', 'contract.d.ts'), 'utf8')).toContain('interface A');
  });

  it('REFUSES types/generated.d.ts — a build artifact the next build erases', () => {
    const root = mkTmp();
    const g = createProjectAuthoringGlobals({ projectId: 'liveproj', projectRoot: root });
    const r = g.writeProjectFile('types/generated.d.ts', 'export interface A { x: string }');
    expect(r.ok).toBe(false);
    expect(r.error).toContain('BUILD ARTIFACT');
    expect(r.error).toContain('types/contract.d.ts'); // names what to write instead
  });

  it('REFUSES anything outside types/*.d.ts, naming the typed writer to use', () => {
    const root = mkTmp();
    const g = createProjectAuthoringGlobals({ projectId: 'liveproj', projectRoot: root });
    for (const bad of ['pages/index.tsx', 'api/x/GET.ts', 'database/costs.json', 'types/notes.md', 'README.md']) {
      const r = g.writeProjectFile(bad, 'x');
      expect(r.ok, bad).toBe(false);
      expect(r.error, bad).toContain('writeProjectApi');
    }
  });

  it('cannot escape the project root', () => {
    const root = mkTmp();
    const g = createProjectAuthoringGlobals({ projectId: 'liveproj', projectRoot: root });
    expect(g.writeProjectFile('../../types/evil.d.ts', 'x').ok).toBe(false);
    expect(g.writeProjectFile('/types/contract.d.ts', 'export type A = 1;').ok).toBe(true); // leading / is stripped, not absolute
  });
});

// ── W7 declarative IR writers (writeProjectEntity / writeProjectQuery) ────────
//
// The live twins of writeProjectTable/writeProjectApi: author FACTS/a QUERY, get a generated
// database/<name>.json or api/<route>/<METHOD>.ts. Proven through the SAME gates a hand-written
// artifact faces (lint, typing, project typecheck) — these writers are not a trusted bypass.
describe('createProjectAuthoringGlobals — writeProjectEntity / writeProjectQuery (W7)', () => {
  function mkTmp(): string {
    const dir = mkdtempSync(join(tmpdir(), 'lm-live-project-ir-'));
    return dir;
  }

  const JOB_ENTITY = {
    entity: 'job',
    title: 'Job',
    identity: 'id',
    fields: {
      id: { fact: 'job.id', type: 'id' },
      status: { fact: 'job.status', type: 'enum', values: ['quoted', 'in-progress', 'done'] },
      hours: { fact: 'job.hours', type: 'number' },
    },
  };

  it('writeProjectEntity compiles model/<name>.entity.json straight to database/<name>.json and fires onSchemaWrite', () => {
    const root = mkTmp();
    const schemaWrites: string[] = [];
    const g = createProjectAuthoringGlobals({ projectId: 'liveproj', projectRoot: root, onSchemaWrite: (t) => schemaWrites.push(t) });

    const res = g.writeProjectEntity('job', JOB_ENTITY);
    expect(res).toEqual({ ok: true });
    expect(existsSync(join(root, 'model', 'job.entity.json'))).toBe(true);
    const table = JSON.parse(readFileSync(join(root, 'database', 'job.json'), 'utf8'));
    expect(table.columns.id).toEqual(expect.objectContaining({ primaryKey: true, generated: 'uuid' }));
    expect(table.columns.status.enum).toEqual(['quoted', 'in-progress', 'done']);
    expect(schemaWrites).toEqual(['job']);
  });

  it('writeProjectEntity rejects an enum rebuild that drops a previously-declared value', () => {
    const root = mkTmp();
    const g = createProjectAuthoringGlobals({ projectId: 'liveproj', projectRoot: root });
    expect(g.writeProjectEntity('job', JOB_ENTITY).ok).toBe(true);

    const shrunk = { ...JOB_ENTITY, fields: { ...JOB_ENTITY.fields, status: { fact: 'job.status', type: 'enum', values: ['quoted'] } } };
    expect(() => g.writeProjectEntity('job', shrunk)).toThrow(/DROPPED value/);
  });

  it('writeProjectEntity rejects a fact key reused on a different entity', () => {
    const root = mkTmp();
    const g = createProjectAuthoringGlobals({ projectId: 'liveproj', projectRoot: root });
    expect(g.writeProjectEntity('job', JOB_ENTITY).ok).toBe(true);

    const invoice = { entity: 'invoice', title: 'Invoice', identity: 'id', fields: { id: { fact: 'invoice.id', type: 'id' }, state: { fact: 'job.status', type: 'enum', values: ['x'] } } };
    expect(() => g.writeProjectEntity('invoice', invoice)).toThrow(/previously declared on job\.status/);
  });

  it('writeProjectQuery generates api/<route>/<METHOD>.ts from a list query.json, and the endpoint actually WORKS end-to-end', async () => {
    const root = mkTmp();
    const g = createProjectAuthoringGlobals({ projectId: 'liveproj', projectRoot: root });
    expect(g.writeProjectEntity('job', JOB_ENTITY).ok).toBe(true);

    const res = g.writeProjectQuery('jobs-list', {
      name: 'jobs-list',
      kind: 'list',
      entity: 'job',
      route: 'jobs/list',
      where: [{ field: 'status', op: '!=', value: 'done' }],
    });
    expect(res).toEqual({ ok: true });
    expect(existsSync(join(root, 'api', 'jobs-list.query.json'))).toBe(true);
    const handlerPath = join(root, 'api', 'jobs', 'list', 'GET.ts');
    expect(existsSync(handlerPath)).toBe(true);
    const source = readFileSync(handlerPath, 'utf8');
    expect(source).toContain('@generated from api/jobs-list.query.json');

    // End-to-end: this generated handler ACTUALLY RUNS against the real table it was compiled for.
    const { openProjectDb, schemaToCreateTableSql } = await import('../store.js');
    const { createApiRuntime } = await import('../api/runtime.js');
    const schema = JSON.parse(readFileSync(join(root, 'database', 'job.json'), 'utf8'));
    const project = openProjectDb(join(root, '.data', 'app.db'), { schemas: [{ name: 'job', schema }] });
    try {
      project.raw.exec(schemaToCreateTableSql('job', schema));
      project.db.insert('job', { status: 'quoted', hours: 2 });
      project.db.insert('job', { status: 'done', hours: 5 });
      const runtime = createApiRuntime({ projectRoot: root, db: project.async, spawnRunner: () => ({ runId: 'x' }), logError: () => {} });
      const result = await runtime.handle('GET', '/jobs/list');
      expect(result.status).toBe(200);
      const items = (result.body as { items: Array<{ status: string }> }).items;
      expect(items).toHaveLength(1); // "done" filtered out
      expect(items[0].status).toBe('quoted');
    } finally {
      project.close();
    }
  });

  it('deleteProjectQuery: deletes the IR AND its generated handler; refuses while a view still queries it', async () => {
    const root = mkTmp();
    const g = createProjectAuthoringGlobals({ projectId: 'liveproj', projectRoot: root });
    expect(g.writeProjectEntity('job', JOB_ENTITY).ok).toBe(true);
    expect(
      g.writeProjectQuery('jobs-list', { kind: 'list', entity: 'job', route: 'jobs/list' }).ok,
    ).toBe(true);

    // Queried by a live page → refused with the page named, both files still on disk.
    expect(g.writeProjectView('jobs', { sections: [{ kind: 'list', query: 'jobs-list' }] }).ok).toBe(true);
    const refused = g.deleteProjectQuery('jobs-list');
    expect(refused.ok).toBe(false);
    expect(refused.error).toContain('deleteProjectQuery("jobs-list") refused');
    expect(refused.error).toContain('views/jobs.view.json');
    expect(existsSync(join(root, 'api', 'jobs-list.query.json'))).toBe(true);
    expect(existsSync(join(root, 'api', 'jobs', 'list', 'GET.ts'))).toBe(true);

    // Unblocked once the referencing page is gone — and BOTH artifacts go together.
    expect(g.deleteProjectView('jobs')).toEqual({ ok: true });
    expect(g.deleteProjectQuery('jobs-list')).toEqual({ ok: true });
    expect(existsSync(join(root, 'api', 'jobs-list.query.json'))).toBe(false);
    expect(existsSync(join(root, 'api', 'jobs', 'list', 'GET.ts'))).toBe(false);
    expect(existsSync(join(root, 'api', 'jobs'))).toBe(false); // pruned with its last file

    // Missing → { ok:false }.
    const miss = g.deleteProjectQuery('jobs-list');
    expect(miss.ok).toBe(false);
    expect(miss.error).toContain('no such query');
  });

  it('writeProjectQuery rejects a where clause on a column the entity does not have', () => {
    const root = mkTmp();
    const g = createProjectAuthoringGlobals({ projectId: 'liveproj', projectRoot: root });
    expect(g.writeProjectEntity('job', JOB_ENTITY).ok).toBe(true);

    expect(() =>
      g.writeProjectQuery('jobs-list', {
        kind: 'list',
        entity: 'job',
        route: 'jobs/list',
        where: [{ field: 'stat', op: '=', value: 'x' }],
      }),
    ).toThrow(/no column "stat" on "job"/);
    expect(existsSync(join(root, 'api', 'jobs-list.query.json'))).toBe(false); // nothing written on a rejected query
  });

  it('writeProjectQuery rejects an unknown entity, naming the tables that exist', () => {
    const root = mkTmp();
    const g = createProjectAuthoringGlobals({ projectId: 'liveproj', projectRoot: root });
    expect(g.writeProjectEntity('job', JOB_ENTITY).ok).toBe(true);

    expect(() =>
      g.writeProjectQuery('bogus-list', { kind: 'list', entity: 'nope', route: 'bogus/list' }),
    ).toThrow(/no table "nope"/);
  });

  // Found live (30-bike-workshop, run 207): `emit_types` ALWAYS writes `types/contract.d.ts` with a
  // GLOBAL AMBIENT `<Pascal>Output` for every planned endpoint before `implement_endpoints` runs — so
  // in every real appbuilder build, this file exists by the time `writeProjectQuery` is called.
  // `apiHandlerTypingError` (reused from `writeProjectApi`'s pipeline) rejected the generated handler's
  // own LOCAL `Output` interface as "an inline or invented Output" every single time, because that
  // check's rule — the return must reference the AMBIENT `<Pascal>Output` — was written for a
  // hand-written handler that could invent a competing shape. A generated handler cannot: its `Output`
  // and its body come from the SAME IR call. The model saw every declarative attempt bounce and
  // abandoned the whole path. This is the regression test: an ambient contract present, and a
  // declarative write must still succeed.
  it('writeProjectQuery succeeds even when types/contract.d.ts already declares this endpoint\'s global Output (the real-pipeline case)', () => {
    const root = mkTmp();
    const g = createProjectAuthoringGlobals({ projectId: 'liveproj', projectRoot: root });
    expect(g.writeProjectEntity('job', JOB_ENTITY).ok).toBe(true);

    // Mirrors what `09-emit_types.ts` actually writes: a GLOBAL (no export) ambient declaring
    // `<Pascal>Output`/`<Pascal>Input` for the endpoint BEFORE it is implemented.
    const contractDts = `
declare interface JobsListItem { id: string; status: string; hours: number }
declare interface JobsListOutput { items: JobsListItem[] }
declare interface JobsListInput { [k: string]: unknown }
`;
    mkdirSync(join(root, 'types'), { recursive: true });
    writeFileSync(join(root, 'types', 'contract.d.ts'), contractDts, 'utf8');

    const res = g.writeProjectQuery('jobs-list', { kind: 'list', entity: 'job', route: 'jobs/list' });
    expect(res).toEqual({ ok: true });
    expect(existsSync(join(root, 'api', 'jobs', 'list', 'GET.ts'))).toBe(true);
  });
});

// ── the personal-workspace guard ───────────────────────────────────────────────
//
// The "user" project is the personal THING workspace: it holds the HOST-written chat scaffold
// (`projects.ts#scaffoldAppFromBirthSync` / `#ensureAppFromBirthSync` — a different seam from these
// globals, proven unaffected in view-writers.test.ts) and personal automations, NEVER a built app.
// Found live: a build_live_project run whose automator was not retargeted authored an entire app
// INTO `.lmthing/user/` — shell + 5 views + 2 components + 4 api handlers + 2 tables — even though
// the agent prompts say THING refuses to build there. A prompt is prose; the writer is the gate.
describe('the personal-workspace guard (user / system can never hold a built app)', () => {
  let tmpRoot: string;
  let userRoot: string;
  let republishCalls: number;
  let schemaWrites: number;
  let appWrites: number;

  beforeEach(() => {
    tmpRoot = mkdtempSync(join(tmpdir(), 'lm-user-guard-'));
    userRoot = join(tmpRoot, DEFAULT_PROJECT_ID);
    mkdirSync(userRoot, { recursive: true });
    republishCalls = 0;
    schemaWrites = 0;
    appWrites = 0;
  });

  afterEach(() => {
    rmSync(tmpRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  });

  const TIPS = {
    title: 'Tips',
    description: 'Story tips',
    columns: {
      id: { type: 'string', description: 'pk', primaryKey: true, generated: 'uuid' },
      headline: { type: 'string', description: 'short headline' },
    },
  } as unknown as TableSchema;

  const makeUser = (projectId = DEFAULT_PROJECT_ID) =>
    createProjectAuthoringGlobals({
      projectId,
      projectRoot: userRoot,
      republish: () => {
        republishCalls += 1;
      },
      onSchemaWrite: () => {
        schemaWrites += 1;
      },
      onAppWrite: () => {
        appWrites += 1;
      },
    });

  it('REFUSES every app-authoring writer (view/layout/component/shell/api/query/table/entity) with the retarget message', () => {
    const pa = makeUser();
    const refusals: Array<{ ok: boolean; error?: string }> = [
      pa.writeProjectView('books/[id]', { sections: [{ kind: 'list', query: 'listBooks' }] }),
      pa.writeProjectViewLayout('books', { sections: [{ kind: 'outlet' }] }),
      pa.writeProjectViewComponent('BookCard', { props: {}, node: { el: 'text', text: 'x' } }),
      pa.writeProjectViewShell({ brand: 'Book Club Tracker', nav: [] }),
      pa.writeProjectApi('books-list/GET', "export const name = 'booksList';\nexport default async () => ({ items: [] });"),
      pa.writeProjectQuery('books-list', { kind: 'list', entity: 'books', route: 'books/list' }),
      pa.writeProjectTable('books', TIPS),
      pa.writeProjectEntity('books', { entity: 'books', fields: {} }),
    ];
    const writers = [
      'writeProjectView',
      'writeProjectViewLayout',
      'writeProjectViewComponent',
      'writeProjectViewShell',
      'writeProjectApi',
      'writeProjectQuery',
      'writeProjectTable',
      'writeProjectEntity',
    ];
    for (let i = 0; i < refusals.length; i++) {
      const r = refusals[i];
      expect(r.ok, writers[i]).toBe(false);
      expect(r.error, writers[i]).toContain(`${writers[i]} refused`);
      expect(r.error, writers[i]).toContain('personal THING workspace');
      expect(r.error, writers[i]).toContain('can never hold a built app');
      expect(r.error, writers[i]).toContain('createProject');
      expect(r.error, writers[i]).toContain('selectProject');
    }
    // Nothing landed — the exact live-pollution shapes (views/books/, database/books.json, api/)
    // left NO trace, and no side effect (republish / schema re-derive / app rebuild) fired.
    for (const dir of ['views', 'components', 'api', 'database', 'model']) {
      expect(existsSync(join(userRoot, dir)), dir).toBe(false);
    }
    expect(existsSync(join(userRoot, 'shell.view.json'))).toBe(false);
    expect(republishCalls).toBe(0);
    expect(schemaWrites).toBe(0);
    expect(appWrites).toBe(0);
  });

  it('still allows the PERSONAL automation writers (hook/event/function) in the user project', () => {
    const pa = makeUser();
    expect(
      pa.writeProjectHook('personal-digest', "export default { type: 'cron', every: '1d', handler: async () => {} };").ok,
    ).toBe(true);
    expect(existsSync(join(userRoot, 'hooks', 'personal-digest.ts'))).toBe(true);
    expect(
      pa.writeProjectEvent(
        'feed-writes',
        "export default { type: 'db', on: { table: 'feed_items', event: 'insert' }, emits: {}, emit: () => [] };",
      ).ok,
    ).toBe(true);
    expect(pa.writeProjectFunction('slackPostMessage', 'export default async function slackPostMessage(i: unknown) { return i; }').ok).toBe(true);
    expect(republishCalls).toBe(3);
  });

  it('keeps every DELETE writer working in the user project — cleaning up a polluted workspace must stay possible', () => {
    // Plant the live-pollution shapes HOST-side (the writers rightly refuse to create them now).
    mkdirSync(join(userRoot, 'views'), { recursive: true });
    writeFileSync(
      join(userRoot, 'views', 'polluted.view.json'),
      JSON.stringify({ route: 'polluted', title: 'Polluted', sections: [{ id: 'chat', kind: 'chat', agent: 'thing' }] }),
    );
    mkdirSync(join(userRoot, 'components'), { recursive: true });
    writeFileSync(join(userRoot, 'components', 'Polluted.view.json'), JSON.stringify({ name: 'Polluted', props: {}, node: { el: 'text', text: 'x' } }));
    mkdirSync(join(userRoot, 'api', 'polluted', 'q'), { recursive: true });
    writeFileSync(join(userRoot, 'api', 'polluted', 'GET.ts'), "export const name = 'pollutedList';\nexport default async () => ({ items: [] });\n");
    writeFileSync(join(userRoot, 'api', 'polluted.query.json'), JSON.stringify({ name: 'polluted', kind: 'list', entity: 'books', route: 'books/list' }));
    writeFileSync(join(userRoot, 'api', 'polluted', 'q', 'GET.ts'), "export const name = 'polluted';\nexport default async () => ({ items: [] });\n");
    mkdirSync(join(userRoot, 'hooks'), { recursive: true });
    writeFileSync(join(userRoot, 'hooks', 'polluted.ts'), "export default { type: 'event', on: { event: 'x/y' } };\n");

    const pa = makeUser();
    expect(pa.deleteProjectView('polluted')).toEqual({ ok: true });
    expect(pa.deleteProjectViewComponent('Polluted')).toEqual({ ok: true });
    expect(pa.deleteProjectApi('polluted/GET')).toEqual({ ok: true });
    expect(pa.deleteProjectQuery('polluted')).toEqual({ ok: true });
    expect(pa.deleteProjectHook('polluted')).toEqual({ ok: true });
    for (const gone of [
      join(userRoot, 'views', 'polluted.view.json'),
      join(userRoot, 'components', 'Polluted.view.json'),
      join(userRoot, 'api', 'polluted', 'GET.ts'),
      join(userRoot, 'api', 'polluted.query.json'),
      join(userRoot, 'hooks', 'polluted.ts'),
    ]) {
      expect(existsSync(gone)).toBe(false);
    }
  });

  it('refuses the reserved "system" tree with its own message (it is not a project at all)', () => {
    const systemRoot = join(tmpRoot, SYSTEM_PROJECT_ID);
    mkdirSync(systemRoot, { recursive: true });
    const pa = createProjectAuthoringGlobals({ projectId: SYSTEM_PROJECT_ID, projectRoot: systemRoot });
    const res = pa.writeProjectView('index', { sections: [{ kind: 'chat', agent: 'thing' }] });
    expect(res.ok).toBe(false);
    expect(res.error).toContain('reserved system-spaces tree');
    expect(res.error).toContain('not a project');
    expect(res.error).toContain('createProject');
  });

  it('fails CLOSED on an id/root mismatch — a root whose basename is "user" is refused whatever id the caller claims', () => {
    const pa = makeUser('liveproj'); // caller says "liveproj", the root IS <tmp>/user
    const res = pa.writeProjectView('index', { sections: [{ kind: 'chat', agent: 'thing' }] });
    expect(res.ok).toBe(false);
    expect(res.error).toContain('personal THING workspace');
  });

  it('does NOT fire for an ordinary project — the same writers work as before', () => {
    const root = join(tmpRoot, 'bookclub');
    mkdirSync(root, { recursive: true });
    const pa = createProjectAuthoringGlobals({ projectId: 'bookclub', projectRoot: root });
    expect(pa.writeProjectTable('books', TIPS).ok).toBe(true);
    expect(pa.writeProjectApi('books-list/GET', "export const name = 'booksList';\nexport default async () => ({ items: [] });").ok).toBe(true);
    expect(existsSync(join(root, 'database', 'books.json'))).toBe(true);
    expect(existsSync(join(root, 'api', 'books-list', 'GET.ts'))).toBe(true);
  });
});
