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
 *  3. **the wrapper is generated, and regenerated**, which is the entire reason the pages build
 *     needs no changes. A component written after the pages that use it must reach them.
 */

import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createProjectAuthoringGlobals } from './globals.js';
import { LintError } from './lint.js';
import { validateAppViews } from '../view-spec/validate.js';

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
      projectRoot,
      onAppWrite: (kind, route) => appWrites.push({ kind, route }),
    });

  const read = (...rel: string[]) => readFileSync(join(projectRoot, ...rel), 'utf8');

  // ── writeProjectView ───────────────────────────────────────────────────────

  it('persists the spec AND generates the wrapper page, and fires onAppWrite', () => {
    const pa = make();
    const res = pa.writeProjectView('recipes', {
      title: 'Recipes',
      sections: [{ kind: 'list', query: 'listRecipes', item: { title: '$.title' } }],
    });
    expect(res).toEqual({ ok: true });

    // 1. the spec, with its route normalized in from the first argument
    const spec = JSON.parse(read('views', 'recipes.view.json'));
    expect(spec.route).toBe('recipes');
    expect(spec.sections[0].query).toBe('listRecipes');

    // 2. the wrapper — an ordinary `.tsx` the page build will discover, hash and bundle
    const wrapper = read('pages', 'recipes.tsx');
    expect(wrapper).toContain("import { ViewRenderer, ViewThemeProvider, createViewClient } from '@lmthing/ui/view';");
    expect(wrapper).toContain('export default function View()');
    expect(wrapper).toContain('<ViewRenderer');
    expect(wrapper).toContain('"query": "listRecipes"'); // the spec is INLINED, not fetched
    expect(wrapper).toContain('AUTO-GENERATED');

    // ── the three things the T1 golden-app live run proved are LOAD-BEARING ───────────────
    // Each was absent, each broke EVERY route of a real app, and none of them can be caught by
    // a jsdom render test (which supplies its own provider, its own client and its own params).

    // 1. the theme provider — without it every `Prim.*` throws `Missing theme.` and every page
    //    renders the error boundary, because a project-app bundle has no root that supplies one.
    expect(wrapper).toContain('<ViewThemeProvider>');

    // 2. the client is built INSIDE the component. ESM hoists this module above the entry's
    //    `mountApp({ manifest })`, so a module-scope `createViewClient` captures `{}` and every
    //    endpoint resolves to `unknown endpoint "x"`.
    const clientAt = wrapper.indexOf('createViewClient({');
    const componentAt = wrapper.indexOf('export default function View()');
    expect(clientAt).toBeGreaterThan(componentAt);

    // 3. route params are passed through — `$route.*` resolves against this prop, so without it
    //    every `[param]` page queries for the wrong record (or none).
    expect(wrapper).toContain('useParams');
    expect(wrapper).toContain('route={route}');

    expect(appWrites).toEqual([{ kind: 'page', route: 'recipes' }]);
  });

  it('writes a nested route into nested dirs', () => {
    const pa = make();
    expect(pa.writeProjectView('recipes/[id]', { sections: [{ kind: 'detail', query: 'listRecipes' }] }).ok).toBe(true);
    expect(existsSync(join(projectRoot, 'views', 'recipes', '[id].view.json'))).toBe(true);
    expect(existsSync(join(projectRoot, 'pages', 'recipes', '[id].tsx'))).toBe(true);
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

  it('refuses to overwrite a hand-written React page at the same route', () => {
    mkdirSync(join(projectRoot, 'pages'), { recursive: true });
    writeFileSync(join(projectRoot, 'pages', 'recipes.tsx'), 'export default () => <div />;\n');
    const pa = make();
    const res = pa.writeProjectView('recipes', { sections: [{ kind: 'list', query: 'listRecipes' }] });
    expect(res.ok).toBe(false);
    expect(res.error).toContain('it is a hand-written React page');
  });

  // ── writeProjectViewLayout ─────────────────────────────────────────────────

  it('writes a nested layout and frames its children through the wrapper', () => {
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

    // A page under the prefix carries the layout in its wrapper — that is how the frame reaches
    // the browser without the page authoring a word of it.
    expect(
      pa.writeProjectView('recipes/[id]', { sections: [{ kind: 'list', query: 'listRecipes' }] }),
    ).toEqual({ ok: true });
    const wrapper = read('pages', 'recipes', '[id].tsx');
    expect(wrapper).toContain('"kind": "outlet"');
    expect(wrapper).toContain('"prefix": "recipes"');
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

  it('RE-EMITS every wrapper when a component changes, so no page holds a stale copy', () => {
    const pa = make();
    pa.writeProjectViewComponent('RecipeCard', { props: { title: 'string' }, node: { el: 'text', text: '$props.title' } });
    pa.writeProjectView('recipes', {
      sections: [{ kind: 'list', query: 'listRecipes', item: { use: 'RecipeCard', props: { title: '$.title' } } }],
    });
    expect(read('pages', 'recipes.tsx')).toContain('"el": "text"');

    // Rewrite the component AFTER the page: the page's inlined copy must follow.
    pa.writeProjectViewComponent('RecipeCard', {
      props: { title: 'string' },
      node: { el: 'heading', text: '$props.title' },
    });
    const wrapper = read('pages', 'recipes.tsx');
    expect(wrapper).toContain('"el": "heading"');
    expect(wrapper).not.toContain('"el": "text"');
  });

  // ── writeProjectViewShell ──────────────────────────────────────────────────

  it('writes the shell and inlines it into every wrapper', () => {
    const pa = make();
    pa.writeProjectView('recipes', { sections: [{ kind: 'list', query: 'listRecipes' }] });
    expect(pa.writeProjectViewShell({ brand: 'Kitchen', nav: [{ route: 'recipes', label: 'Recipes' }] })).toEqual({
      ok: true,
    });
    expect(existsSync(join(projectRoot, 'shell.view.json'))).toBe(true);
    expect(read('pages', 'recipes.tsx')).toContain('"brand": "Kitchen"');
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
});
