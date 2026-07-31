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
  toViewContracts,
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

  it('collapses a five-verb Action union to ONE finding, not five contradictory ones', () => {
    // T3 live-run bucket 2: `{ endpoint: 'doThing' }` matches none of mutate/navigate/download/
    // print/copy, so nothing was pruned and the model saw "mutate is required" right next to
    // "mutate is not a property here" for every one of the five branches.
    const e = only(page({ kind: 'list', query: 'listRecipes', rowActions: [{ label: 'Go', action: { endpoint: 'doThing' } }] }));
    expect(e.message).toBe(
      'sections[0].rowActions[0].action: "endpoint" does not choose one. ' +
        'Set exactly one key: copy, download, mutate, navigate, print',
    );
  });

  it('names the offending key when a matched branch has an extra property (no regression)', () => {
    const e = only(
      page({ kind: 'list', query: 'listRecipes', rowActions: [{ label: 'Go', action: { mutate: 'addRecipe', bogus: 1 } }] }),
    );
    expect(e.message).toBe(
      'sections[0].rowActions[0].action: "bogus" is not a property here. ' +
        'Properties: arg, confirm, input, invalidates, mutate, onSuccess, over',
    );
  });

  it('names both verbs, not five branches, when two are set at once', () => {
    const e = only(
      page({
        kind: 'list',
        query: 'listRecipes',
        rowActions: [{ label: 'Go', action: { mutate: 'addRecipe', navigate: 'recipes' } }],
      }),
    );
    expect(e.message).toBe(
      'sections[0].rowActions[0].action: "mutate" and "navigate" — pick exactly ONE of these, not several. ' +
        'Set exactly one key: copy, download, mutate, navigate, print',
    );
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

// ─────────────────────────────────────────────────────────────────────────────
// Wave-2 regressions. Every one of these was a REAL finding from the T1 kitchen
// migration, where the two whole-app gates together produced 81 false findings and
// one inverted metric. Each `it` pins one of them by its mechanism, not by its
// symptom, because a symptom test passes again the moment the bug moves.
// ─────────────────────────────────────────────────────────────────────────────

describe('toViewContracts — idempotence (D-A)', () => {
  /** What `generateProjectContracts` actually hands over: both schemas, always. */
  const RAW = {
    endpoints: [
      {
        name: 'dismissSuggestion',
        method: 'POST',
        routePath: '/suggestions/:id/dismiss',
        description: '',
        inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
        outputSchema: { type: 'object', properties: { ok: { type: 'boolean' } } },
        inputTsType: '{ id: string }',
        outputTsType: '{ ok: boolean }',
      },
    ],
  } as never;

  it('is the IDENTITY on its own output — reducing twice equals reducing once', () => {
    const once = toViewContracts(RAW);
    const twice = toViewContracts(once);
    expect(twice).toEqual(once);
  });

  it('does not lose inputKeys on the second pass — the 32-false-finding bug', () => {
    // `validateAppViews` reduces, then hands the result to `validateViewSpec`, which reduces
    // again. The reduced form keeps `outputSchema` and drops `inputSchema`, so a second raw-branch
    // pass recomputed `inputKeys` from a schema that is no longer there and got `[]` — which made
    // EVERY `input` key on every section of every page report as undeclared.
    expect(toViewContracts(RAW).endpoints[0].inputKeys).toEqual(['id']);
    expect(toViewContracts(toViewContracts(RAW)).endpoints[0].inputKeys).toEqual(['id']);
  });

  it('accepts a declared input key after a double reduction', () => {
    const reduced = toViewContracts(toViewContracts(RAW));
    const res = validateViewSpec(
      { route: 'index', sections: [{ kind: 'create', mutation: 'dismissSuggestion', input: { id: '$.id' } }] },
      { ...reduced, routes: ['index'] },
    );
    expect(res.errors.map((e) => e.message)).toEqual([]);
  });
});

describe('outputFieldUniverse — $ref / definitions (D-B)', () => {
  it('follows a $ref into definitions when the Output IS an array of a named type', () => {
    // `export type Output = Recipe[]` — the commonest Output shape in the catalogue. The root
    // property names are type/items/definitions, so a reader that stops there sees NO fields and
    // rejects every `$.field` on the endpoint (49 of T1's 81 false findings).
    expect(
      outputFieldUniverse({
        type: 'array',
        items: { $ref: '#/definitions/Recipe' },
        definitions: { Recipe: { type: 'object', properties: { id: {}, title: {}, tags: {} } } },
      }),
    ).toEqual(['id', 'tags', 'title']);
  });

  it('follows a $ref held by an array-valued PROPERTY', () => {
    expect(
      outputFieldUniverse({
        type: 'object',
        properties: { items: { type: 'array', items: { $ref: '#/definitions/Line' } }, total: {} },
        definitions: { Line: { type: 'object', properties: { sku: {}, qty: {} } } },
      }),
    ).toEqual(['items', 'qty', 'sku', 'total']);
  });

  it('follows a $ref at the Output root (a named record type)', () => {
    expect(
      outputFieldUniverse({
        $ref: '#/definitions/Recipe',
        definitions: { Recipe: { type: 'object', properties: { id: {}, title: {} } } },
      }),
    ).toEqual(['id', 'title']);
  });

  it('returns undefined — never [] — for an Output it cannot resolve', () => {
    // The invariant that keeps a stale contract from rejecting every working page: `[]` means
    // "declares nothing", which makes every binding an error, and this cannot tell the two apart.
    expect(outputFieldUniverse({ type: 'object' })).toBeUndefined();
    expect(outputFieldUniverse({ $ref: '#/definitions/Missing', definitions: {} })).toBeUndefined();
    expect(outputFieldUniverse(undefined)).toBeUndefined();
  });

  it('does not spin on a self-referential type', () => {
    expect(
      outputFieldUniverse({
        $ref: '#/definitions/Node',
        definitions: { Node: { type: 'object', properties: { id: {}, parent: { $ref: '#/definitions/Node' } } } },
      }),
    ).toEqual(['id', 'parent']);
  });

  it('accepts $.field on a $ref-ed Output end to end', async () => {
    const root = await project({
      'api/recipes/GET.ts': `export const name = 'listRecipes';
export interface Recipe { id: string; title: string }
export type Output = Recipe[];
export default async function h() { return [] as Output; }
`,
      'pages/index.view.json': JSON.stringify({
        route: 'index',
        sections: [{ kind: 'list', query: 'listRecipes', item: { title: '$.title' } }],
      }),
    });
    const res = await validateAppViews(root);
    expect(res.errors.filter((e) => e.code === 'unknown-field')).toEqual([]);
  }, 120_000);
});

describe('declaredFields — an INCOMPLETE menu is worse than no menu (D-3c)', () => {
  it('expands a named element type declared beside the handler', async () => {
    const root = await project({
      'api/plan/GET.ts': `export const name = 'getPlan';
export interface DayTotal { day: string; calories: number }
export interface Output { days: DayTotal[]; adherence: number }
export default async function h() { return {} as Output; }
`,
    });
    expect(loadViewContracts(root).endpoints[0].outputFields).toEqual(['adherence', 'calories', 'day', 'days']);
  });

  it('SKIPS rather than guesses when an element type is not in the file', async () => {
    // It cannot see through an IMPORTED `DayTotal[]`, so the honest answer is `undefined`
    // ("do not check"), never the partial `['days']` — which is what told T1 `"$.day" is not a
    // field… Did you mean $.days?` about a field of the very array the section was sourced from.
    const root = await project({
      'api/plan/GET.ts': `import type { DayTotal } from '../../types/x';
export const name = 'getPlan';
export interface Output { days: DayTotal[]; adherence: number }
export default async function h() { return {} as Output; }
`,
    });
    expect(loadViewContracts(root).endpoints[0].outputFields).toBeUndefined();
  });

  it('resolves an aliased Output through a type declared in the file', async () => {
    const root = await project({
      'api/recipes/GET.ts': `export const name = 'listRecipes';
export interface Recipe { id: string; title: string }
export type Output = Recipe[];
export default async function h() { return [] as Output; }
`,
    });
    expect(loadViewContracts(root).endpoints[0].outputFields).toEqual(['id', 'title']);
  });

  it('does not reject a row field of a `from`-sourced section at save time', async () => {
    // `sectionScope` re-roots on `ep.outputSchema`, which the SYNCHRONOUS reader never populates.
    // It used to fall back to the root universe, so a `from: '$.lines'` section's row bindings were
    // measured against the WRONG scope — 5 of T1's 14 writer rejections, and the reason five
    // element types were inlined in handlers for no runtime reason.
    const root = await project({
      'api/trip/GET.ts': `import type { TripLine } from '../../types/x';
export const name = 'getTrip';
export interface Output { lines: TripLine[]; estimatedCost: number }
export default async function h() { return {} as Output; }
`,
    });
    const res = validateViewSpec(
      {
        route: 'index',
        sections: [{ kind: 'list', query: 'getTrip', from: '$.lines', item: { title: '$.ingredient' } }],
      },
      { ...loadViewContracts(root), routes: ['index'] },
    );
    expect(res.errors).toEqual([]);
  });
});

describe('unknown route — a warning at save time, an error app-wide (D-3b)', () => {
  const TWO_WAY: ViewContracts = {
    endpoints: [{ name: 'listRecipes', method: 'GET', outputFields: ['id'] }],
    routes: ['recipes'],
    routesComplete: false,
  };

  it('does not fail a write that links to a page not yet on disk', () => {
    // `recipes` ↔ `recipes/[id]` mutually block: NO write order satisfies both. T1 needed a
    // 13-write throwaway bootstrap pass; a model would loop until its budget died.
    const res = validateViewSpec(
      {
        route: 'recipes',
        sections: [{ kind: 'list', query: 'listRecipes', rowAction: { navigate: 'recipes/[id]' } }],
      },
      TWO_WAY,
    );
    expect(res.ok).toBe(true);
    expect(res.warningCount).toBe(1);
    expect(res.errors[0].severity).toBe('warning');
    expect(res.errors[0].message).toContain('is not a route in this app YET');
  });

  it('is still a hard error once the route list is complete', () => {
    const res = validateViewSpec(
      {
        route: 'recipes',
        sections: [{ kind: 'list', query: 'listRecipes', rowAction: { navigate: 'recipes/[id]' } }],
      },
      { ...TWO_WAY, routesComplete: true },
    );
    expect(res.ok).toBe(false);
    expect(res.errors[0].code).toBe('unknown-route');
  });

  it('validateAppViews keeps it an error — the check is not lost, only deferred', async () => {
    const root = await project({
      'pages/index.view.json': JSON.stringify({
        route: 'index',
        sections: [{ kind: 'list', query: 'listRecipes', rowAction: { navigate: 'nowhere' } }],
      }),
    });
    const res = await validateAppViews(root, { contracts: { endpoints: [] } as never });
    const bad = res.errors.find((e) => e.code === 'unknown-route');
    expect(bad?.severity).toBe('error');
  });
});

describe('renderSmokeViews — the section\'s own source, not a heuristic (S1)', () => {
  const CONTRACTS = {
    endpoints: [
      {
        name: 'currentPlan',
        method: 'GET',
        routePath: '/plan',
        outputFields: ['plan', 'tonight', 'weekStart', 'mealsByDay'],
        inputKeys: [],
      },
    ],
  } as never;

  /** The kitchen's real shape: a RECORD with a top-level array beside the fields that matter. */
  const BODY = {
    plan: { id: 'p1' },
    tonight: { recipeTitle: 'Soup', day: '2026-07-29' },
    weekStart: '2026-07-27',
    mealsByDay: [{ id: 'm1', title: 'Soup' }],
  };

  it('binds a stats section against the RECORD, not the first array property', async () => {
    // `rowsOf` took `mealsByDay` as "the rows", so 14 correct `$.tonight.*` bindings were reported
    // as always-null — each naming the wrong culprit, and `17-fix` routes those at the handler.
    const root = await project({
      'pages/index.view.json': JSON.stringify({
        route: 'index',
        sections: [
          {
            kind: 'stats',
            query: 'currentPlan',
            cards: [
              { label: 'Week', value: '$.weekStart' },
              { label: 'Tonight', value: '$.tonight.recipeTitle' },
            ],
          },
        ],
      }),
    });
    const res = await renderSmokeViews(root, { contracts: CONTRACTS, call: async () => ({ status: 200, body: BODY }) });
    expect(res.errors.filter((e) => e.code === 'null-binding')).toEqual([]);
    expect(res.pages[0]).toMatchObject({ bindingsChecked: 2, bindingsCovered: 2, coverage: 1 });
  });

  it('binds a `from` section against the array it names, and never checks `from` itself', async () => {
    const root = await project({
      'pages/index.view.json': JSON.stringify({
        route: 'index',
        sections: [{ kind: 'list', query: 'currentPlan', from: '$.mealsByDay', item: { title: '$.title' } }],
      }),
    });
    const res = await renderSmokeViews(root, { contracts: CONTRACTS, call: async () => ({ status: 200, body: BODY }) });
    // `$.mealsByDay` is the SOURCE path; measuring it against its own rows asks whether every meal
    // has a `mealsByDay` field, which no correct spec ever does.
    expect(res.errors).toEqual([]);
    expect(res.pages[0]).toMatchObject({ bindingsChecked: 1, bindingsCovered: 1 });
  });
});

describe('renderSmokeViews — dependent queries and scoped ids (S2, S3)', () => {
  const CONTRACTS = {
    endpoints: [
      { name: 'currentPlan', method: 'GET', routePath: '/plan', outputFields: ['plan'], inputKeys: [] },
      {
        name: 'shoppingList',
        method: 'GET',
        routePath: '/plan/:id/shopping',
        outputFields: ['items', 'ingredient'],
        inputKeys: ['id'],
      },
      { name: 'listPantry', method: 'GET', routePath: '/pantry', outputFields: ['id', 'name'], inputKeys: [] },
      { name: 'getRecipe', method: 'GET', routePath: '/recipes/:id', outputFields: ['id', 'title'], inputKeys: ['id'] },
      { name: 'listRecipes', method: 'GET', routePath: '/recipes', outputFields: ['id', 'title'], inputKeys: [] },
    ],
  } as never;

  it('resolves `$data.<section>.path` the way the renderer does (S2)', async () => {
    const root = await project({
      'pages/shopping.view.json': JSON.stringify({
        route: 'shopping',
        sections: [
          { kind: 'stats', id: 'plan', query: 'currentPlan', cards: [{ label: 'Plan', value: '$.plan.id' }] },
          {
            kind: 'list',
            query: 'shoppingList',
            input: { id: '$data.plan.plan.id' },
            from: '$.items',
            item: { title: '$.ingredient' },
          },
        ],
      }),
    });
    const seen: { name: string; input: unknown }[] = [];
    const res = await renderSmokeViews(root, {
      contracts: CONTRACTS,
      call: async (name, input) => {
        seen.push({ name, input });
        return name === 'currentPlan'
          ? { status: 200, body: { plan: { id: 'p1' } } }
          : { status: 200, body: { items: [{ ingredient: 'Basil' }] } };
      },
    });
    // The runner used to send route params ONLY, so a dependent query got `{}` and answered 400 —
    // four kitchen endpoints were reported broken that work in a browser.
    expect(seen.find((c) => c.name === 'shoppingList')?.input).toEqual({ id: 'p1' });
    expect(res.errors).toEqual([]);
  });

  it('scopes the id pool per collection, so a pantry id is never used as a recipe id (S3)', async () => {
    const root = await project({
      // `pantry` sorts before `recipes`, which is exactly how the flat first-write-wins pool got
      // an INGREDIENT id into `paramPool['id']` and then 404'd every `recipes/[id]` section.
      'pages/pantry.view.json': JSON.stringify({
        route: 'pantry',
        sections: [{ kind: 'list', query: 'listPantry', item: { title: '$.name' } }],
      }),
      'pages/recipes.view.json': JSON.stringify({
        route: 'recipes',
        sections: [{ kind: 'list', query: 'listRecipes', item: { title: '$.title' } }],
      }),
      'pages/recipes/[id].view.json': JSON.stringify({
        route: 'recipes/[id]',
        sections: [{ kind: 'detail', query: 'getRecipe', header: { title: '$.title' } }],
      }),
    });
    const seen: { name: string; input: unknown }[] = [];
    const res = await renderSmokeViews(root, {
      contracts: CONTRACTS,
      call: async (name, input) => {
        seen.push({ name, input });
        if (name === 'listPantry') return { status: 200, body: [{ id: 'ingredient-1', name: 'Basil' }] };
        if (name === 'listRecipes') return { status: 200, body: [{ id: 'recipe-1', title: 'Soup' }] };
        return (input as { id?: string })?.id === 'recipe-1'
          ? { status: 200, body: { id: 'recipe-1', title: 'Soup' } }
          : { status: 404, body: { error: 'not found' } };
      },
    });
    expect(seen.find((c) => c.name === 'getRecipe')?.input).toEqual({ id: 'recipe-1' });
    expect(res.errors).toEqual([]);
  });
});

describe('renderSmokeViews — an error body is not data (S4)', () => {
  const CONTRACTS = {
    endpoints: [
      { name: 'getRecipe', method: 'GET', routePath: '/recipes/:id', outputFields: ['id', 'title'], inputKeys: [] },
    ],
  } as never;

  const brokenPage = () =>
    project({
      'pages/index.view.json': JSON.stringify({
        route: 'index',
        sections: [{ kind: 'detail', query: 'getRecipe', header: { title: '$.title' } }],
      }),
    });

  it('never counts a non-2xx body as a row', async () => {
    const res = await renderSmokeViews(await brokenPage(), {
      contracts: CONTRACTS,
      call: async () => ({ status: 404, body: { error: 'not found' } }),
    });
    // `rowsOf({error:{…}})` yielded ONE row, which made `anyRows` true and the page "not empty".
    expect(res.pages[0].calls).toEqual([{ endpoint: 'getRecipe', status: 404, rows: 0, ok: false }]);
  });

  it('reports a page whose every endpoint 4xxs as NOT MEASURED, never as 100%', async () => {
    // The single worst defect in the set: with `bindingsChecked === 0` coverage defaulted to `1`
    // and `empty` to `false`, so the headline metric read PERFECT exactly where the app was most
    // broken. `recipes/[id]` and `trip/[planId]` both reported 100% while every call 404/400'd.
    const res = await renderSmokeViews(await brokenPage(), {
      contracts: CONTRACTS,
      call: async () => ({ status: 404, body: { error: 'not found' } }),
    });
    expect(res.pages[0].coverage).toBeNull();
    expect(res.pages[0].empty).toBeNull();
    expect(res.pages[0].unmeasured).toEqual([{ section: 0, endpoint: 'getRecipe', reason: 'answered 404' }]);
    expect(res.ok).toBe(false); // and it is still a FAILURE, from the render-error finding
  });

  it('keeps 0% distinct from not-measured', async () => {
    const res = await renderSmokeViews(await brokenPage(), {
      contracts: CONTRACTS,
      call: async () => ({ status: 200, body: { id: 'r1', title: null } }),
    });
    expect(res.pages[0].coverage).toBe(0);
    expect(res.pages[0].empty).toBe(true);
  });
});

/**
 * The gate half of the `30-bike-workshop` run-202 defect (the renderer half is
 * `libs/ui/src/view/render.test.tsx`, "a record section against an `{ items: [record] }` envelope").
 *
 * Two claims, and they pull in opposite directions — which is why both are pinned:
 *  - the gate must AGREE with the renderer about what a record section draws, or it reports a
 *    working page as broken and names the endpoint as the culprit;
 *  - one section that draws must never conceal a sibling that draws NOTHING, which is how a
 *    two-heading page can pass a whole-page emptiness check.
 */
describe('renderSmokeViews — a record section reads the `{ items: [record] }` envelope (S5)', () => {
  const CONTRACTS = {
    endpoints: [
      {
        name: 'shopDashboard',
        method: 'GET',
        routePath: '/shop-dashboard',
        outputFields: ['items', 'in_shop_count', 'total_parts_gbp', 'longest_waiting_bike_label'],
        inputKeys: [],
      },
      {
        name: 'listJobs',
        method: 'GET',
        routePath: '/jobs',
        outputFields: ['items', 'id', 'title'],
        inputKeys: [],
      },
    ],
  } as never;

  const dashboard = () =>
    project({
      'pages/index.view.json': JSON.stringify({
        route: 'index',
        sections: [
          {
            kind: 'stats',
            query: 'shopDashboard',
            cards: [
              { label: 'Bikes in shop', value: '$.in_shop_count' },
              { label: 'Total parts', value: '$.total_parts_gbp' },
            ],
          },
        ],
      }),
    });

  it('does not report a record the endpoint DID compute as an always-null binding', async () => {
    // The endpoint returns the envelope every generated handler returns. Measuring the bindings
    // against the ENVELOPE made both of them null, and `alwaysNullBinding` names the handler — so
    // `17-fix` would be sent to "fix" an endpoint that is already correct.
    const res = await renderSmokeViews(await dashboard(), {
      contracts: CONTRACTS,
      call: async () => ({ status: 200, body: { items: [{ in_shop_count: 3, total_parts_gbp: 148.49 }] } }),
    });
    expect(res.errors).toEqual([]);
    expect(res.pages[0]).toMatchObject({ bindingsChecked: 2, bindingsCovered: 2, coverage: 1, empty: false });
  });

  it('still reports a page whose only section draws nothing', async () => {
    const res = await renderSmokeViews(await dashboard(), {
      contracts: CONTRACTS,
      call: async () => ({ status: 200, body: { items: [{ in_shop_count: null, total_parts_gbp: null }] } }),
    });
    expect(res.pages[0].empty).toBe(true);
  });

  it('names the SECTION that drew nothing, even when a sibling section drew rows', async () => {
    // The masking case, and the reason a page-level verdict is not enough: `listJobs` returns
    // rows, so `bindingsCovered > 0` and the page is "not empty" — while the stats strip above it
    // renders as a bare heading, exactly what run 202's screenshot shows.
    const root = await project({
      'pages/index.view.json': JSON.stringify({
        route: 'index',
        sections: [
          { kind: 'stats', query: 'shopDashboard', cards: [{ label: 'Bikes in shop', value: '$.in_shop_count' }] },
          { kind: 'list', query: 'listJobs', item: { title: '$.title' } },
        ],
      }),
    });
    const res = await renderSmokeViews(root, {
      contracts: CONTRACTS,
      call: async (name) =>
        name === 'listJobs'
          ? { status: 200, body: { items: [{ id: 'j1', title: 'full service' }] } }
          : { status: 200, body: { items: [{ in_shop_count: null }] } },
    });
    expect(res.pages[0].empty).toBe(false); // the page as a whole is NOT empty…
    const finding = res.errors.find((e) => e.code === 'empty-render');
    expect(finding?.path).toBe('sections[0]'); // …and the dead section is still named
    expect(finding?.message).toBe(
      'pages/index sections[0]: this stats section draws NOTHING against live data — ' +
        '1 bound field(s), none of which had a value. Its heading is all a user sees. A bound value ' +
        'that resolves to nothing renders nothing, label and wrapper included (S1), so a section ' +
        'whose every binding is null is a heading over an empty box.',
    );
    expect(res.pages[0].emptySections).toEqual([
      { section: 0, kind: 'stats', reason: '1 bound field(s), none of which had a value' },
    ]);
  });

  it('does not call a section empty when the page is already reported empty as a whole', async () => {
    // One page, one finding: the page-level `empty-render` already says everything.
    const res = await renderSmokeViews(await dashboard(), {
      contracts: CONTRACTS,
      call: async () => ({ status: 200, body: { items: [] } }),
    });
    expect(res.errors.filter((e) => e.code === 'empty-render')).toHaveLength(1);
    expect(res.errors[0].path).toBe('');
  });
});

describe('chat.agent — the check a pattern cannot do', () => {
  /** `spaces/<space>/agents/<slug>/` is what the pod resolves a `spaceRef` against. */
  const withAgents = () =>
    project({
      'spaces/chef/agents/concierge/instruct.md': '# concierge',
      'spaces/chef/agents/pantry-keeper/instruct.md': '# pantry-keeper',
      'spaces/sourcing/agents/optimizer/instruct.md': '# optimizer',
      'api/recipes/GET.ts': HANDLER('listRecipes', ' id: string; '),
    });

  it('accepts a kebab-case slug that really exists', async () => {
    const root = await withAgents();
    const res = validateViewSpec(
      { route: 'index', sections: [{ kind: 'chat', agent: 'pantry-keeper', space: 'chef' }] },
      { ...loadViewContracts(root), routes: ['index'] },
    );
    expect(res.errors.filter((e) => e.code === 'unknown-agent')).toEqual([]);
  });

  it('names the real agents when the slug does not resolve', async () => {
    const root = await withAgents();
    const res = validateViewSpec(
      { route: 'index', sections: [{ kind: 'chat', agent: 'optimiser', space: 'sourcing' }] },
      { ...loadViewContracts(root), routes: ['index'] },
    );
    const e = res.errors.find((x) => x.code === 'unknown-agent');
    expect(e?.message).toBe(
      'sections[0].agent: "optimiser" is not an agent of the "sourcing" space. Did you mean optimizer? ' +
        'Agents: optimizer. Agents are directories under spaces/sourcing/agents/.',
    );
  });

  it('names the real spaces when the space does not resolve', async () => {
    const root = await withAgents();
    const res = validateViewSpec(
      { route: 'index', sections: [{ kind: 'chat', agent: 'optimizer', space: 'sourceing' }] },
      { ...loadViewContracts(root), routes: ['index'] },
    );
    expect(res.errors.find((x) => x.code === 'unknown-agent')?.message).toBe(
      'sections[0].space: "sourceing" is not a space in this project. Did you mean sourcing? ' +
        'Spaces: chef, sourcing. Spaces are directories under spaces/.',
    );
  });

  it('SKIPS a bare slug — that is the project\'s own top-level agent, not a space one', async () => {
    // `sessionBody` dispatches an unqualified name as `agentSlug`, not `spaceRef`, and nothing on
    // disk here enumerates those. Rejecting one would break a dock that works.
    const root = await withAgents();
    const res = validateViewSpec(
      { route: 'index', sections: [{ kind: 'chat', agent: 'anything-at-all' }] },
      { ...loadViewContracts(root), routes: ['index'] },
    );
    expect(res.errors).toEqual([]);
  });

  it('skips the check entirely when the project has no spaces/ dir', async () => {
    const root = await project({ 'api/recipes/GET.ts': HANDLER('listRecipes', ' id: string; ') });
    const res = validateViewSpec(
      { route: 'index', sections: [{ kind: 'chat', agent: 'nobody', space: 'nowhere' }] },
      { ...loadViewContracts(root), routes: ['index'] },
    );
    expect(res.errors).toEqual([]);
  });

  it('checks the shell assistant the same way', async () => {
    const root = await withAgents();
    const res = validateShellSpec(
      { nav: [{ route: 'index' }], assistant: { agent: 'concierge', space: 'sourcing' } },
      { ...loadViewContracts(root), routes: ['index'] },
    );
    expect(res.errors.find((e) => e.code === 'unknown-agent')?.path).toBe('assistant.agent');
  });
});

describe('renderSmokeViews — the render-error tier actually runs', () => {
  it('mounts the REAL ViewRenderer, rather than reporting the tier skipped', async () => {
    // T1 measured `rendererMounted: false` on every run: `@lmthing/cli` pins react@18 and
    // `@lmthing/ui` peers react@>=19, so a bare `import('react-dom/server')` drove a 19 component
    // tree with 18's renderer and every page threw `Cannot read properties of null (reading
    // 'useMemo')`. Resolving react + react-dom from the RENDERER's own location keeps both halves
    // in one instance. Two more mount requirements the wrapper already satisfies came out behind
    // it — the theme provider and a real client — so this asserts the whole tier, not one fix.
    const root = await project({
      'pages/index.view.json': JSON.stringify({
        route: 'index',
        sections: [{ kind: 'list', query: 'listRecipes', item: { title: '$.title' } }],
      }),
    });
    const res = await renderSmokeViews(root, {
      contracts: {
        endpoints: [
          { name: 'listRecipes', method: 'GET', routePath: '/recipes', outputFields: ['title'], inputKeys: [] },
        ],
      } as never,
      call: async () => ({ status: 200, body: [{ title: 'Soup' }] }),
    });
    expect(res.rendererMounted).toBe(true);
    expect(res.errors.filter((e) => e.code === 'render-error')).toEqual([]);
    expect(res.reason).toBeUndefined();
  });
});
