/**
 * The view-spec validators, and — the point of this file — **the exact text of their rejections**.
 *
 * The error text is a model-facing interface, not a log line: the plan measures retry convergence
 * (≤1 retry per write) and a menu-shaped error is the whole mechanism. So these assertions are
 * `toBe`, not `toContain`. Changing a message here is changing the contract, and the diff should
 * say so out loud.
 */
import { afterAll, describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import {
  loadViewContracts,
  outputFieldUniverse,
  renderSmokeViews,
  validateAppViews,
  validateShellSpec,
  validateViewComponent,
  validateViewSpec,
  type ViewContracts,
} from './validate.js';
import type { ViewSpec } from './schema.js';

// ── the fixture project's vocabulary ─────────────────────────────────────────

const CONTRACTS: ViewContracts = {
  endpoints: [
    {
      name: 'listRecipes',
      method: 'GET',
      outputFields: ['items', 'id', 'title', 'cuisine', 'minutes'],
      inputKeys: ['cuisine'],
    },
    { name: 'getRecipe', method: 'GET', outputFields: ['id', 'title', 'steps'], inputKeys: ['id'] },
    { name: 'addRecipe', method: 'POST', outputFields: ['id'], inputKeys: ['title', 'cuisine'] },
    { name: 'importRecipe', method: 'POST', outputFields: ['jobId'], inputKeys: ['url'] },
    { name: 'importRecipeText', method: 'POST', outputFields: ['jobId'], inputKeys: ['text'] },
  ],
  components: [
    { name: 'RecipeCard', props: { recipe: 'Recipe' }, node: { el: 'text', text: '$props.recipe' } },
  ],
  routes: ['index', 'recipes', 'recipes/[id]'],
};

/** A one-section page, so a test names only what it is testing. */
function page(section: unknown, route = 'recipes'): ViewSpec {
  return { route, sections: [section] } as ViewSpec;
}

const check = (spec: unknown) => validateViewSpec(spec, CONTRACTS);
const messages = (spec: unknown) => check(spec).errors.map((e) => e.message);
const only = (spec: unknown) => {
  const res = check(spec);
  expect(res.errors.length, JSON.stringify(res.errors.map((e) => e.message), null, 1)).toBe(1);
  return res.errors[0];
};

// ──────────────────────────────────────────────────────────────────────────────

describe('validateViewSpec — the minimum, and what passes', () => {
  it('accepts the minimum valid page', () => {
    const res = check(page({ kind: 'list', query: 'listRecipes' }));
    expect(res.errors).toEqual([]);
    expect(res).toMatchObject({ ok: true, errorCount: 0, warningCount: 0, checked: 1 });
  });

  it('accepts a realistic page: flat item, facet, row action, component ref, dependent input', () => {
    const res = check({
      route: 'recipes',
      title: 'Recipes',
      sections: [
        {
          kind: 'list',
          id: 'all',
          query: 'listRecipes',
          input: { cuisine: '$client.timezone' },
          item: { title: '$.title', meta: { value: '$.minutes', format: 'number' } },
          facet: [{ field: '$.cuisine' }],
          rowAction: { navigate: 'recipes/[id]', params: { id: '$.id' } },
        },
        {
          kind: 'create',
          mutation: 'addRecipe',
          invalidates: ['listRecipes'],
          onSuccess: { navigate: 'recipes/[id]', params: { id: '$result.id' } },
        },
      ],
    });
    expect(res.errors).toEqual([]);
  });

  it('does not check fields it cannot resolve, rather than rejecting them', () => {
    // An endpoint whose Output could not be read (an aliased type) ⇒ every binding is allowed.
    const loose: ViewContracts = { endpoints: [{ name: 'listThings', method: 'GET' }] };
    const res = validateViewSpec(page({ kind: 'list', query: 'listThings', item: { title: '$.whatever' } }), loose);
    expect(res.errors).toEqual([]);
  });
});

describe('validateViewSpec — name resolution (the menu)', () => {
  it('names the offence and the finite set of mutations', () => {
    const e = only(page({ kind: 'create', mutation: 'addRecipies' }, 'recipes'));
    expect(e.code).toBe('unknown-endpoint');
    expect(e.message).toBe(
      'sections[0].mutation: "addRecipies" is not an endpoint. Did you mean addRecipe? ' +
        'Mutations: addRecipe, importRecipe, importRecipeText',
    );
  });

  it('reports the instance path of the offending section, not the page', () => {
    const e = only({
      route: 'recipes',
      sections: [{ kind: 'list', query: 'listRecipes' }, { kind: 'create', mutation: 'addRecipies' }],
    });
    expect(e.path).toBe('sections[1].mutation');
    expect(e.message.startsWith('sections[1].mutation: ')).toBe(true);
  });

  it('offers QUERIES for a query slot, not every endpoint', () => {
    const e = only(page({ kind: 'list', query: 'listRecipe' }));
    expect(e.message).toBe(
      'sections[0].query: "listRecipe" is not an endpoint. Did you mean listRecipes? Queries: getRecipe, listRecipes',
    );
  });

  it('rejects a mutation used as a query, and says which half it belongs to', () => {
    const e = only(page({ kind: 'list', query: 'addRecipe' }));
    expect(e.code).toBe('wrong-method');
    expect(e.message).toBe(
      'sections[0].query: "addRecipe" is a POST endpoint, and a query needs a GET endpoint. ' +
        'Queries: getRecipe, listRecipes',
    );
  });

  it('rejects an input key the endpoint does not declare — it would be silently dropped', () => {
    const e = only(page({ kind: 'list', query: 'listRecipes', input: { cusine: '$route.id' } }, 'recipes/[id]'));
    expect(e.code).toBe('unknown-input');
    expect(e.message).toBe(
      'sections[0].input.cusine: "cusine" is not an input of listRecipes. Did you mean cuisine? ' +
        'Inputs: cuisine. An undeclared key is dropped before the request, so the endpoint never sees it.',
    );
  });

  it('says so honestly when the menu is empty', () => {
    const bare = validateViewSpec(page({ kind: 'list', query: 'x' }), { endpoints: [] });
    expect(bare.errors[0].message).toBe(
      'sections[0].query: "x" is not an endpoint. Queries: (none — this app has none yet)',
    );
  });
});

describe('validateViewSpec — bindings', () => {
  it('rejects an unknown Output field and points the fix at the endpoint', () => {
    const e = only(page({ kind: 'list', query: 'listRecipes', item: { title: '$.titel' } }));
    expect(e.code).toBe('unknown-field');
    expect(e.message).toBe(
      'sections[0].item.title: "$.titel" is not a field of listRecipes\'s Output. Did you mean $.title? ' +
        'Fields: cuisine, id, items, minutes, title. ' +
        'If the value should exist, add it to listRecipes\'s Output and compute it there — a page cannot compute.',
    );
  });

  it('treats an EXPRESSION as its own failure, with its own advice', () => {
    const e = only(page({ kind: 'list', query: 'listRecipes', item: { title: '$.price * $.qty' } }));
    expect(e.code).toBe('expression');
    expect(e.message).toBe(
      'sections[0].item.title: "$.price * $.qty" is not a binding — the spec language has no expressions, ' +
        'on purpose. Bindings are paths only. Compute the value in the endpoint\'s Output and bind the result, ' +
        'or use a named policy: format (currency/date/relative-time/number), toneMap (value → tone), ' +
        'poll.while (refresh while a field is in a set).',
    );
  });

  it('catches template interpolation as an expression too', () => {
    const e = only(page({ kind: 'list', query: 'listRecipes', item: { title: '{{ count }} left' } }));
    expect(e.code).toBe('expression');
  });

  it('treats a MISTYPED ROOT as a different failure, and hands over the fix', () => {
    const e = only(page({ kind: 'detail', query: 'getRecipe', param: '$params.id' }, 'recipes/[id]'));
    expect(e.code).toBe('bad-binding');
    expect(e.message).toBe(
      'sections[0].param: "$params.id" is not a valid binding. Did you mean "$route.id"? ' +
        'Bindings are paths from one of eight roots: $ (the current row/record), $.field, ' +
        '$props.name (inside a component), $route.param, $data.<sectionId>.path (another section on ' +
        'this page), $result.field (under onSuccess), $form.field (under create.prefill.input), ' +
        '$client.timezone.',
    );
  });

  it('does not mistake a literal dollar amount for a binding', () => {
    expect(messages(page({ kind: 'list', query: 'listRecipes', item: { note: 'Save $5 with a coupon' } }))).toEqual([]);
  });

  it('rejects a route parameter this route does not have', () => {
    const e = only(page({ kind: 'detail', query: 'getRecipe', param: '$route.slug' }, 'recipes/[id]'));
    expect(e.message).toBe(
      'sections[0].param: "$route.slug" — this page\'s route has no parameter "slug". Route parameters: id',
    );
  });

  it('rejects $result outside an onSuccess', () => {
    const e = only(page({ kind: 'list', query: 'listRecipes', item: { title: '$result.id' } }));
    expect(e.message).toBe(
      'sections[0].item.title: "$result.id" — $result is only bindable under an onSuccess, where it is ' +
        'the Output of the mutation that just ran.',
    );
  });

  it('rejects $props outside a component definition', () => {
    const e = only(page({ kind: 'list', query: 'listRecipes', item: { title: '$props.recipe' } }));
    expect(e.message).toBe(
      'sections[0].item.title: "$props.recipe" — $props is only bindable inside a component definition ' +
        '(writeProjectViewComponent). On a page, bind the section\'s data with $.field.',
    );
  });

  it('resolves $data.<sectionId> against the page, and rejects a target that is not a section', () => {
    const ok = check({
      route: 'recipes',
      sections: [
        { kind: 'detail', id: 'current', query: 'getRecipe', param: '$route.id' },
        { kind: 'list', query: 'listRecipes', input: { cuisine: '$data.current.title' } },
      ],
    });
    expect(ok.errors).toEqual([]);

    const e = only({
      route: 'recipes',
      sections: [
        { kind: 'detail', id: 'current', query: 'getRecipe' },
        { kind: 'list', query: 'listRecipes', input: { cuisine: '$data.curent.title' } },
      ],
    });
    expect(e.message).toBe(
      'sections[1].input.cuisine: "curent" is not a section id on this page. Did you mean current? ' +
        'Section ids: current. Give the target section an `id` — it has none unless you write one.',
    );
  });
});

describe('validateViewSpec — components, sections and routes', () => {
  it('rejects a component the app does not define, and says how to make one', () => {
    const e = only(page({ kind: 'list', query: 'listRecipes', item: { use: 'RecipeCards', props: { recipe: '$' } } }));
    expect(e.code).toBe('unknown-component');
    expect(e.message).toBe(
      'sections[0].item.use: "RecipeCards" is not a view component. Did you mean RecipeCard? ' +
        'Components: RecipeCard. Write it first with writeProjectViewComponent(\'RecipeCards\', { … }).',
    );
  });

  it('rejects an undeclared prop and a missing one', () => {
    expect(messages(page({ kind: 'list', query: 'listRecipes', item: { use: 'RecipeCard', props: { recipy: '$' } } }))).toEqual([
      'sections[0].item.props.recipy: "recipy" is not a prop of RecipeCard. Did you mean recipe? Props: recipe',
      'sections[0].item.props: RecipeCard requires the prop "recipe", which this reference does not pass. Props: recipe',
    ]);
  });

  it('rejects a reveals target that is not a section id', () => {
    const e = only({
      route: 'recipes',
      sections: [
        { kind: 'toolbar', actions: [{ label: 'Filters', reveals: ['filterz'] }] },
        { kind: 'list', id: 'filters', query: 'listRecipes' },
      ],
    });
    expect(e.code).toBe('unknown-section');
    expect(e.message).toBe(
      'sections[0].actions[0].reveals[0]: "filterz" is not a section id on this page. Did you mean filters? ' +
        'Section ids: filters. Give the target section an `id` — it has none unless you write one.',
    );
  });

  it('rejects a navigate target that is not a route', () => {
    const e = only(page({ kind: 'list', query: 'listRecipes', rowAction: { navigate: 'recipe/[id]' } }));
    expect(e.code).toBe('unknown-route');
    expect(e.message).toBe(
      'sections[0].rowAction.navigate: "recipe/[id]" is not a route in this app. Did you mean recipes/[id]? ' +
        'Routes: index, recipes, recipes/[id]',
    );
  });
});

describe('validateViewSpec — shape errors are menus too', () => {
  it('names the properties a create section HAS when one is invented', () => {
    // Rule 4: a `create` declares no fields — they derive from the Input schema.
    const e = only(page({ kind: 'create', mutation: 'addRecipe', fields: [{ label: 'Title' }] }));
    expect(e.code).toBe('shape');
    expect(e.message.startsWith('sections[0]: "fields" is not a property here. Properties: ')).toBe(true);
    expect(e.message).toContain('mutation');
    expect(e.message).toContain('prefill');
    expect(e.message).not.toContain('fields,');
  });

  it('names the eight section kinds when the kind is invented', () => {
    const res = check(page({ kind: 'table', query: 'listRecipes' }));
    expect(res.ok).toBe(false);
    expect(res.errors.some((e) => e.message.includes('is not a valid kind'))).toBe(true);
  });

  it('skips semantic checks entirely when the shape is wrong', () => {
    // One structural fault must not produce a cascade the model cannot act on.
    const res = check({ route: 'recipes', sections: [{ kind: 'list', query: 'nope', limit: 'ten' }] });
    expect(res.errors.every((e) => e.code === 'shape')).toBe(true);
  });

  it('rejects a bad route with a route error, not an ajv pattern dump', () => {
    const res = check({ route: '/Recipes/', sections: [{ kind: 'list', query: 'listRecipes' }] });
    expect(res.ok).toBe(false);
  });
});

describe('validateViewComponent', () => {
  const def = (node: unknown, props?: Record<string, string>) => ({ name: 'Card', props, node });

  it('accepts a component that binds its declared props', () => {
    const res = validateViewComponent(def({ el: 'text', text: '$props.title' }, { title: 'string' }), CONTRACTS);
    expect(res.errors).toEqual([]);
  });

  it('rejects a prop the component did not declare', () => {
    const res = validateViewComponent(def({ el: 'text', text: '$props.titel' }, { title: 'string' }), CONTRACTS);
    expect(res.errors[0].message).toBe(
      'node.text: "titel" is not a prop of this component. Did you mean title? Props: title',
    );
  });

  it('does NOT check $.field inside a component — the caller\'s row type is not knowable here', () => {
    const res = validateViewComponent(def({ el: 'text', text: '$.anything' }), CONTRACTS);
    expect(res.errors).toEqual([]);
  });

  it('rejects a component that references itself', () => {
    const res = validateViewComponent(def({ el: 'row', children: [{ use: 'Card' }] }), CONTRACTS);
    expect(res.errors[0].code).toBe('component-cycle');
    expect(res.errors[0].message).toBe(
      'node: Card → Card — view components may not reference each other in a cycle. ' +
        'A component is data the renderer expands; a cycle expands forever.',
    );
  });

  it('rejects an indirect cycle through another component', () => {
    const contracts: ViewContracts = {
      ...CONTRACTS,
      components: [{ name: 'Inner', node: { use: 'Outer' } }],
    };
    const res = validateViewComponent({ name: 'Outer', node: { use: 'Inner' } }, contracts);
    expect(res.errors.map((e) => e.code)).toContain('component-cycle');
  });
});

describe('validateShellSpec', () => {
  it('accepts a shell whose targets are real routes', () => {
    const res = validateShellSpec({ nav: [{ route: 'recipes', label: 'Recipes' }] }, CONTRACTS);
    expect(res.errors).toEqual([]);
  });

  it('rejects a nav target that is not a route', () => {
    const res = validateShellSpec({ nav: [{ route: 'recipe' }] }, CONTRACTS);
    expect(res.errors[0].message).toBe(
      'nav[0].route: "recipe" is not a route in this app. Did you mean recipes? Routes: index, recipes, recipes/[id]',
    );
  });

  it('rejects a parameterised route as a nav destination (it is a drill-in, not a place)', () => {
    const res = validateShellSpec({ nav: [{ route: 'recipes/[id]' }] }, CONTRACTS);
    expect(res.ok).toBe(false);
  });

  it('checks a nav badge against the real endpoints', () => {
    const res = validateShellSpec({ nav: [{ route: 'recipes', badge: { query: 'countNew', field: '$.n' } }] }, CONTRACTS);
    expect(res.errors[0].code).toBe('unknown-endpoint');
  });
});

describe('outputFieldUniverse', () => {
  it('unions the Output\'s own properties with one array level (the { items: T[] } convention)', () => {
    expect(
      outputFieldUniverse({
        type: 'object',
        properties: { items: { type: 'array', items: { type: 'object', properties: { id: {}, title: {} } } }, total: {} },
      }),
    ).toEqual(['id', 'items', 'title', 'total']);
  });

  it('reads element properties when the Output IS an array', () => {
    expect(outputFieldUniverse({ type: 'array', items: { type: 'object', properties: { id: {}, name: {} } } })).toEqual([
      'id',
      'name',
    ]);
  });
});

// ── the on-disk halves ───────────────────────────────────────────────────────

const tmpDirs: string[] = [];
afterAll(async () => {
  await Promise.all(tmpDirs.map((d) => rm(d, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })));
});

