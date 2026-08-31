/**
 * The VIEW-SPEC writers — `writeProjectView`, `writeProjectViewComponent`,
 * `writeProjectViewShell` ({@link ./globals.ts}).
 *
 * Three things are being proven here, in order of how much they matter:
 *
 *  1. **a rejection reaches the model as a retryable throw**, exactly as `writeProjectApi`'s
 *     lint does — a `{ ok:false }` a tasklist node can ignore is not a gate;
 *  2. **nothing lands on a rejection** — a half-validated spec on disk is worse than no spec,
 *     because the next gate reads it as intentional;
 *  3. **only spec data is written** — the prebuilt AppHost reads views/components/shell at runtime,
 *     so no generated TSX page can shadow or stale the authored JSON.
 */

import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createProjectAuthoringGlobals } from './globals.js';
import { LintError } from './lint.js';
import { validateAppViews } from '../view-spec/validate.js';
import { DEFAULT_PROJECT_ID, ensureAppFromBirthSync, scaffoldAppFromBirthSync } from '../../server/projects.js';

describe('view-spec writers', () => {
  let projectRoot: string;
  let appWrites: { kind: string; route: string }[];

  beforeEach(() => {
    projectRoot = mkdtempSync(join(tmpdir(), 'lm-view-writers-'));
    appWrites = [];
    // One GET and one POST, so name resolution has a real menu to reject against.
    mkdirSync(join(projectRoot, 'api', 'recipes'), { recursive: true });
    writeFileSync(
      join(projectRoot, 'api', 'recipes', 'GET.ts'),
      `export const name = 'listRecipes';
export interface Output { items: { id: string; title: string; minutes: number }[]; }
export default async function handler() { return { items: [] }; }
`,
    );
    writeFileSync(
      join(projectRoot, 'api', 'recipes', 'POST.ts'),
      `export const name = 'addRecipe';
export interface Input { title: string; }
export interface Output { id: string; }
export default async function handler() { return { id: '1' }; }
`,
    );
  });

  afterEach(() => {
    rmSync(projectRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  });

  const make = () =>
    createProjectAuthoringGlobals({
      projectId: 'liveproj',
      projectRoot,
      onAppWrite: (kind, route) => appWrites.push({ kind, route }),
    });

  const read = (...rel: string[]) => readFileSync(join(projectRoot, ...rel), 'utf8');

  // ── writeProjectView ───────────────────────────────────────────────────────

  it('persists only the normalized spec and fires onAppWrite', () => {
    const pa = make();
    const res = pa.writeProjectView('recipes', {
      title: 'Recipes',
      sections: [{ kind: 'list', query: 'listRecipes', item: { title: '$.title' } }],
    });
    expect(res).toEqual({ ok: true });

    const spec = JSON.parse(read('views', 'recipes.view.json'));
    expect(spec.route).toBe('recipes');
    expect(spec.sections[0].query).toBe('listRecipes');
    expect(existsSync(join(projectRoot, 'pages', 'recipes.tsx'))).toBe(false);
    expect(appWrites).toEqual([{ kind: 'page', route: 'recipes' }]);
  });

  it('writes a nested route into nested view dirs without a TSX page', () => {
    const pa = make();
    expect(pa.writeProjectView('recipes/[id]', { sections: [{ kind: 'detail', query: 'listRecipes' }] }).ok).toBe(true);
    expect(existsSync(join(projectRoot, 'views', 'recipes', '[id].view.json'))).toBe(true);
    expect(existsSync(join(projectRoot, 'pages', 'recipes', '[id].tsx'))).toBe(false);
  });

  it('THROWS a LintError with the menu-shaped message on a bad endpoint name — and writes nothing', () => {
    const pa = make();
    expect(() =>
      pa.writeProjectView('recipes', { sections: [{ kind: 'create', mutation: 'addRecipies' }] }),
    ).toThrow(LintError);
    try {
      pa.writeProjectView('recipes', { sections: [{ kind: 'create', mutation: 'addRecipies' }] });
    } catch (e) {
      expect((e as Error).message).toBe(
        'sections[0].mutation: "addRecipies" is not an endpoint. Did you mean addRecipe? Mutations: addRecipe',
      );
    }
    expect(existsSync(join(projectRoot, 'views', 'recipes.view.json'))).toBe(false);
    expect(existsSync(join(projectRoot, 'pages', 'recipes.tsx'))).toBe(false);
    expect(appWrites).toEqual([]);
  });

  it('rejects a $.field the endpoint does not declare', () => {
    const pa = make();
    expect(() =>
      pa.writeProjectView('recipes', {
        sections: [{ kind: 'list', query: 'listRecipes', item: { title: '$.titel' } }],
      }),
    ).toThrow(/is not a field of listRecipes's Output. Did you mean \$\.title\?/);
  });

  it('rejects an expression with the no-expressions advice', () => {
    const pa = make();
    expect(() =>
      pa.writeProjectView('recipes', {
        sections: [{ kind: 'list', query: 'listRecipes', item: { title: '$.minutes / 60' } }],
      }),
    ).toThrow(/the spec language has no expressions, on purpose/);
  });

  it('rejects a component reference before the component exists', () => {
    const pa = make();
    expect(() =>
      pa.writeProjectView('recipes', {
        sections: [{ kind: 'list', query: 'listRecipes', item: { use: 'RecipeCard' } }],
      }),
    ).toThrow(/"RecipeCard" is not a view component/);
  });

  it('rejects a route argument that is not a route, without throwing a lint error', () => {
    const pa = make();
    const res = pa.writeProjectView('Recipes/Index', { sections: [{ kind: 'list', query: 'listRecipes' }] });
    expect(res.ok).toBe(false);
    expect(res.error).toContain('is not a valid route');
  });

  it('rejects a spec whose own `route` disagrees with the argument', () => {
    const pa = make();
    const res = pa.writeProjectView('recipes', {
      route: 'index',
      sections: [{ kind: 'list', query: 'listRecipes' }],
    });
    expect(res.ok).toBe(false);
    expect(res.error).toContain("the spec declares route \"index\"");
  });

  it('does not let a legacy TSX page block a spec at the same route', () => {
    mkdirSync(join(projectRoot, 'pages'), { recursive: true });
    writeFileSync(join(projectRoot, 'pages', 'recipes.tsx'), 'export default () => <div />;\n');
    const pa = make();
    expect(pa.writeProjectView('recipes', { sections: [{ kind: 'list', query: 'listRecipes' }] })).toEqual({ ok: true });
    expect(existsSync(join(projectRoot, 'views', 'recipes.view.json'))).toBe(true);
  });

  // ── writeProjectViewLayout ─────────────────────────────────────────────────

  it('writes a nested layout beside its child spec without a generated page', () => {
    const pa = make();
    expect(
      pa.writeProjectViewLayout('recipes', {
        sections: [
          { kind: 'toolbar', actions: [{ label: 'All', action: { navigate: 'recipes' } }] },
          { kind: 'outlet' },
        ],
      }),
    ).toEqual({ ok: true });
    expect(existsSync(join(projectRoot, 'views', 'recipes', '_layout.view.json'))).toBe(true);
    expect(pa.writeProjectView('recipes/[id]', { sections: [{ kind: 'list', query: 'listRecipes' }] })).toEqual({ ok: true });
    expect(existsSync(join(projectRoot, 'pages', 'recipes', '[id].tsx'))).toBe(false);
  });

  it('refuses a layout with no outlet — it would swallow every child route', () => {
    const pa = make();
    expect(() => pa.writeProjectViewLayout('recipes', { sections: [{ kind: 'toolbar' }] })).toThrow(
      /exactly one \{ kind: 'outlet' \} section/,
    );
  });

  it('refuses an outlet on a PAGE, and says where the spec belongs', () => {
    const pa = make();
    expect(() =>
      pa.writeProjectView('recipes', { sections: [{ kind: 'detail', query: 'getRecipe' }, { kind: 'outlet' }] }),
    ).toThrow(/writeProjectViewLayout/);
  });

  // ── writeProjectViewComponent ──────────────────────────────────────────────

  it('writes a component beside the views and makes it referenceable', () => {
    const pa = make();
    expect(
      pa.writeProjectViewComponent('RecipeCard', {
        props: { title: 'string' },
        node: { el: 'text', text: '$props.title' },
      }),
    ).toEqual({ ok: true });
    expect(existsSync(join(projectRoot, 'components', 'RecipeCard.view.json'))).toBe(true);

    // The view that references it now validates.
    expect(
      pa.writeProjectView('recipes', {
        sections: [{ kind: 'list', query: 'listRecipes', item: { use: 'RecipeCard', props: { title: '$.title' } } }],
      }).ok,
    ).toBe(true);
  });

  it('rejects a component that binds a prop it did not declare', () => {
    const pa = make();
    expect(() =>
      pa.writeProjectViewComponent('RecipeCard', { props: { title: 'string' }, node: { el: 'text', text: '$props.name' } }),
    // No "did you mean": `name` is four edits from `title`, which is a guess, not a suggestion.
    // The MENU is what does the work here.
    ).toThrow(/"name" is not a prop of this component. Props: title/);
  });

  it('rejects a non-PascalCase component name', () => {
    const pa = make();
    const res = pa.writeProjectViewComponent('recipeCard', { node: { el: 'text', text: 'hi' } });
    expect(res.ok).toBe(false);
    expect(res.error).toContain('is not PascalCase');
  });

  it('updates a component independently because AppHost fetches it with the page spec', () => {
    const pa = make();
    pa.writeProjectViewComponent('RecipeCard', { props: { title: 'string' }, node: { el: 'text', text: '$props.title' } });
    pa.writeProjectView('recipes', {
      sections: [{ kind: 'list', query: 'listRecipes', item: { use: 'RecipeCard', props: { title: '$.title' } } }],
    });
    pa.writeProjectViewComponent('RecipeCard', {
      props: { title: 'string' },
      node: { el: 'heading', text: '$props.title' },
    });
    expect(read('components', 'RecipeCard.view.json')).toContain('"el": "heading"');
    expect(existsSync(join(projectRoot, 'pages', 'recipes.tsx'))).toBe(false);
  });

  // ── writeProjectViewShell ──────────────────────────────────────────────────

  it('writes the shell independently of page artifacts', () => {
    const pa = make();
    pa.writeProjectView('recipes', { sections: [{ kind: 'list', query: 'listRecipes' }] });
    expect(pa.writeProjectViewShell({ brand: 'Kitchen', nav: [{ route: 'recipes', label: 'Recipes' }] })).toEqual({
      ok: true,
    });
    expect(read('shell.view.json')).toContain('"brand": "Kitchen"');
    expect(existsSync(join(projectRoot, 'pages', 'recipes.tsx'))).toBe(false);
  });

  it('lets a shell nav target that is not YET a route through, and says so', async () => {
    // WAVE-2 (T1). A hard failure here is unsatisfiable: `recipes` links to `recipes/[id]` and
    // `recipes/[id]` links back, so whichever is written first names a route that does not exist —
    // NO write order satisfies both, and T1 needed a throwaway 13-write bootstrap pass to get past
    // it. Save time therefore warns; the check itself is not lost, only deferred (below).
    const pa = make();
    pa.writeProjectView('recipes', { sections: [{ kind: 'list', query: 'listRecipes' }] });
    expect(pa.writeProjectViewShell({ nav: [{ route: 'recipies' }] })).toEqual({ ok: true });
  });

  it('and validateAppViews still fails it — the deferred half is the one that ships', async () => {
    const pa = make();
    pa.writeProjectView('recipes', { sections: [{ kind: 'list', query: 'listRecipes' }] });
    pa.writeProjectViewShell({ nav: [{ route: 'recipies' }] });
    const res = await validateAppViews(projectRoot, { contracts: { endpoints: [] } as never });
    const bad = res.errors.find((e) => e.code === 'unknown-route');
    expect(bad?.severity).toBe('error');
    expect(bad?.message).toContain('"recipies" is not a route in this app. Did you mean recipes?');
    expect(res.ok).toBe(false);
  });

  it('does not put the shell or the components dir on a route', () => {
    // `_`-prefixed basenames and a `components/` dir under pages/ are both skipped by `walkPages`,
    // which is why these two paths were chosen. A regression here silently adds two dead routes.
    const pa = make();
    pa.writeProjectViewComponent('RecipeCard', { node: { el: 'text', text: 'hi' } });
    pa.writeProjectViewShell({ nav: [] });
    expect(existsSync(join(projectRoot, 'pages', 'components', 'RecipeCard.tsx'))).toBe(false);
    expect(existsSync(join(projectRoot, 'pages', '_shell.tsx'))).toBe(false);
  });

  // ── the host-side gates ────────────────────────────────────────────────────

  it('exposes the app-wide and render-smoke gates for a tasklist code node', async () => {
    const pa = make();
    pa.writeProjectView('index', { sections: [{ kind: 'list', query: 'listRecipes' }] });

    const appWide = await pa.validateAppViews();
    expect(appWide).toMatchObject({ ok: true, checked: 1 });

    // No `callProjectApi` was supplied ⇒ the smoke gate reports UNAVAILABLE, never "clean".
    const smoke = await pa.renderSmokeViews();
    expect(smoke.unavailable).toBe(true);
    expect(smoke.checked).toBe(0);
  });

  // ── the delete twins (deleteProjectView / …Component / …Layout / …Api) ──────────
  //
  // Three things proven per kind, mirroring the writers above: the happy delete lands and fires
  // the app-write side effect; a MISSING artifact is { ok:false } (never a silent success, never
  // a throw); and the guard — a delete that would leave the app referencing a ghost is refused
  // with the referencing FILE named, and nothing leaves disk on a refusal (validate-then-delete).

  it('deleteProjectView: deletes an unreferenced page, prunes its empty dir, and fires onAppWrite', () => {
    const pa = make();
    pa.writeProjectView('recipes/[id]', { sections: [{ kind: 'list', query: 'listRecipes' }] });
    appWrites.length = 0;

    expect(pa.deleteProjectView('recipes/[id]')).toEqual({ ok: true });
    expect(existsSync(join(projectRoot, 'views', 'recipes', '[id].view.json'))).toBe(false);
    // The now-empty views/recipes/ dir went with it (views/ itself stays).
    expect(existsSync(join(projectRoot, 'views', 'recipes'))).toBe(false);
    expect(existsSync(join(projectRoot, 'views'))).toBe(true);
    expect(appWrites).toEqual([{ kind: 'page', route: 'recipes/[id]' }]);
  });

  it('deleteProjectView: a missing route is { ok:false } with the real list hinted, never a throw', () => {
    const pa = make();
    const res = pa.deleteProjectView('nope');
    expect(res.ok).toBe(false);
    expect(res.error).toContain('no such view');
    expect(res.error).toContain("listProjectDir('views')");
  });

  it('deleteProjectView: REFUSED while the shell nav still points at the route — names shell.view.json, nothing leaves disk', () => {
    const pa = make();
    pa.writeProjectView('recipes', { sections: [{ kind: 'list', query: 'listRecipes' }] });
    pa.writeProjectViewShell({ nav: [{ route: 'recipes', label: 'Recipes' }] });

    const res = pa.deleteProjectView('recipes');
    expect(res.ok).toBe(false);
    expect(res.error).toContain('deleteProjectView("recipes") refused');
    expect(res.error).toContain('shell.view.json');
    // The guarded state never touched disk.
    expect(existsSync(join(projectRoot, 'views', 'recipes.view.json'))).toBe(true);

    // Repoint the shell first — now the same delete lands.
    pa.writeProjectViewShell({ nav: [] });
    expect(pa.deleteProjectView('recipes')).toEqual({ ok: true });
    expect(existsSync(join(projectRoot, 'views', 'recipes.view.json'))).toBe(false);
  });

  it('deleteProjectView: deleting the LAST page is allowed — a rebuild is mid-flight, not broken', () => {
    const pa = make();
    pa.writeProjectView('recipes', { sections: [{ kind: 'list', query: 'listRecipes' }] });
    expect(pa.deleteProjectView('recipes')).toEqual({ ok: true });
    expect(existsSync(join(projectRoot, 'views'))).toBe(true);
  });

  it('deleteProjectViewComponent: deletes an unused component; a referenced one is REFUSED with the view named', () => {
    const pa = make();
    pa.writeProjectViewComponent('RecipeCard', {
      props: { title: 'string' },
      node: { el: 'text', text: '$props.title' },
    });
    // Unused → deletes (a dead component is a warning, not a fault).
    expect(pa.deleteProjectViewComponent('RecipeCard')).toEqual({ ok: true });
    expect(existsSync(join(projectRoot, 'components', 'RecipeCard.view.json'))).toBe(false);

    // Missing → { ok:false }.
    expect(pa.deleteProjectViewComponent('RecipeCard').ok).toBe(false);

    // Referenced → refused, view named, disk untouched.
    pa.writeProjectViewComponent('RecipeCard', {
      props: { title: 'string' },
      node: { el: 'text', text: '$props.title' },
    });
    pa.writeProjectView('recipes', {
      sections: [{ kind: 'list', query: 'listRecipes', item: { use: 'RecipeCard', props: { title: '$.title' } } }],
    });
    const res = pa.deleteProjectViewComponent('RecipeCard');
    expect(res.ok).toBe(false);
    expect(res.error).toContain('views/recipes.view.json');
    expect(existsSync(join(projectRoot, 'components', 'RecipeCard.view.json'))).toBe(true);
    // Deleting the referencing view first unblocks it.
    expect(pa.deleteProjectView('recipes')).toEqual({ ok: true });
    expect(pa.deleteProjectViewComponent('RecipeCard')).toEqual({ ok: true });
  });

  it('deleteProjectViewLayout: deletes a layout whose children stay reachable; refuses one whose child it orphans', () => {
    const pa = make();
    const layout = {
      sections: [
        { kind: 'toolbar', actions: [{ label: 'All', action: { navigate: 'recipes/index' } }] },
        { kind: 'outlet' },
      ],
    };
    // Child reachable through the SHELL, not only through the layout → the frame is retired freely.
    pa.writeProjectViewLayout('recipes', layout);
    pa.writeProjectView('recipes/index', { sections: [{ kind: 'list', query: 'listRecipes' }] });
    pa.writeProjectViewShell({ nav: [{ route: 'recipes/index', label: 'Recipes' }] });
    expect(pa.deleteProjectViewLayout('recipes')).toEqual({ ok: true });
    expect(existsSync(join(projectRoot, 'views', 'recipes', '_layout.view.json'))).toBe(false);

    // …but with nothing else pointing at the child, the layout is its ONLY inbound link: deleting
    // it would orphan the child, so it is refused with the orphan named and disk untouched.
    pa.writeProjectViewLayout('recipes', layout);
    pa.writeProjectViewShell({ nav: [] });
    const res = pa.deleteProjectViewLayout('recipes');
    expect(res.ok).toBe(false);
    expect(res.error).toContain('deleteProjectViewLayout("recipes") refused');
    expect(res.error).toContain('views/recipes/index.view.json');
    expect(existsSync(join(projectRoot, 'views', 'recipes', '_layout.view.json'))).toBe(true);

    // Missing → { ok:false }.
    expect(pa.deleteProjectViewLayout('ghost').ok).toBe(false);
  });

  it('deleteProjectApi: deletes an unreferenced handler; a queried one is REFUSED with the page named', () => {
    const pa = make();
    appWrites.length = 0;
    // Nothing queries it (no views at all) → deletes, fires onAppWrite(api).
    expect(pa.deleteProjectApi('recipes/GET')).toEqual({ ok: true });
    expect(existsSync(join(projectRoot, 'api', 'recipes', 'GET.ts'))).toBe(false);
    expect(appWrites).toEqual([{ kind: 'api', route: 'recipes/GET' }]);

    // Missing → { ok:false }, and a bad method is rejected exactly like the writer's.
    expect(pa.deleteProjectApi('recipes/GET').ok).toBe(false);
    expect(pa.deleteProjectApi('recipes/FETCH').ok).toBe(false);

    // Queried → refused, the referencing page named, handler still on disk.
    writeFileSync(
      join(projectRoot, 'api', 'recipes', 'GET.ts'),
      `export const name = 'listRecipes';
export interface Output { items: { id: string; title: string; minutes: number }[]; }
export default async function handler() { return { items: [] }; }
`,
    );
    pa.writeProjectView('recipes', { sections: [{ kind: 'list', query: 'listRecipes' }] });
    const res = pa.deleteProjectApi('recipes/GET');
    expect(res.ok).toBe(false);
    expect(res.error).toContain('deleteProjectApi("recipes/GET") refused');
    expect(res.error).toContain('views/recipes.view.json');
    expect(existsSync(join(projectRoot, 'api', 'recipes', 'GET.ts'))).toBe(true);
    // Deleting the referencing page first unblocks it.
    expect(pa.deleteProjectView('recipes')).toEqual({ ok: true });
    expect(pa.deleteProjectApi('recipes/GET')).toEqual({ ok: true });
  });
});

// ── the personal-workspace guard ───────────────────────────────────────────────
//
// The "user" project is the personal THING workspace: it may hold the HOST-written chat scaffold
// (a newborn `views/index.view.json` + `shell.view.json`) and personal automations, NEVER a built
// app. Found live: a build_live_project run whose automator was not retargeted authored an entire
// app INTO `.lmthing/user/` (a shell, 5 views, 2 components, 4 api handlers, 2 tables). The two
// halves below are proven TOGETHER on purpose — the guard must refuse the agent-authored build
// without ever touching the host scaffold that writes the very same file paths, through its own
// seam (`projects.ts#scaffoldAppFromBirthSync` / `#ensureAppFromBirthSync` — direct fs writes,
// never these globals).
describe('the user-project guard — no built app in the personal workspace', () => {
  let userRoot: string; // <tmp>/…/user — basename AND project id are both "user"

  beforeEach(() => {
    userRoot = join(mkdtempSync(join(tmpdir(), 'lm-user-guard-')), DEFAULT_PROJECT_ID);
    mkdirSync(userRoot, { recursive: true });
  });

  afterEach(() => {
    rmSync(userRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  });

  const makeUser = (projectId = DEFAULT_PROJECT_ID) =>
    createProjectAuthoringGlobals({ projectId, projectRoot: userRoot, onAppWrite: () => {
      throw new Error('onAppWrite must never fire for a refused write');
    } });

  it('REFUSES all four view writers with the retarget message — nothing lands, no side effect fires', () => {
    const pa = makeUser();
    const refusals = [
      pa.writeProjectView('books/[id]', { sections: [{ kind: 'list', query: 'listBooks' }] }),
      pa.writeProjectViewLayout('books', { sections: [{ kind: 'outlet' }] }),
      pa.writeProjectViewComponent('BookCard', { props: {}, node: { el: 'text', text: 'x' } }),
      pa.writeProjectViewShell({ brand: 'Book Club Tracker', nav: [{ route: 'books', label: 'Books' }] }),
    ];
    for (const r of refusals) {
      expect(r.ok).toBe(false);
      expect(r.error).toContain('personal THING workspace');
      expect(r.error).toContain('can never hold a built app');
      expect(r.error).toContain('createProject');
      expect(r.error).toContain('selectProject');
    }
    // The exact live-pollution shapes left NOTHING behind — no views/, components/, no shell.
    expect(existsSync(join(userRoot, 'views'))).toBe(false);
    expect(existsSync(join(userRoot, 'components'))).toBe(false);
    expect(existsSync(join(userRoot, 'shell.view.json'))).toBe(false);
  });

  it('the HOST scaffold still writes the very paths the guard protects — through its own seam', () => {
    // (a) the agent-facing writers refuse…
    const pa = makeUser();
    expect(pa.writeProjectView('index', { sections: [{ id: 'chat', kind: 'chat', agent: 'thing' }] }).ok).toBe(false);
    expect(pa.writeProjectViewShell({ assistant: false }).ok).toBe(false);

    // (b) …while the host scaffold creates the newborn chat app-from-birth directly.
    scaffoldAppFromBirthSync(dirname(userRoot), DEFAULT_PROJECT_ID, 'Personal');
    const indexPath = join(userRoot, 'views', 'index.view.json');
    const shellPath = join(userRoot, 'shell.view.json');
    expect(existsSync(indexPath)).toBe(true);
    expect(existsSync(shellPath)).toBe(true);
    expect(JSON.parse(readFileSync(shellPath, 'utf8'))).toEqual({ assistant: false });

    // (c) …and the lazy-ensure (the serve/session-start path observed recreating them live)
    // brings BOTH artifacts back after a deletion, guard or no guard.
    rmSync(join(userRoot, 'views'), { recursive: true, force: true });
    rmSync(shellPath, { force: true });
    expect(existsSync(indexPath)).toBe(false);
    ensureAppFromBirthSync(dirname(userRoot), DEFAULT_PROJECT_ID, 'Personal');
    expect(existsSync(indexPath)).toBe(true);
    const index = JSON.parse(readFileSync(indexPath, 'utf8'));
    expect(index.route).toBe('index');
    expect(index.sections[0]).toMatchObject({ kind: 'chat', agent: 'thing' });
    expect(JSON.parse(readFileSync(shellPath, 'utf8'))).toEqual({ assistant: false });
  });
});
