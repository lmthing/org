/**
 * The view-spec contract's own tests.
 *
 * Four things are being defended here, in order of how much they cost when broken:
 *  1. **The vocabularies are capped and coherent** — 8 section kinds (all pinned), 24
 *     elements, no `custom`, and the JSON Schema's branch lists identical to the exported
 *     `const` tuples (the TS unions are checked at compile time by §3's `AssertNever`).
 *  2. **Bindings are paths** — an accept/reject table over the full S3 namespace,
 *     including the expression attempts a weak model actually makes. A rejection here is
 *     the whole point: an expression must be a validation error, never a silent runtime
 *     nothing.
 *  3. **Everything defaults** — the minimum valid section is `{ kind: 'list', query: 'X' }`,
 *     and two realistic full pages validate clean.
 *  4. **The Wave-0 amendments are actually in the shape they were arbitrated in** —
 *     `poll`, `from`, `onSuccess`, `field`, `selectable`, the shell's groups/subnav, and
 *     `x-options` living on the endpoint side rather than here.
 *
 * Malformed specs are asserted on their **instance path**, because that path IS the model
 * interface: `validate.ts` turns `/sections/1/mutation` into
 * `sections[1].mutation: "addRecipies" is not an endpoint. Did you mean addRecipe?`.
 */

import { describe, it, expect } from 'vitest';
import {
  AGENT_NAME_RE,
  BINDING_RE,
  ELEMENT_KINDS,
  FIELD_KINDS,
  ICON_NAMES,
  MAX_SECTION_KINDS,
  PAGE_ARCHETYPES,
  SECTION_KINDS,
  SHELL_DERIVE_MAX_ROUTES,
  SHELL_SPEC_SCHEMA,
  STATIC_ROUTE_RE,
  VALUE_RE,
  VIEW_COMPONENT_SCHEMA,
  VIEW_SPEC_SCHEMA,
  X_OPTIONS_KEYWORD,
  X_OPTIONS_SCHEMA,
  isBinding,
  looksLikeExpression,
  readXOptions,
  validateShellShape,
  validateViewComponentShape,
  validateViewSpecShape,
  type JsonSchema,
  type ViewSpec,
} from './schema.js';

/** The `[instancePath, keyword]` pairs of a failed validation, for terse assertions. */
function paths(spec: unknown): [string, string][] {
  return validateViewSpecShape(spec).errors.map((e) => [e.instancePath, e.keyword]);
}

/** The `const` tag of every branch of a discriminated union in the schema. */
function branchTags(def: JsonSchema, tag: string): string[] {
  const oneOf = def['oneOf'] as JsonSchema[];
  return oneOf.map((b) => ((b['properties'] as Record<string, JsonSchema>)[tag] as JsonSchema)['const'] as string);
}

const DEFS = VIEW_SPEC_SCHEMA['$defs'] as Record<string, JsonSchema>;

/** The JSON Schema branch for one section kind. */
function sectionBranch(kind: string): JsonSchema {
  return (DEFS['section']['oneOf'] as JsonSchema[])[SECTION_KINDS.indexOf(kind as never)];
}

// ──────────────────────────────────────────────────────────────────────────────

describe('the capped vocabularies', () => {
  it('has all 8 section kinds pinned — timeline took the last slot', () => {
    expect(SECTION_KINDS.length).toBe(MAX_SECTION_KINDS);
    expect(SECTION_KINDS).toEqual([
      'list',
      'detail',
      'create',
      'stats',
      'markdown',
      'chat',
      'toolbar',
      'timeline',
    ]);
  });

  it('has no `custom` escape hatch — in either vocabulary', () => {
    expect(SECTION_KINDS as readonly string[]).not.toContain('custom');
    expect(ELEMENT_KINDS as readonly string[]).not.toContain('custom');
    for (const banned of ['react', 'html', 'raw', 'tsx', 'component']) {
      expect(SECTION_KINDS as readonly string[]).not.toContain(banned);
      expect(ELEMENT_KINDS as readonly string[]).not.toContain(banned);
    }
  });

  it('gives no way to author a loading state — those are renderer defaults', () => {
    // Three of the audit's five mapping passes proposed `skeleton`/`spinner`; all wrong.
    for (const banned of ['skeleton', 'spinner', 'loading', 'error']) {
      expect(ELEMENT_KINDS as readonly string[]).not.toContain(banned);
    }
    // `empty` survives as an OVERRIDE of a default that always exists.
    expect(ELEMENT_KINDS).toContain('empty');
  });

  it('is the audited 24-element catalogue: 5 cut, 1 added', () => {
    for (const cut of ['chip', 'avatar', 'code', 'quote', 'map']) {
      expect(ELEMENT_KINDS as readonly string[]).not.toContain(cut);
    }
    expect(ELEMENT_KINDS).toContain('field');
    expect(ELEMENT_KINDS.length).toBe(24);
    expect(new Set(ELEMENT_KINDS).size).toBe(ELEMENT_KINDS.length);
  });

  it('keeps the JSON Schema branch lists identical to the const tuples', () => {
    expect(branchTags(DEFS['section'], 'kind')).toEqual([...SECTION_KINDS]);
    expect(branchTags(DEFS['element'], 'el')).toEqual([...ELEMENT_KINDS]);
  });

  it('states `stack` as the explicit fallback archetype and keeps master-detail', () => {
    expect(PAGE_ARCHETYPES).toContain('stack');
    expect(PAGE_ARCHETYPES).toContain('master-detail');
    expect(PAGE_ARCHETYPES as readonly string[]).not.toContain('plain');
  });

  it('has a finite icon set — trimmed to 32, one hand-drawn SVG each', () => {
    // Inside the audit's empirical 24–67 band. lucide is web-only, so every name here is
    // real UI-RENDERER budget; an unknown one must be an error, never a blank square.
    expect(ICON_NAMES.length).toBe(32);
    expect(new Set(ICON_NAMES).size).toBe(ICON_NAMES.length);
  });

  it('has a finite field-control set', () => {
    expect(FIELD_KINDS).toEqual(['toggle', 'rating', 'select', 'stepper', 'text']);
  });

  it('never lets pagination in — measured demand is zero', () => {
    const list = sectionBranch('list');
    const keys = Object.keys(list['properties'] as object);
    for (const banned of ['page', 'cursor', 'hasMore', 'offset', 'pageSize']) {
      expect(keys).not.toContain(banned);
    }
    expect(keys).toContain('limit');
  });
});

// ──────────────────────────────────────────────────────────────────────────────