async function project(files: Record<string, string>): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'lm-views-'));
  tmpDirs.push(dir);
  for (const [rel, contents] of Object.entries(files)) {
    const abs = join(dir, ...rel.split('/'));
    await mkdir(join(abs, '..'), { recursive: true });
    await writeFile(abs, contents, 'utf8');
  }
  return dir;
}

const HANDLER = (name: string, output: string, input = '') =>
  `export const name = '${name}';
export interface Input {${input}}
export interface Output {${output}}
export default async function handler() { return {} as Output; }
`;

describe('loadViewContracts — the writers\' synchronous contract source', () => {
  it('reads endpoint names, methods and one nested level of Output fields from api/', async () => {
    const root = await project({
      'api/recipes/GET.ts': HANDLER('listRecipes', ' items: { id: string; title: string }[]; total: number; ', ' cuisine?: string; '),
      'api/recipes/POST.ts': HANDLER('addRecipe', ' id: string; ', ' title: string; '),
    });
    const c = loadViewContracts(root);
    expect(c.endpoints.map((e) => `${e.method} ${e.name}`).sort()).toEqual(['GET listRecipes', 'POST addRecipe']);
    expect(c.endpoints.find((e) => e.name === 'listRecipes')!.outputFields).toEqual(['id', 'items', 'title', 'total']);
    expect(c.endpoints.find((e) => e.name === 'listRecipes')!.inputKeys).toEqual(['cuisine']);
  });

  it('returns undefined fields — not an empty list — for an Output it cannot read', async () => {
    const root = await project({
      'api/things/GET.ts': `export const name = 'listThings';\nexport type Output = ThingList;\nexport default async function h() {}\n`,
    });
    expect(loadViewContracts(root).endpoints[0].outputFields).toBeUndefined();
  });
});