describe('the minimum valid spec — everything else has a renderer default', () => {
  it('accepts the minimum valid section: { kind: "list", query: "X" }', () => {
    const spec = { route: 'index', sections: [{ kind: 'list', query: 'listRecipes' }] };
    expect(validateViewSpecShape(spec)).toEqual({ ok: true, errors: [] });
  });

  it('accepts a minimum section of every one of the 8 kinds', () => {
    const minimal: Record<string, unknown>[] = [
      { kind: 'list', query: 'listRecipes' },
      { kind: 'detail', query: 'getRecipe' },
      { kind: 'create', mutation: 'addRecipe' },
      { kind: 'stats', query: 'getStats', cards: [{ label: 'Total', value: '$.total' }] },
      { kind: 'markdown' },
      { kind: 'chat', agent: 'sous' },
      { kind: 'toolbar' },
      { kind: 'timeline', from: '$.days' },
    ];
    // Exhaustive by construction — a new kind without a minimum form fails here.
    expect(minimal.map((s) => s['kind'])).toEqual([...SECTION_KINDS]);
    for (const section of minimal) {
      const res = validateViewSpecShape({ route: 'index', sections: [section] });
      expect(res.errors, `minimum ${String(section['kind'])} section`).toEqual([]);
    }
  });

  it('requires a route and at least one section — a page with nothing on it is a bug', () => {
    expect(paths({ sections: [{ kind: 'list', query: 'x' }] })).toContainEqual(['', 'required']);
    expect(paths({ route: 'index', sections: [] })).toContainEqual(['/sections', 'minItems']);
  });

  it('still rejects a collection section with no source at all', () => {
    // `query` left the required list so `from` can source a section, but one of the two
    // must be there — otherwise the section renders nothing and no gate says why.
    expect(paths({ route: 'index', sections: [{ kind: 'list' }] })).toContainEqual(['/sections/0', 'anyOf']);
    expect(paths({ route: 'index', sections: [{ kind: 'timeline' }] })).toContainEqual(['/sections/0', 'anyOf']);
  });

  it('accepts a page with no layout, no title, and no item shape', () => {
    expect(validateViewSpecShape({ route: 'index', sections: [{ kind: 'list', query: 'listRecipes' }] }).ok).toBe(true);
  });

  it('accepts an entirely empty shell — nav is derived from the route list', () => {
    expect(validateShellShape({}).ok).toBe(true);
    expect(SHELL_DERIVE_MAX_ROUTES).toBe(5);
  });
});

// ──────────────────────────────────────────────────────────────────────────────

describe('bindings are PATHS, never expressions (the S3 namespace)', () => {
  const ACCEPT = [
    // $ — the current scope
    '$',
    '$.name',
    '$.recipe.title',
    '$.tags[0]',
    '$.a.b.c.d',
    '$._private',
    // $props — a component's declared props
    '$props.recipe',
    '$props.recipe.title',
    // $route — route parameters
    '$route.id',
    '$route.tripId',
    // $data — another section's result (the dependent-query root)
    '$data.currentPlan.plan.id',
    '$data.stats.total',
    // $result — the Output of the mutation that just succeeded
    '$result.id',
    '$result.note',
    // $form — the current form's values, for a prefill input
    '$form.brief',
    // $client — exactly one path
    '$client.timezone',
  ];

  const REJECT = [
    // template interpolation — the single most likely weak-model attempt
    '{{ recipe.name }}',
    '{{ status === "done" ? "Done" : "Open" }}',
    '${recipe.name}',
    '/searches/$result.id/inbox',
    // conditionals + operators
    '$.status ? "on" : "off"',
    '$.a + $.b',
    '$.a || $.b',
    '$.a ?? $.b',
    '$.total * 1.2',
    '$.a === "x"',
    '!$.endedAt',
    // calls
    '$.items.map(i => i.name)',
    '$.name.toUpperCase()',
    'format($.total)',
    // optional chaining / non-path punctuation
    '$.a?.b',
    '$.a-b',
    '$.items[$.i]',
    '$.a b',
    // bare roots that address nothing, and roots that do not exist
    '$props',
    '$data',
    '$route',
    '$result',
    '$form',
    '$client',
    '$params.id', // the OLD name for $route — must not silently keep working
    '$state.open',
    '$selection.ids',
    '$client.locale', // $client is a menu of exactly one
    '$client.now',
    '$_private.x',
    // not a binding at all
    'recipe.name',
    '',
  ];

  it.each(ACCEPT)('accepts the path %j', (s) => {
    expect(BINDING_RE.test(s)).toBe(true);
    expect(isBinding(s)).toBe(true);
  });

  it.each(REJECT)('rejects the expression attempt %j', (s) => {
    expect(BINDING_RE.test(s)).toBe(false);
  });

  it('flags expression attempts distinctly from typos — that is the menu-shaped error', () => {
    // An expression: the language has none. `validate.ts` points at a built-in, a
    // `toneMap`, a `poll.while`, or the endpoint layer.
    expect(looksLikeExpression('{{ a ? b : c }}')).toBe(true);
    expect(looksLikeExpression('$.a + $.b')).toBe(true);
    expect(looksLikeExpression('${x}')).toBe(true);
    expect(looksLikeExpression('$.a?.b')).toBe(true);
    expect(looksLikeExpression('$params.id')).toBe(true);
    // A literal, not an attempt at anything.
    expect(looksLikeExpression('Total')).toBe(false);
    expect(looksLikeExpression('Cost: $5')).toBe(false);
    // A well-formed path.
    expect(looksLikeExpression('$.total')).toBe(false);
    expect(looksLikeExpression('$client.timezone')).toBe(false);
  });

  it('lets a value be a literal OR a binding, but never an interpolation', () => {
    for (const s of ['Total', 'Cost: $5', 'Save $.50', 'a $ sign', '$.total', '$props.x', '$result.id', '', 'line1\nline2']) {
      expect(VALUE_RE.test(s), `value ${JSON.stringify(s)}`).toBe(true);
    }
    for (const s of [
      '{{ total }}',
      '${total}',
      '$.a + 1',
      'Total: {{ n }}',
      'x\n{{ y }}',
      // an embedded binding root in a literal is an interpolation attempt too — a value
      // that renders "/trips/$result.id" verbatim is never what anyone meant
      '/trips/$result.id',
      'Open $.name now',
    ]) {
      expect(VALUE_RE.test(s), `value ${JSON.stringify(s)}`).toBe(false);
    }
  });

  it('rejects an expression inside a spec, at the offending instance path', () => {
    expect(
      paths({
        route: 'index',
        sections: [{ kind: 'list', query: 'listRecipes', item: { title: '{{ recipe.name }}' } }],
      }),
    ).toContainEqual(['/sections/0/item/title', 'pattern']);

    expect(
      paths({
        route: 'index',
        sections: [{ kind: 'list', query: 'listPlans', input: { id: '$data.currentPlan.plan.id || 1' } }],
      }),
    ).toContainEqual(['/sections/0/input/id', 'pattern']);

    expect(
      paths({
        route: 'index',
        sections: [
          { kind: 'stats', query: 'getStats', cards: [{ label: 'Spend', value: '$.a * 1.2', format: 'currency' }] },
        ],
      }),
    ).toContainEqual(['/sections/0/cards/0/value', 'pattern']);
  });

  it('rejects the route-template form of a post-create redirect', () => {
    // T0 sketched `navigate: '/searches/$result.id/inbox'`. That is interpolation, so it
    // fails — the supported spelling is a route plus bound `params`, below.
    const res = validateViewSpecShape({
      route: 'new',
      sections: [
        { kind: 'create', mutation: 'createSearch', onSuccess: { navigate: '/searches/$result.id/inbox' } },
      ],
    });
    expect(res.ok).toBe(false);
    expect(res.errors.map((e) => e.instancePath)).toContain('/sections/0/onSuccess/navigate');
  });
});

// ──────────────────────────────────────────────────────────────────────────────

describe('the Wave-0 amendments, in the shape they were arbitrated', () => {
  const wrap = (section: Record<string, unknown>) =>
    validateViewSpecShape({ route: 'index', sections: [section] });

  it('poll: { everyMs, while: { field, in } } on every query-bearing section', () => {
    const poll = { everyMs: 2500, while: { field: '$.status', in: ['pending', 'parsing'] } };
    for (const s of [
      { kind: 'list', query: 'listCaptures', poll },
      { kind: 'detail', query: 'getTrip', poll },
      { kind: 'stats', query: 'getStats', cards: [{ label: 'A', value: '$.a' }], poll },
      { kind: 'markdown', query: 'getTakes', value: '$.body', poll },
      { kind: 'timeline', from: '$.days', poll },
    ]) {
      expect(wrap(s).errors, `poll on ${String(s.kind)}`).toEqual([]);
    }
    // `while` is membership in a finite set — not a predicate, not an operator.
    expect(paths({ route: 'index', sections: [{ kind: 'list', query: 'x', poll: { everyMs: 2500, while: { field: '$.status', op: 'eq', value: 'pending' } } }] })).toContainEqual([
      '/sections/0/poll/while',
      'additionalProperties',
    ]);
    // …and it is not spellable as an expression either.
    expect(paths({ route: 'index', sections: [{ kind: 'list', query: 'x', poll: { everyMs: 1000, while: { field: "$.status === 'pending'", in: [true] } } }] })).toContainEqual([
      '/sections/0/poll/while/field',
      'pattern',
    ]);
  });

  it('from: sources a section from an embedded array, with or without its own query', () => {
    // Own Output (`getArticle` → `citations[]`).
    expect(wrap({ kind: 'list', id: 'citations', query: 'getArticle', param: '$route.articleId', from: '$.citations' }).errors).toEqual([]);
    // Another section's Output — no query at all, no extra round trip.
    expect(wrap({ kind: 'timeline', id: 'week', from: '$data.currentPlan.plan.days', group: '$.day', groupFormat: 'date' }).errors).toEqual([]);
    // Still a path, never an expression.
    expect(paths({ route: 'index', sections: [{ kind: 'list', from: '$.items.filter(x => x.ok)' }] })).toContainEqual([
      '/sections/0/from',
      'pattern',
    ]);
  });

  it('onSuccess navigates after a mutation ANYWHERE — including post-delete', () => {
    // post-create, with the new record's id out of $result
    expect(
      wrap({
        kind: 'create',
        mutation: 'createSearch',
        onSuccess: { navigate: 'searches/[searchId]/inbox', params: { searchId: '$result.id' } },
      }).errors,
    ).toEqual([]);
    // post-delete from a detail action — the harder half: you cannot stay where you were
    expect(
      wrap({
        kind: 'detail',
        query: 'getTrip',
        actions: [
          {
            label: 'Delete trip',
            action: {
              mutate: 'deleteTrip',
              input: { id: '$route.tripId' },
              confirm: 'Delete this trip?',
              onSuccess: { navigate: 'index' },
            },
          },
        ],
      }).errors,
    ).toEqual([]);
    // …and from a row action
    expect(
      wrap({
        kind: 'list',
        query: 'listTravelers',
        rowAction: { mutate: 'removeTraveler', input: { id: '$.id' }, onSuccess: { navigate: 'travelers' } },
      }).errors,
    ).toEqual([]);
  });

  it('the client actions: download / print / copy', () => {
    expect(
      wrap({
        kind: 'toolbar',
        actions: [
          { label: 'Export OPML', action: { download: 'exportOpml', filename: 'sources.opml' } },
          { label: 'Print', action: { print: true } },
          { label: 'Copy summary', action: { copy: '$.summary' } },
        ],
      }).errors,
    ).toEqual([]);
    // `download` names an ENDPOINT, never a URL.
    expect(
      paths({
        route: 'index',
        sections: [{ kind: 'toolbar', actions: [{ label: 'x', action: { download: 'https://x/y.ics' } }] }],
      }),
    ).toContainEqual(['/sections/0/actions/0/action/download', 'pattern']);
  });

  it('field: the inline per-row mutation carrying its row argument (I1)', () => {
    expect(
      wrap({
        kind: 'list',
        query: 'listShoppingItems',
        item: {
          el: 'row',
          children: [
            {
              el: 'field',
              kind: 'toggle',
              value: '$.done',
              mutation: 'setShoppingItemDone',
              arg: 'done',
              input: { id: '$.id' },
              invalidates: ['listShoppingItems'],
            },
            { el: 'text', text: '$.name' },
          ],
        },
      }).errors,
    ).toEqual([]);
    // every control kind
    for (const kind of FIELD_KINDS) {
      expect(wrap({ kind: 'list', query: 'x', item: { el: 'field', kind, value: '$.v', mutation: 'setV' } }).errors).toEqual([]);
    }
  });

  it('selectable + bulk commit over the selection (I5)', () => {
    expect(
      wrap({
        kind: 'list',
        id: 'proposed',
        query: 'listProposedActions',
        selectable: true,
        bulkActions: [
          { label: 'Accept selected', action: { mutate: 'commitActions', over: 'selection', arg: 'ids', input: { logId: '$route.id' } } },
        ],
      }).errors,
    ).toEqual([]);
  });

  it('sort options and faceted counts (I3)', () => {
    expect(
      wrap({
        kind: 'list',
        query: 'listingFeed',
        sort: [
          { label: 'Newest', field: '$.createdAt', dir: 'desc' },
          { label: 'Cheapest', field: '$.price', dir: 'asc' },
        ],
        facet: [{ field: '$.tags', label: 'Tag', counts: true }],
      }).errors,
    ).toEqual([]);
  });

  it('value-driven tone via a declared toneMap (A1) — a lookup, not a predicate', () => {
    expect(
      wrap({
        kind: 'list',
        query: 'listTriage',
        item: {
          el: 'badge',
          text: '$.severity',
          toneOf: '$.severity',
          toneMap: { self_care: 'success', routine: 'info', urgent: 'warning', emergency: 'danger' },
          tone: 'neutral',
        },
      }).errors,
    ).toEqual([]);
    // a tone outside the menu is rejected with the menu attached
    const res = wrap({ kind: 'list', query: 'x', item: { el: 'badge', text: '$.s', toneMap: { a: 'red' } } });
    expect(res.errors.find((e) => e.keyword === 'enum')?.instancePath).toBe('/sections/0/item/toneMap/a');
  });

  it('scroll: "x" on the three elements that clip on a phone (A4)', () => {
    for (const el of [
      { el: 'row', scroll: 'x', children: [] },
      { el: 'grid', scroll: 'x', columns: 7 },
      { el: 'table', scroll: 'x', rows: '$.rows', columns: [{ label: 'A', value: '$.a' }] },
    ]) {
      expect(wrap({ kind: 'list', query: 'x', item: el }).errors, JSON.stringify(el)).toEqual([]);
    }
  });

  it('text.strike — a done shopping item, a packed bag, a superseded price', () => {
    expect(
      wrap({
        kind: 'list',
        query: 'listShoppingItems',
        item: { el: 'text', text: '$.name', strike: true, dim: true },
      }).errors,
    ).toEqual([]);
  });

  it('nav badge counts are a resolvable data source, not a free binding', () => {
    expect(
      validateShellShape({
        nav: [{ route: 'alerts', label: 'Alerts', icon: 'bell', badge: { query: 'unreadCount', field: '$.unread' } }],
        groups: [{ label: 'Signals', home: 'signals', badge: { query: 'signalCount', field: '$.pending' } }],
        subnav: [
          {
            match: 'searches/[searchId]',
            items: [
              { route: 'searches/[searchId]/inbox', label: 'Inbox', badge: { query: 'pendingCaptures', field: '$.count' } },
            ],
          },
        ],
      }),
    ).toEqual({ ok: true, errors: [] });
    // it names an ENDPOINT — the shell has no section scope to bind against
    const res = validateShellShape({ nav: [{ route: 'alerts', badge: { query: 'unreadCount' } }] });
    expect(res.ok).toBe(false);
    expect(res.errors.map((e) => e.keyword)).toContain('required');
  });

  it('the widened format enum, with a per-row currency field (A7)', () => {
    for (const format of ['currency', 'date', 'datetime', 'time', 'relative-time', 'number', 'percent', 'humanize']) {
      expect(wrap({ kind: 'list', query: 'x', item: { el: 'text', text: '$.v', format } }).errors, format).toEqual([]);
    }
    expect(
      wrap({ kind: 'list', query: 'x', item: { el: 'text', text: '$.amount', format: 'currency', currencyField: '$.currency' } })
        .errors,
    ).toEqual([]);
  });
});