describe('validateAppViews', () => {
  const view = (spec: unknown) => JSON.stringify(spec);

  it('reports a page no navigation reaches', async () => {
    const root = await project({
      'api/recipes/GET.ts': HANDLER('listRecipes', ' id: string; '),
      'pages/index.view.json': view({ route: 'index', sections: [{ kind: 'list', query: 'listRecipes' }] }),
      'pages/admin/secrets.view.json': view({
        route: 'admin/secrets',
        sections: [{ kind: 'list', query: 'listRecipes' }],
      }),
    });
    const res = await validateAppViews(root, { contracts: { endpoints: [] } as never });
    const orphan = res.errors.find((e) => e.code === 'orphan-route');
    expect(orphan?.message).toBe(
      'pages/admin/secrets: no navigation reaches this page. Add it to the shell (nav/groups/subnav), ' +
        'or give some page a { navigate: \'admin/secrets\' } action / rowAction. Reachable today: index',
    );
  });

  it('does not call a page an orphan when a rowAction navigates to it', async () => {
    const root = await project({
      'pages/index.view.json': view({
        route: 'index',
        sections: [{ kind: 'list', query: 'listRecipes', rowAction: { navigate: 'recipes/[id]' } }],
      }),
      'pages/recipes/[id].view.json': view({
        route: 'recipes/[id]',
        sections: [{ kind: 'detail', query: 'getRecipe' }],
      }),
    });
    const res = await validateAppViews(root, { contracts: { endpoints: [] } as never });
    expect(res.errors.filter((e) => e.code === 'orphan-route')).toEqual([]);
  });

  it('warns about a component nothing uses, without failing the gate on it', async () => {
    const root = await project({
      'pages/index.view.json': view({ route: 'index', sections: [{ kind: 'list', query: 'listRecipes' }] }),
      'pages/components/Unused.view.json': view({ name: 'Unused', node: { el: 'text', text: 'hi' } }),
    });
    const res = await validateAppViews(root, { contracts: { endpoints: [] } as never });
    const dead = res.errors.find((e) => e.code === 'dead-component');
    expect(dead?.severity).toBe('warning');
    expect(dead?.message).toBe(
      'component Unused is defined but no view references it with { use: \'Unused\' } — either use it or drop it.',
    );
    expect(res.warningCount).toBe(1);
  });

  it('reports a page that reads no data at all', async () => {
    const root = await project({
      'pages/index.view.json': view({ route: 'index', sections: [{ kind: 'markdown', source: '# Welcome' }] }),
    });
    const res = await validateAppViews(root, { contracts: { endpoints: [] } as never });
    expect(res.errors.find((e) => e.code === 'no-data')?.message).toBe(
      'pages/index: no section on this page reads data (sections: markdown). A page with no query/mutation ' +
        'renders chrome over nothing. Add a list, detail, stats, timeline or create section bound to an endpoint.',
    );
  });

  it('says LOUDLY that it found nothing, rather than reporting clean', async () => {
    const root = await project({ 'package.json': '{}' });
    const res = await validateAppViews(root, { contracts: { endpoints: [] } as never });
    expect(res.ok).toBe(false);
    expect(res.checked).toBe(0);
    expect(res.errors[0].message).toContain('has no view specs');
  });

  it('reports an unparseable artifact instead of throwing', async () => {
    const root = await project({
      'pages/index.view.json': '{ this is not json',
    });
    const res = await validateAppViews(root, { contracts: { endpoints: [] } as never });
    expect(res.errors.some((e) => e.code === 'malformed')).toBe(true);
  });
});