// ──────────────────────────────────────────────────────────────────────────────

describe('the flat item — sized so an ordinary row never needs an element tree', () => {
  const item = (i: unknown) => validateViewSpecShape({ route: 'index', sections: [{ kind: 'list', query: 'x', item: i }] });

  it('still accepts the one-key minimum', () => {
    expect(item({ title: '$.name' })).toEqual({ ok: true, errors: [] });
  });

  it('expresses T0`s real rows — every measured key, in one item', () => {
    // trips/expenses + homes/inbox + blog/feed, merged: this is the shape the desk check
    // actually needed, and every key here came from a shipped page.
    expect(
      item({
        image: '$.imageUrl',
        icon: 'tag',
        title: '$.description',
        subtitle: '$.paidByName',
        caption: '$.url',
        meta: { value: '$.capturedAt', format: 'relative-time' },
        value: { value: '$.amount', format: 'currency', currencyField: '$.currency' },
        suffix: '$.currency',
        note: '$.blockedNote',
        markdown: '$.summary',
        badge: '$.category',
        status: { value: '$.status', tone: 'auto' },
        badges: '$.tags',
        keyvalue: [{ label: 'Dose', value: '$.dose' }],
        action: { navigate: 'expenses/[id]', params: { id: '$.id' } },
        actions: [{ label: 'Remove', action: { mutate: 'removeExpense', input: { id: '$.id' } } }],
      }),
    ).toEqual({ ok: true, errors: [] });
  });

  it('takes a modifier on ANY key via the object form — no metaFormat/captionFormat pairs', () => {
    for (const key of ['title', 'subtitle', 'caption', 'meta', 'value', 'suffix', 'note', 'markdown', 'badge', 'status', 'image']) {
      // string form
      expect(item({ [key]: '$.x' }).errors, `${key} as a string`).toEqual([]);
      // object form with the full modifier set
      expect(
        item({ [key]: { value: '$.x', format: 'currency', currencyField: '$.cur', tone: 'auto', maxLines: 2 } }).errors,
        `${key} as an object`,
      ).toEqual([]);
    }
    // …and the paired spelling stays absent, so there is exactly one way to say it
    const flat = (VIEW_SPEC_SCHEMA['$defs'] as Record<string, JsonSchema>)['flatItem'];
    const keys = Object.keys(flat['properties'] as object);
    for (const paired of ['metaFormat', 'captionFormat', 'titleFormat', 'valueFormat', 'format']) {
      expect(keys).not.toContain(paired);
    }
  });

  it('stays CLOSED — an invented key errors against the finite menu', () => {
    const res = item({ title: '$.name', headline: '$.other' });
    expect(res.ok).toBe(false);
    const err = res.errors.find((e) => e.keyword === 'additionalProperties');
    expect(err?.instancePath).toBe('/sections/0/item');
    expect(err?.params).toMatchObject({ additionalProperty: 'headline' });
    // The menu the error is graded against — `validate.ts` reads it off the schema.
    const flat = (VIEW_SPEC_SCHEMA['$defs'] as Record<string, JsonSchema>)['flatItem'];
    expect(Object.keys(flat['properties'] as object)).toEqual([
      'title',
      'subtitle',
      'caption',
      'meta',
      'value',
      'suffix',
      'note',
      'markdown',
      'badge',
      'status',
      'image',
      'icon',
      'badges',
      'keyvalue',
      'action',
      'actions',
    ]);
  });

  it('never lets an expression in through the object form', () => {
    expect(item({ meta: { value: '$.a + $.b', format: 'number' } }).ok).toBe(false);
    expect(item({ badges: '$.tags.join(", ")' }).ok).toBe(false);
  });
});

// ──────────────────────────────────────────────────────────────────────────────