describe('renderSmokeViews', () => {
  /**
   * Contracts are INJECTED in most of these: generating them for real runs
   * `ts-json-schema-generator` over every handler, which is the slowest thing in the function and
   * is not what any of these assertions are about. The one test below that does not inject proves
   * the real generation path still works.
   */
  const CONTRACTS_FOR_SMOKE = {
    endpoints: [
      {
        name: 'listRecipes',
        method: 'GET',
        outputFields: ['items', 'id', 'title', 'rating'],
        inputKeys: [],
      },
    ],
  } as never;

  const app = () =>
    project({
      'pages/index.view.json': JSON.stringify({
        route: 'index',
        sections: [{ kind: 'list', query: 'listRecipes', item: { title: '$.title', meta: '$.rating' } }],
      }),
      'api/recipes/GET.ts': HANDLER('listRecipes', ' items: { id: string; title: string; rating: number }[]; '),
    });

  it('reports UNAVAILABLE rather than clean when it has no way to call anything', async () => {
    const res = await renderSmokeViews(await app());
    expect(res.unavailable).toBe(true);
    expect(res.ok).toBe(true); // no findings…
    expect(res.checked).toBe(0); // …because nothing ran, and it says so
    expect(res.reason).toContain('ctx.callProjectApi');
  });

  it('routes an always-null binding at the ENDPOINT, not at the view', async () => {
    const res = await renderSmokeViews(await app(), {
      contracts: CONTRACTS_FOR_SMOKE,
      call: async () => ({ status: 200, body: { items: [{ id: '1', title: 'Soup', rating: null }] } }),
    });
    expect(res.unavailable).toBe(false);
    const nul = res.errors.find((e) => e.code === 'null-binding');
    expect(nul?.endpoint).toBe('listRecipes');
    expect(nul?.message).toBe(
      'sections[0].item.meta: "$.rating" is null on all 1 row(s) listRecipes actually returned. ' +
        'The field is declared on listRecipes\'s Output but never computed, so this renders as nothing. ' +
        'Fix listRecipes to populate it — do not remove the binding.',
    );
  });

  it('measures binding coverage on real rows', async () => {
    const res = await renderSmokeViews(await app(), {
      contracts: CONTRACTS_FOR_SMOKE,
      call: async () => ({ status: 200, body: { items: [{ id: '1', title: 'Soup', rating: 4 }] } }),
    });
    expect(res.pages[0]).toMatchObject({ route: 'index', bindingsChecked: 2, bindingsCovered: 2, coverage: 1, empty: false });
    expect(res.ok).toBe(true);
  });

  it('detects a page that renders EMPTY against live data — the structurally-valid zeros case', async () => {
    const res = await renderSmokeViews(await app(), {
      contracts: CONTRACTS_FOR_SMOKE,
      call: async () => ({ status: 200, body: { items: [] } }),
    });
    expect(res.pages[0].empty).toBe(true);
    expect(res.errors.find((e) => e.code === 'empty-render')?.message).toBe(
      'pages/index: renders empty against live data — every section\'s endpoint returned zero rows. ' +
        'This passes every static gate and ships a blank page. Check that the sections\' endpoints return ' +
        'rows (smoke_endpoints), and that the bound fields are populated.',
    );
  });

  it(
    'reports a non-2xx section as a permanent error state — over REAL generated contracts',
    async () => {
      // No injected contracts: this one also proves the `generateProjectContracts` path works.
      const res = await renderSmokeViews(await app(), {
        call: async () => ({ status: 500, body: { error: 'no such table' } }),
      });
      expect(res.errors[0].message).toContain('answered 500, so this section renders its error state');
    },
    120_000,
  );
});