describe('the Wave-2 amendments — the four things the T1 migration could not say', () => {
  const wrapSection = (s: unknown) => validateViewSpecShape({ route: 'index', sections: [s] });
  const item = (i: unknown) => wrapSection({ kind: 'list', query: 'x', item: i });

  describe('1. literal arguments (BLOCKING) — an argument is a constant OR a binding', () => {
    it('accepts a literal argument where only a path was legal before', () => {
      // The kitchen case: a constant that used to have to live in an endpoint default.
      expect(wrapSection({ kind: 'list', query: 'listMeals', input: { meal: 'dinner' } }).errors).toEqual([]);
      expect(wrapSection({ kind: 'list', query: 'listMeals', input: { withinDays: 7 } }).errors).toEqual([]);
      expect(wrapSection({ kind: 'list', query: 'listMeals', input: { includePast: false } }).errors).toEqual([]);
    });

    it('still accepts a binding argument — nothing about dependent queries changed', () => {
      expect(wrapSection({ kind: 'list', query: 'listMeals', input: { id: '$.id' } }).errors).toEqual([]);
      expect(
        wrapSection({ kind: 'list', query: 'listMeals', input: { id: '$data.currentPlan.plan.id' } }).errors,
      ).toEqual([]);
    });

    it('still rejects an expression — the widening is not a back-door', () => {
      const res = wrapSection({ kind: 'list', query: 'x', input: { x: '$.a + $.b' } });
      expect(res.ok).toBe(false);
      expect(res.errors.map((e) => e.instancePath)).toContain('/sections/0/input/x');
      for (const bad of ['$.a ?? $.b', '${x}', '{{ count }}', 'Total {{ count }}', '/trips/$result.id']) {
        expect(wrapSection({ kind: 'list', query: 'x', input: { x: bad } }).ok, bad).toBe(false);
      }
    });

    it('a constant is a SCALAR — an object, an array or a null is a type error', () => {
      for (const bad of [{ nested: 1 }, [1, 2], null]) {
        const res = wrapSection({ kind: 'list', query: 'x', input: { x: bad } });
        expect(res.ok, JSON.stringify(bad)).toBe(false);
        expect(res.errors.map((e) => e.keyword)).toContain('type');
      }
    });

    it('expresses the blog case that was inexpressible: ONE endpoint, THREE constants', () => {
      // Three buttons, one `explainArticle` mutation, a different `style` each. Before this
      // amendment there was no way to write it at all — endpoint defaults take one value.
      expect(
        wrapSection({
          kind: 'toolbar',
          actions: [
            { label: 'TL;DR', action: { mutate: 'explainArticle', input: { id: '$route.articleId', style: 'tldr' } } },
            { label: 'ELI5', action: { mutate: 'explainArticle', input: { id: '$route.articleId', style: 'eli5' } } },
            { label: 'Why me', action: { mutate: 'explainArticle', input: { id: '$route.articleId', style: 'why-me' } } },
          ],
        }).errors,
      ).toEqual([]);
    });

    it('widens EVERY argument map, not just a section input', () => {
      const sites: [string, unknown][] = [
        ['mutate.input', { kind: 'toolbar', actions: [{ label: 'Go', action: { mutate: 'm', input: { s: 'tldr' } } }] }],
        ['navigate.params', { kind: 'list', query: 'x', rowAction: { navigate: 'feed/[tab]', params: { tab: 'all' } } }],
        ['download.input', { kind: 'toolbar', actions: [{ label: 'Export', action: { download: 'exportIcs', input: { scope: 'week' } } }] }],
        ['create.input', { kind: 'create', mutation: 'addRecipe', input: { source: 'web' } }],
        ['prefill.input', { kind: 'create', mutation: 'addRecipe', prefill: { endpoint: 'e', input: { mode: 'draft' } } }],
        ['detail.input', { kind: 'detail', query: 'getRecipe', input: { expand: true } }],
        ['stats.input', { kind: 'stats', query: 's', input: { window: 30 }, cards: [{ label: 'L', value: '$.v' }] }],
        ['markdown.input', { kind: 'markdown', query: 'q', input: { section: 'intro' }, value: '$.body' }],
        ['timeline.input', { kind: 'timeline', query: 'q', input: { day: 'today' } }],
        ['field.input', { kind: 'list', query: 'x', item: { el: 'field', kind: 'toggle', value: '$.done', mutation: 'm', input: { list: 'shopping' } } }],
        ['link.params', { kind: 'list', query: 'x', item: { el: 'link', text: 'Open', to: 'feed/[tab]', params: { tab: 'all' } } }],
      ];
      for (const [name, section] of sites) {
        expect(wrapSection(section).errors, name).toEqual([]);
      }
    });

    it('carries the same rule into the endpoint-side x-options annotation', () => {
      const inputSchema = (X_OPTIONS_SCHEMA['properties'] as Record<string, JsonSchema>)['input'];
      const values = inputSchema['additionalProperties'] as JsonSchema;
      expect(values['type']).toEqual(['string', 'number', 'boolean']);
    });
  });

  describe('2. chat.agent takes a real agent slug', () => {
    it('accepts the kebab-case slugs this codebase actually uses', () => {
      for (const agent of ['pantry-keeper', 'data-modeler', 'spec-builder', 'thing', 'sous']) {
        expect(wrapSection({ kind: 'chat', agent }).errors, agent).toEqual([]);
        expect(validateShellShape({ assistant: { agent } }).errors, `${agent} (shell)`).toEqual([]);
      }
      expect(AGENT_NAME_RE.test('pantry-keeper')).toBe(true);
    });

    it('still keeps a URL, a path or a sentence out of the field', () => {
      for (const bad of ['https://example.com', 'agents/sous', 'pantry keeper', '-leading', '']) {
        expect(wrapSection({ kind: 'chat', agent: bad }).ok, bad).toBe(false);
        expect(AGENT_NAME_RE.test(bad), bad).toBe(false);
      }
    });
  });

  describe('3. a nav group’s highlight family may be parameterised', () => {
    it('accepts a drill-in route as a family member — the kitchen /trip/:planId case', () => {
      expect(
        validateShellShape({
          groups: [{ label: 'Shop', home: 'shop', routes: ['shopping', 'trip/[planId]'], icon: 'list' }],
        }).errors,
      ).toEqual([]);
    });

    it('but a DESTINATION is still static — the two roles stay split', () => {
      expect(validateShellShape({ groups: [{ label: 'Feed', home: 'feed/[articleId]' }] }).ok).toBe(false);
      expect(validateShellShape({ nav: [{ route: 'feed/[articleId]' }] }).ok).toBe(false);
      const groups = (SHELL_SPEC_SCHEMA['properties'] as Record<string, JsonSchema>)['groups'] as JsonSchema;
      const props = ((groups['items'] as JsonSchema)['properties'] as Record<string, JsonSchema>);
      expect(props['home']).toEqual({ $ref: '#/$defs/staticRoute' });
      expect(props['routes']).toEqual({ type: 'array', items: { $ref: '#/$defs/route' } });
    });
  });

  describe('4. a unit on any flat value', () => {
    it('puts "min" on a meta figure — the shipped page said "20 min", not "20"', () => {
      expect(item({ title: '$.name', meta: { value: '$.prepMinutes', suffix: 'min' } }).errors).toEqual([]);
    });

    it('rides on EVERY text-ish key, and takes a binding as readily as a literal', () => {
      for (const key of ['title', 'subtitle', 'caption', 'meta', 'value', 'suffix', 'note', 'markdown', 'badge', 'status', 'image']) {
        expect(item({ [key]: { value: '$.x', suffix: 'min' } }).errors, `${key} + literal suffix`).toEqual([]);
        expect(item({ [key]: { value: '$.x', suffix: '$.unit' } }).errors, `${key} + bound suffix`).toEqual([]);
      }
    });

    it('adds NO `<key>Suffix` family — that is the explosion the object form prevents', () => {
      const res = item({ meta: '$.prepMinutes', metaSuffix: 'min' });
      expect(res.ok).toBe(false);
      expect(res.errors.find((e) => e.keyword === 'additionalProperties')?.params).toMatchObject({
        additionalProperty: 'metaSuffix',
      });
      const flat = DEFS['flatItem'];
      for (const paired of ['metaSuffix', 'captionSuffix', 'titleSuffix', 'noteSuffix']) {
        expect(Object.keys(flat['properties'] as object)).not.toContain(paired);
      }
    });

    it('is a Value, so it lets no expression in either', () => {
      expect(item({ meta: { value: '$.prepMinutes', suffix: '$.a + $.b' } }).ok).toBe(false);
      expect(item({ meta: { value: '$.prepMinutes', suffix: '{{ unit }}' } }).ok).toBe(false);
    });
  });

  describe('5. an endpoint name takes the same kebab-case AGENT_NAME_PATTERN as an agent slug', () => {
    it('accepts a kebab-case query/mutation — plan_endpoints names endpoints this way', () => {
      expect(wrapSection({ kind: 'list', query: 'list-plants' }).errors).toEqual([]);
      expect(wrapSection({ kind: 'create', mutation: 'create-plant' }).errors).toEqual([]);
      expect(wrapSection({ kind: 'detail', query: 'get-plant' }).errors).toEqual([]);
      expect(
        wrapSection({ kind: 'create', mutation: 'create-plant', invalidates: ['list-plants'] }).errors,
      ).toEqual([]);
      expect(
        wrapSection({
          kind: 'create',
          mutation: 'create-plant',
          prefill: { endpoint: 'get-plant-defaults' },
        }).errors,
      ).toEqual([]);
    });

    it('still keeps a section id strict — REVEALS/id are model-chosen, not codebase names', () => {
      expect(wrapSection({ kind: 'toolbar', reveals: ['filters-panel'] }).ok).toBe(false);
      expect(wrapSection({ kind: 'toolbar', reveals: ['filtersPanel'] }).errors).toEqual([]);
    });
  });
});

// ──────────────────────────────────────────────────────────────────────────────

describe('x-options lives on the ENDPOINT side, not in the view schema', () => {
  it('is not a view-spec property — a `create` section still declares nothing', () => {
    const create = sectionBranch('create');
    const keys = Object.keys(create['properties'] as object);
    expect(keys).not.toContain('fields');
    expect(keys).not.toContain('options');
    expect(keys).not.toContain(X_OPTIONS_KEYWORD);
  });

  it('defines the annotation shape the api author writes and the form reads', () => {
    expect(X_OPTIONS_KEYWORD).toBe('x-options');
    expect(X_OPTIONS_SCHEMA['required']).toEqual(['query', 'label', 'value']);
    const parsed = readXOptions({
      type: 'string',
      'x-options': { query: 'listTravelers', input: { id: '$route.tripId' }, label: '$.name', value: '$.id' },
    });
    expect(parsed).toEqual({
      query: 'listTravelers',
      input: { id: '$route.tripId' },
      label: '$.name',
      value: '$.id',
    });
    expect(readXOptions({ type: 'string' })).toBeUndefined();
    expect(readXOptions(undefined)).toBeUndefined();
  });
});

// ──────────────────────────────────────────────────────────────────────────────

describe('the shell', () => {
  it('accepts a flat nav for a small app', () => {
    expect(validateShellShape({ brand: 'Trips', nav: [{ route: 'index', icon: 'home' }, { route: 'new' }] }).ok).toBe(
      true,
    );
  });

  it('never lets a parameterised route become a nav item', () => {
    expect(STATIC_ROUTE_RE.test('searches')).toBe(true);
    expect(STATIC_ROUTE_RE.test('searches/[searchId]')).toBe(false);
    const res = validateShellShape({ nav: [{ route: 'feed/[articleId]' }] });
    expect(res.ok).toBe(false);
    expect(res.errors[0]?.instancePath).toBe('/nav/0/route');
    expect(validateShellShape({ groups: [{ label: 'Feed', home: 'feed/[articleId]' }] }).ok).toBe(false);
  });

  it('accepts declared groups — the honest answer above 5 routes', () => {
    expect(
      validateShellShape({
        brand: 'Kitchen',
        groups: [
          { label: 'Cook', home: 'index', icon: 'home' },
          { label: 'Recipes', home: 'recipes', icon: 'file' },
          { label: 'Shop', home: 'shop', routes: ['shopping', 'trip'], icon: 'list' },
          { label: 'Insights', home: 'insights', routes: ['nutrition', 'expiring'], icon: 'chart' },
        ],
        assistant: { agent: 'chef', greeting: 'Ask me about this week' },
      }),
    ).toEqual({ ok: true, errors: [] });
  });

  it('accepts an entity-scoped subnav declared ONCE per route family', () => {
    expect(
      validateShellShape({
        subnav: [
          {
            match: 'trips/[tripId]',
            groups: [
              {
                label: 'Plan',
                items: [
                  { route: 'trips/[tripId]/timeline', label: 'Timeline' },
                  { route: 'trips/[tripId]/packing', label: 'Packing' },
                ],
              },
              { label: 'Money', items: [{ route: 'trips/[tripId]/expenses', label: 'Expenses' }] },
            ],
          },
          { match: 'searches/[searchId]', items: [{ route: 'searches/[searchId]/inbox', label: 'Inbox' }] },
        ],
      }),
    ).toEqual({ ok: true, errors: [] });
  });

  it('rejects a subnav that navigates nowhere', () => {
    const res = validateShellShape({ subnav: [{ match: 'trips/[tripId]' }] });
    expect(res.ok).toBe(false);
    expect(res.errors.map((e) => e.keyword)).toContain('anyOf');
  });
});

// ──────────────────────────────────────────────────────────────────────────────

describe('a full, realistic page spec', () => {
  /**
   * The kitchen dashboard shape from the plan's grounding, re-derived from T0's P2 desk
   * check: a stats strip, a toolbar that reveals a create form, a dependent list, a
   * component-referenced item, an async import with prefill, a day-grouped timeline, and
   * an assistant dock. Nothing here is invented — every feature is one B1, AUDIT or T0
   * names, and the section ORDER is the model's (hero first, stats fourth), which no
   * archetype may change.
   */
  const spec: ViewSpec = {
    route: 'index',
    title: 'Kitchen',
    // no `layout` — the archetype is predicted from the composition
    sections: [
      {
        kind: 'detail',
        id: 'tonight',
        query: 'currentPlan',
        input: { tz: '$client.timezone' },
        poll: { everyMs: 4000, while: { field: '$.plan.status', in: ['planning'] } },
        header: { use: 'TonightCard', props: { meal: '$.tonight' } },
      },
      {
        kind: 'toolbar',
        id: 'plannerBar',
        reveals: ['addRecipe'],
        actions: [
          { label: 'Shopping list', action: { navigate: 'shopping' }, icon: 'list' },
          { label: 'Regenerate plan', action: { mutate: 'regeneratePlan', invalidates: ['getWeekStats'] }, icon: 'refresh' },
          { label: 'Add a meal', reveals: ['addMeal'] },
        ],
      },
      {
        kind: 'timeline',
        id: 'week',
        from: '$data.tonight.plan.days',
        group: '$.day',
        groupFormat: 'date',
        item: { title: '$.recipe.title', meta: '$.meal' },
        itemTime: '$.startTime',
        itemNote: '$.rationale',
        rowActions: [
          { label: 'Cooked', action: { mutate: 'markCooked', input: { id: '$.id' }, invalidates: ['currentPlan'] } },
          { label: 'Remove', action: { mutate: 'removeMeal', input: { id: '$.id' }, confirm: 'Remove this meal?' } },
        ],
        empty: { title: 'No plan yet for this week', action: { label: 'Plan this week', action: { mutate: 'generatePlan' } } },
      },
      {
        kind: 'stats',
        id: 'coverage',
        query: 'planCoverage',
        // the dependent query B1's view-shaped-endpoint rule forces into the schema
        input: { id: '$data.tonight.plan.id' },
        cards: [
          { label: 'Cookable from pantry', value: '$.cookablePct', meter: { max: 100 }, format: 'percent' },
          { label: 'Spend', value: '$.spend', format: 'currency', delta: '$.spendDelta', tone: 'auto' },
          { label: 'To buy', value: '$.itemsToBuy', icon: 'tag' },
        ],
      },
      {
        kind: 'list',
        id: 'gaps',
        title: 'Ingredients still needed',
        query: 'listPlanGaps',
        input: { planId: '$data.tonight.plan.id' },
        limit: 20,
        layout: 'cards',
        item: { use: 'IngredientCard', props: { ingredient: '$', tone: 'warning' } },
        facet: [{ field: '$.aisle', label: 'Aisle', counts: true }],
        sort: [{ label: 'By aisle', field: '$.aisle' }],
        search: { fields: ['$.name'], placeholder: 'Find an ingredient' },
        selectable: true,
        bulkActions: [{ label: 'Add to shopping list', action: { mutate: 'addToShoppingList', over: 'selection', arg: 'ids' } }],
        empty: 'Nothing missing — the week is covered.',
      },
      {
        kind: 'create',
        id: 'addRecipe',
        title: 'Import a recipe',
        mutation: 'importRecipe',
        // NOTE: no `fields` — they derive from importRecipe's Input JSON Schema
        input: { planId: '$data.tonight.plan.id' },
        submitLabel: 'Import',
        invalidates: ['currentPlan', 'planCoverage'],
        async: { note: 'Importing in the background — this can take a minute.', refetchAfter: 5000 },
        prefill: { endpoint: 'suggestRecipe', input: { brief: '$form.brief' }, merge: 'fill-empty' },
        onSuccess: { navigate: 'recipes/[id]', params: { id: '$result.id' } },
      },
      { kind: 'create', id: 'addMeal', mutation: 'addMeal', input: { planId: '$data.tonight.plan.id' } },
      { kind: 'markdown', id: 'weekNote', query: 'currentPlan', value: '$.plan.notes' },
      { kind: 'chat', id: 'sousChat', agent: 'chef', greeting: 'Ask me about this week', height: 'md' },
    ],
  };

  it('validates clean', () => {
    expect(validateViewSpecShape(spec)).toEqual({ ok: true, errors: [] });
  });

  it('validates a detail page on a dynamic route', () => {
    const detail: ViewSpec = {
      route: 'medications/[id]',
      layout: 'detail',
      sections: [
        {
          kind: 'detail',
          id: 'med',
          query: 'getMedication',
          param: '$route.id',
          header: {
            el: 'row',
            gap: 3,
            justify: 'between',
            children: [
              { el: 'heading', text: '$.name', level: 1 },
              { el: 'badge', text: '$.statusLabel', tone: 'auto' },
            ],
          },
          fields: [
            { label: 'Dose', value: '$.dose' },
            { label: 'Started', value: '$.startedAt', format: 'date' },
            { label: 'Last taken', value: '$.lastTakenAt', format: 'relative-time' },
          ],
          body: { el: 'markdown', text: '$.note' },
          actions: [
            { label: 'Print', action: { print: true }, icon: 'file' },
            {
              label: 'Delete',
              action: { mutate: 'deleteMedication', input: { id: '$.id' }, confirm: 'Delete?', onSuccess: { navigate: 'medications' } },
              tone: 'danger',
            },
          ],
        },
        { kind: 'list', id: 'interactions', query: 'getMedication', param: '$route.id', from: '$.interactions', limit: 10 },
      ],
    };
    expect(validateViewSpecShape(detail)).toEqual({ ok: true, errors: [] });
  });

  it('validates a component def whose node references elements and another component', () => {
    const def = {
      name: 'IngredientCard',
      props: { ingredient: 'Ingredient', tone: 'string' },
      node: {
        el: 'surface',
        toneOf: '$props.ingredient.urgency',
        toneMap: { low: 'neutral', high: 'warning' },
        children: [
          { el: 'row', gap: 2, children: [{ el: 'icon', name: 'tag' }, { el: 'text', text: '$props.ingredient.name', bold: true, maxLines: 1 }] },
          { el: 'caption', text: '$props.ingredient.aisle' },
          { use: 'SeverityPill', props: { level: '$props.ingredient.urgency' } },
        ],
      },
    };
    expect(validateViewComponentShape(def)).toEqual({ ok: true, errors: [] });
  });
});

// ──────────────────────────────────────────────────────────────────────────────

describe('malformed specs fail at the instance path a menu-shaped error needs', () => {
  it('an unknown section kind names the tag and its value', () => {
    const res = validateViewSpecShape({ route: 'index', sections: [{ kind: 'gallery', query: 'x' }] });
    expect(res.ok).toBe(false);
    const err = res.errors.find((e) => e.keyword === 'discriminator');
    expect(err?.instancePath).toBe('/sections/0');
    expect(err?.params).toMatchObject({ tag: 'kind', tagValue: 'gallery' });
  });

  it('an unknown element names the tag and its value', () => {
    const res = validateViewSpecShape({
      route: 'index',
      sections: [{ kind: 'list', query: 'x', item: { el: 'carousel', slides: [] } }],
    });
    expect(res.ok).toBe(false);
    const err = res.errors.find((e) => e.keyword === 'discriminator');
    expect(err?.instancePath).toBe('/sections/0/item');
    expect(err?.params).toMatchObject({ tag: 'el', tagValue: 'carousel' });
  });

  it('a CUT element is now an unknown element, not a silently ignored one', () => {
    for (const cut of ['chip', 'avatar', 'code', 'quote', 'map']) {
      const res = validateViewSpecShape({
        route: 'index',
        sections: [{ kind: 'list', query: 'x', item: { el: cut, text: '$.x' } }],
      });
      expect(res.ok, cut).toBe(false);
      expect(res.errors.find((e) => e.keyword === 'discriminator')?.params).toMatchObject({ tagValue: cut });
    }
  });

  it('a `create` section CANNOT declare fields — the property does not exist', () => {
    const createBranch = sectionBranch('create');
    expect(Object.keys(createBranch['properties'] as object)).not.toContain('fields');
    expect(createBranch['additionalProperties']).toBe(false);

    const res = validateViewSpecShape({
      route: 'index',
      sections: [{ kind: 'create', mutation: 'addRecipe', fields: [{ name: 'title', type: 'string' }] }],
    });
    expect(res.ok).toBe(false);
    const err = res.errors.find((e) => e.keyword === 'additionalProperties');
    expect(err?.instancePath).toBe('/sections/0');
    expect(err?.params).toMatchObject({ additionalProperty: 'fields' });
  });

  it('an invented element prop is rejected at the element, naming the prop', () => {
    const res = validateViewSpecShape({
      route: 'index',
      sections: [{ kind: 'list', query: 'x', item: { el: 'badge', text: '$.status', colour: 'red' } }],
    });
    expect(res.ok).toBe(false);
    const err = res.errors.find((e) => e.keyword === 'additionalProperties');
    expect(err?.instancePath).toBe('/sections/0/item');
    expect(err?.params).toMatchObject({ additionalProperty: 'colour' });
  });

  it('an icon outside the named set is rejected WITH the full menu', () => {
    const res = validateViewSpecShape({
      route: 'index',
      sections: [{ kind: 'list', query: 'x', item: { el: 'icon', name: 'sparkles' } }],
    });
    const err = res.errors.find((e) => e.keyword === 'enum');
    expect(err?.instancePath).toBe('/sections/0/item/name');
    expect((err?.params as { allowedValues: string[] }).allowedValues).toEqual([...ICON_NAMES]);
  });

  it('a router-shaped route is rejected — one route vocabulary, the authoring one', () => {
    expect(paths({ route: '/recipes/:id', sections: [{ kind: 'list', query: 'x' }] })).toContainEqual([
      '/route',
      'pattern',
    ]);
    expect(paths({ route: 'recipes/[id].tsx', sections: [{ kind: 'list', query: 'x' }] })).toContainEqual([
      '/route',
      'pattern',
    ]);
    expect(validateViewSpecShape({ route: 'recipes/[id]', sections: [{ kind: 'list', query: 'x' }] }).ok).toBe(true);
  });

  it('a mutation reference that is not an identifier fails at its own path', () => {
    expect(paths({ route: 'index', sections: [{ kind: 'create', mutation: 'POST /api/recipes' }] })).toContainEqual([
      '/sections/0/mutation',
      'pattern',
    ]);
  });

  it('an action must be exactly one of mutate / navigate / download / print / copy', () => {
    const res = validateViewSpecShape({
      route: 'index',
      sections: [{ kind: 'toolbar', actions: [{ label: 'Go', action: { mutate: 'addRecipe', navigate: 'index' } }] }],
    });
    expect(res.ok).toBe(false);
    expect(res.errors.map((e) => e.instancePath)).toContain('/sections/0/actions/0/action');
  });

  it('a button that neither acts nor reveals is rejected', () => {
    const res = validateViewSpecShape({
      route: 'index',
      sections: [{ kind: 'list', query: 'x', item: { el: 'button', label: 'Do it' } }],
    });
    expect(res.ok).toBe(false);
    expect(res.errors.map((e) => e.keyword)).toContain('anyOf');
  });

  it('a component def cannot smuggle in source code', () => {
    const res = validateViewComponentShape({
      name: 'RecipeCard',
      props: { recipe: 'Recipe' },
      node: { el: 'col', children: [] },
      src: 'export default function RecipeCard() {}',
    });
    expect(res.ok).toBe(false);
    expect(res.errors.map((e) => e.params)).toContainEqual({ additionalProperty: 'src' });
  });

  it('a component prop type must be a type reference, not a TS expression', () => {
    const res = validateViewComponentShape({
      name: 'RecipeCard',
      props: { recipe: '{ id: string }' },
      node: { el: 'col' },
    });
    expect(res.ok).toBe(false);
    expect(res.errors[0]?.instancePath).toBe('/props/recipe');
  });
});

// ──────────────────────────────────────────────────────────────────────────────

describe('the schemas themselves', () => {
  it('closes every section and element object — an invented key can never be ignored', () => {
    for (const branch of DEFS['section']['oneOf'] as JsonSchema[]) {
      expect(branch['additionalProperties']).toBe(false);
    }
    for (const branch of DEFS['element']['oneOf'] as JsonSchema[]) {
      expect(branch['additionalProperties']).toBe(false);
    }
    expect(VIEW_SPEC_SCHEMA['additionalProperties']).toBe(false);
    expect(VIEW_COMPONENT_SCHEMA['additionalProperties']).toBe(false);
  });

  it('gives the two collection kinds the same sourcing contract', () => {
    const keys = (kind: string) => Object.keys(sectionBranch(kind)['properties'] as object);
    for (const shared of ['query', 'from', 'input', 'param', 'limit', 'item', 'rowAction', 'poll', 'empty']) {
      expect(keys('list'), `list.${shared}`).toContain(shared);
      expect(keys('timeline'), `timeline.${shared}`).toContain(shared);
    }
    // …and only `timeline` carries the grouping vocabulary.
    expect(keys('timeline')).toContain('group');
    expect(keys('list')).not.toContain('group');
  });

  it('accepts both the bare and the explicit empty-state form', () => {
    const bare = validateViewSpecShape({
      route: 'index',
      sections: [{ kind: 'list', query: 'x', empty: { title: 'No sources yet', message: 'Add an RSS feed above.' } }],
    });
    expect(bare).toEqual({ ok: true, errors: [] });
    const explicit = validateViewSpecShape({
      route: 'index',
      sections: [{ kind: 'list', query: 'x', empty: { el: 'empty', title: 'None yet', message: 'Add one above.', icon: 'info' } }],
    });
    expect(explicit).toEqual({ ok: true, errors: [] });
    const sentence = validateViewSpecShape({ route: 'index', sections: [{ kind: 'list', query: 'x', empty: 'None yet' }] });
    expect(sentence.ok).toBe(true);
  });

  it('spells the empty state`s second line `message`, with no `text` alias', () => {
    // T0 wrote `message` 8/8 times unprompted; a weak-model interface follows the
    // measured word, and offering both would be two ways to say one thing.
    const res = validateViewSpecShape({
      route: 'index',
      sections: [{ kind: 'list', query: 'x', empty: { title: 'None', text: 'Add one' } }],
    });
    expect(res.ok).toBe(false);
    expect(res.errors.map((e) => e.params)).toContainEqual({ additionalProperty: 'text' });
  });
});
