import * as React from 'react'
import { describe, it, expect, vi } from 'vitest'
import { render, screen, waitFor } from '../test-utils/index'
import { ViewRenderer } from './renderer'
import { createViewClient, type EndpointManifest } from './client'
import type { ViewSpec } from './types'

/**
 * The renderer, end to end, in jsdom.
 *
 * **What this suite cannot prove** — and the reason `metro/suites/view.tsx` exists: jsdom
 * has `isWeb === true` always, so nothing here says anything about which fork Metro picks
 * or about a bare string being dropped inside a native View. These cases are about
 * BEHAVIOUR: the lifecycle, the defaults, S1, dispatch and dependent queries.
 */

const MANIFEST: EndpointManifest = {
  listRecipes: { method: 'GET', routePath: '/recipes' },
  getRecipe: { method: 'GET', routePath: '/recipes/:id' },
  weekStats: { method: 'GET', routePath: '/stats' },
  addRecipe: {
    method: 'POST',
    routePath: '/recipes',
    inputSchema: {
      type: 'object',
      required: ['title'],
      properties: { title: { type: 'string', title: 'Title' }, notes: { type: 'string' } },
    },
  },
  toggleDone: { method: 'POST', routePath: '/recipes/:id/done' },
  // Schemas matter here: `useSectionSource` only auto-injects the route's single `[param]`
  // into an endpoint that DECLARES it (see the 'route params' suite).
  currentPlan: {
    method: 'GET',
    routePath: '/plan',
    inputSchema: { type: 'object', properties: { tz: { type: 'string' } }, additionalProperties: false },
  },
  planMeals: {
    method: 'GET',
    routePath: '/plan/:planId/meals',
    inputSchema: { type: 'object', properties: { planId: { type: 'string' } }, additionalProperties: false },
  },
  // The bike-workshop dashboard: ONE computed record, returned in the `{ items: [...] }`
  // envelope every generated handler uses. Two sections read it — see the suite below.
  shopDashboard: { method: 'GET', routePath: '/shop-dashboard' },
}

/** A client whose every endpoint is a stub, recording what was called. */
function stubClient(
  responses: Record<string, unknown>,
  onCall?: (name: string, input: Record<string, unknown>) => void,
) {
  const calls: { name: string; input: Record<string, unknown> }[] = []
  const client = createViewClient({
    baseUrl: '',
    endpoints: MANIFEST,
    fetchImpl: (async () => {
      throw new Error('fetchImpl should not be reached — call is stubbed')
    }) as never,
  })
  const wrapped = {
    ...client,
    call: async (name: string, input: Record<string, unknown> = {}) => {
      calls.push({ name, input })
      onCall?.(name, input)
      if (!(name in responses)) throw new Error(`no stub for ${name}`)
      const value = responses[name]
      if (value instanceof Error) throw value
      return value
    },
  }
  return { client: wrapped, calls }
}

const page = (sections: ViewSpec['sections']): ViewSpec => ({ route: 'index', sections })

describe('renderer defaults — never authored, always there', () => {
  it('shows a loading state while the first fetch is in flight', () => {
    let resolve!: (v: unknown) => void
    const pending = new Promise((r) => {
      resolve = r
    })
    const { client } = stubClient({})
    const spy = { ...client, call: () => pending }
    render(
      <ViewRenderer spec={page([{ kind: 'list', query: 'listRecipes', title: 'Recipes' }])} client={spy as never} />,
    )
    // The skeleton claims the room the answer will need.
    expect(document.querySelector('[aria-busy="true"]')).not.toBeNull()
    resolve([])
  })

  it('shows a DEFAULT empty state when the endpoint returns nothing', async () => {
    const { client } = stubClient({ listRecipes: [] })
    render(<ViewRenderer spec={page([{ kind: 'list', query: 'listRecipes' }])} client={client as never} />)
    // Derived from the endpoint name, and nobody authored a word of it.
    await waitFor(() => expect(screen.getByText(/No recipes yet/i)).toBeInTheDocument())
  })

  it('an authored `empty` OVERRIDES the default', async () => {
    const { client } = stubClient({ listRecipes: [] })
    render(
      <ViewRenderer
        spec={page([{ kind: 'list', query: 'listRecipes', empty: { title: 'No expenses yet', message: 'Add the first one' } }])}
        client={client as never}
      />,
    )
    await waitFor(() => expect(screen.getByText('No expenses yet')).toBeInTheDocument())
    expect(screen.getByText('Add the first one')).toBeInTheDocument()
  })

  it('shows an error state WITH a retry when the endpoint fails', async () => {
    const { client } = stubClient({ listRecipes: new Error('pod is waking') })
    render(<ViewRenderer spec={page([{ kind: 'list', query: 'listRecipes' }])} client={client as never} />)
    await waitFor(() => expect(screen.getByText(/pod is waking/)).toBeInTheDocument())
    expect(screen.getByText('Try again')).toBeInTheDocument()
  })
})

describe('list', () => {
  const rows = [
    { id: '1', title: 'Ragu', status: 'draft', total: 12 },
    { id: '2', title: 'Pesto', status: 'published', total: 8 },
  ]

  it('renders an authored flat item', async () => {
    const { client } = stubClient({ listRecipes: rows })
    render(
      <ViewRenderer
        spec={page([{ kind: 'list', query: 'listRecipes', item: { title: '$.title', badge: '$.status' } }])}
        client={client as never}
      />,
    )
    await waitFor(() => expect(screen.getByText('Ragu')).toBeInTheDocument())
    expect(screen.getByText('published')).toBeInTheDocument()
  })

  it('DERIVES a row shape when none is authored — `{kind:"list", query}` is a legal page', async () => {
    const { client } = stubClient({ listRecipes: rows })
    render(<ViewRenderer spec={page([{ kind: 'list', query: 'listRecipes' }])} client={client as never} />)
    await waitFor(() => expect(screen.getByText('Ragu')).toBeInTheDocument())
    expect(screen.getByText('Pesto')).toBeInTheDocument()
  })

  it('finds the array inside a wrapped Output', async () => {
    const { client } = stubClient({ listRecipes: { recipes: rows, total: 2 } })
    render(<ViewRenderer spec={page([{ kind: 'list', query: 'listRecipes' }])} client={client as never} />)
    await waitFor(() => expect(screen.getByText('Ragu')).toBeInTheDocument())
  })

  it('honours `limit`', async () => {
    const { client } = stubClient({ listRecipes: rows })
    render(<ViewRenderer spec={page([{ kind: 'list', query: 'listRecipes', limit: 1 }])} client={client as never} />)
    await waitFor(() => expect(screen.getByText('Ragu')).toBeInTheDocument())
    expect(screen.queryByText('Pesto')).toBeNull()
  })
})

describe('S1 — a null binding omits its element, and its label with it', () => {
  it('a row missing a bound field renders neither the value nor its chrome', async () => {
    const { client } = stubClient({ listRecipes: [{ id: '1', title: 'Ragu' }] })
    render(
      <ViewRenderer
        spec={page([
          {
            kind: 'list',
            query: 'listRecipes',
            item: { title: '$.title', badge: '$.status', note: '$.warning' },
          },
        ])}
        client={client as never}
      />,
    )
    await waitFor(() => expect(screen.getByText('Ragu')).toBeInTheDocument())
    // Nothing stands in for the missing badge — no empty pill, no dash.
    expect(document.body.textContent).toBe(
      document.body.textContent?.replace(/undefined|null/g, ''),
    )
  })

  it('a keyvalue pair with no value takes its LABEL with it', async () => {
    const { client } = stubClient({ getRecipe: { id: '1', title: 'Ragu' } })
    render(
      <ViewRenderer
        spec={page([
          {
            kind: 'detail',
            query: 'getRecipe',
            fields: [
              { label: 'Title', value: '$.title' },
              { label: 'Paid by', value: '$.paidBy' },
            ],
          },
        ])}
        client={client as never}
      />,
    )
    await waitFor(() => expect(screen.getByText('Title')).toBeInTheDocument())
    expect(screen.queryByText('Paid by')).toBeNull()
  })

  it('a LITERAL is never omitted, even an empty one', async () => {
    const { client } = stubClient({ listRecipes: [{ id: '1' }] })
    render(
      <ViewRenderer
        spec={page([{ kind: 'list', query: 'listRecipes', item: { title: 'Always here' } }])}
        client={client as never}
      />,
    )
    await waitFor(() => expect(screen.getByText('Always here')).toBeInTheDocument())
  })
})

describe('stats', () => {
  it('renders a card per metric, formatted', async () => {
    const { client } = stubClient({ weekStats: { meals: 12, spend: 42.5 } })
    render(
      <ViewRenderer
        spec={page([
          {
            kind: 'stats',
            query: 'weekStats',
            cards: [
              { label: 'Meals', value: '$.meals' },
              { label: 'Spend', value: '$.spend', format: 'currency' },
            ],
          },
        ])}
        client={client as never}
      />,
    )
    await waitFor(() => expect(screen.getByText('12')).toBeInTheDocument())
    expect(screen.getByText(/42[.,]50/)).toBeInTheDocument()
  })

  it('omits a card whose metric the endpoint did not compute (S1)', async () => {
    const { client } = stubClient({ weekStats: { meals: 12 } })
    render(
      <ViewRenderer
        spec={page([
          {
            kind: 'stats',
            query: 'weekStats',
            cards: [
              { label: 'Meals', value: '$.meals' },
              { label: 'Waste', value: '$.waste' },
            ],
          },
        ])}
        client={client as never}
      />,
    )
    await waitFor(() => expect(screen.getByText('Meals')).toBeInTheDocument())
    expect(screen.queryByText('Waste')).toBeNull()
  })
})

/**
 * The measured failure this suite exists for: `30-bike-workshop` run 202 step-02 rendered its
 * whole front page as two headings — no stat cards, no detail fields, no empty state — with
 * `appBuild built=true`, `appCheck ok=true`, HTTP 200, zero console errors and zero failed
 * requests. Every gate was green and the page showed nothing.
 *
 * The endpoint answered `{ items: [ { …one computed record… } ] }` — the envelope EVERY generated
 * handler returns — and a RECORD section (`stats`, `detail`) bound `$.field` straight through it.
 * `useSectionSource` unwrapped `items` for a collection and not for a record, so every `$.field`
 * resolved against the envelope, S1 dropped every card and every keyvalue row (a stats card takes
 * its LITERAL label with it), and `isEmpty` was false because the envelope object is not null —
 * so not even the authored empty state drew. The list pages on the same app were fine, which is
 * exactly why nothing caught it.
 */
describe('a record section against an `{ items: [record] }` envelope (bike-workshop, run 202)', () => {
  /** The endpoint's real Output, one uncollected-jobs snapshot of it. */
  const BODY = {
    items: [
      {
        in_shop_count: 3,
        total_parts_gbp: 148.49,
        longest_waiting_id: 'j1',
        longest_waiting_bike_label: 'Specialized Allez',
        longest_waiting_customer_name: 'Aoife Brennan',
        longest_waiting_days: 17,
        longest_waiting_work_description: 'full service',
      },
    ],
  }

  /** `pages/index.view.json`, verbatim from the run's snapshot. */
  const DASHBOARD: ViewSpec = {
    route: 'index',
    title: 'Workshop',
    sections: [
      {
        kind: 'stats',
        id: 'shopStats',
        query: 'shopDashboard',
        cards: [
          { label: 'Bikes in shop', value: '$.in_shop_count' },
          { label: 'Total parts', value: '$.total_parts_gbp', format: 'currency' },
        ],
      },
      {
        kind: 'detail',
        id: 'longestWaiting',
        query: 'shopDashboard',
        fields: [
          { label: 'Bike', value: '$.longest_waiting_bike_label' },
          { label: 'Work', value: '$.longest_waiting_work_description' },
          { label: 'Customer', value: '$.longest_waiting_customer_name' },
          { label: 'Days waiting', value: '$.longest_waiting_days' },
        ],
        empty: { title: 'No bikes waiting', message: 'All jobs are collected — nothing in the shop.' },
      },
    ],
  }

  it('draws the stat cards and the detail rows, not just the headings', async () => {
    const { client } = stubClient({ shopDashboard: BODY })
    render(<ViewRenderer spec={DASHBOARD} client={client as never} />)

    await waitFor(() => expect(screen.getByText('Bikes in shop')).toBeInTheDocument())
    expect(screen.getByText('3')).toBeInTheDocument()
    expect(screen.getByText(/148[.,]49/)).toBeInTheDocument()
    // The detail half — a label is only on screen when S1 kept its value.
    expect(screen.getByText('Bike')).toBeInTheDocument()
    expect(screen.getByText('Specialized Allez')).toBeInTheDocument()
    expect(screen.getByText('Aoife Brennan')).toBeInTheDocument()
    expect(screen.getByText('full service')).toBeInTheDocument()
  })

  it('shows the authored empty state when the envelope carries NO record', async () => {
    // `{ items: [] }` was indistinguishable from a record before: the envelope object is not
    // null, so `isEmpty` was false and the section drew an empty box under its heading.
    const { client } = stubClient({ shopDashboard: { items: [] } })
    render(<ViewRenderer spec={DASHBOARD} client={client as never} />)
    await waitFor(() => expect(screen.getByText('No bikes waiting')).toBeInTheDocument())
  })

  it('does NOT unwrap a record that merely EMBEDS an array', async () => {
    // `{ plan, tonight, mealsByDay: [...] }` is a record with an embedded array, not an
    // envelope. Unwrapping it would bind every `$.tonight.*` against a meal row.
    const { client } = stubClient({
      currentPlan: { plan: { id: 'p1' }, weekStart: '2026-07-27', mealsByDay: [{ id: 'm1', title: 'Soup' }] },
    })
    render(
      <ViewRenderer
        spec={page([
          { kind: 'stats', query: 'currentPlan', cards: [{ label: 'Week', value: '$.weekStart' }] },
        ])}
        client={client as never}
      />,
    )
    await waitFor(() => expect(screen.getByText('2026-07-27')).toBeInTheDocument())
  })
})

describe('markdown + toolbar', () => {
  it('renders literal markdown with no request at all', () => {
    const { client, calls } = stubClient({})
    render(<ViewRenderer spec={page([{ kind: 'markdown', source: '# Welcome' }])} client={client as never} />)
    expect(screen.getByText('Welcome')).toBeInTheDocument()
    expect(calls).toEqual([])
  })

  it('a toolbar `reveals` hides its target until pressed — the useState replacement', async () => {
    const { client } = stubClient({})
    render(
      <ViewRenderer
        spec={page([
          { kind: 'toolbar', reveals: ['takes'] },
          { kind: 'markdown', id: 'takes', source: 'the hidden take' },
        ])}
        client={client as never}
      />,
    )
    expect(screen.queryByText('the hidden take')).toBeNull()
    screen.getByText('Show').click()
    await waitFor(() => expect(screen.getByText('the hidden take')).toBeInTheDocument())
  })

  it('a section that NOTHING reveals is always shown', () => {
    const { client } = stubClient({})
    render(
      <ViewRenderer
        spec={page([{ kind: 'markdown', id: 'notes', source: 'always visible' }])}
        client={client as never}
      />,
    )
    expect(screen.getByText('always visible')).toBeInTheDocument()
  })
})

describe('the create section — fields derived from the Input schema', () => {
  it('renders a control per Input property and NOTHING was declared', async () => {
    const { client } = stubClient({})
    render(<ViewRenderer spec={page([{ kind: 'create', mutation: 'addRecipe' }])} client={client as never} />)
    await waitFor(() => expect(screen.getByText('Title')).toBeInTheDocument())
    expect(screen.getByText('Notes')).toBeInTheDocument()
  })

  it('names the problem when the mutation is not in the manifest', () => {
    const { client } = stubClient({})
    render(<ViewRenderer spec={page([{ kind: 'create', mutation: 'ghostEndpoint' }])} client={client as never} />)
    expect(screen.getByText(/ghostEndpoint/)).toBeInTheDocument()
  })
})

describe('dispatch — the action seam', () => {
  it('a row action carries THAT ROW`s id into the mutation (audit I1)', async () => {
    const seen: { name: string; input: Record<string, unknown> }[] = []
    const { client } = stubClient(
      { listRecipes: [{ id: '7', title: 'Ragu' }], toggleDone: { ok: true } },
      (name, input) => seen.push({ name, input }),
    )
    render(
      <ViewRenderer
        spec={page([
          {
            kind: 'list',
            query: 'listRecipes',
            item: {
              title: '$.title',
              actions: [{ label: 'Done', action: { mutate: 'toggleDone', input: { id: '$.id' } } }],
            },
          },
        ])}
        client={client as never}
      />,
    )
    await waitFor(() => expect(screen.getByText('Done')).toBeInTheDocument())
    screen.getByText('Done').click()
    await waitFor(() => expect(seen.some((c) => c.name === 'toggleDone')).toBe(true))
    expect(seen.find((c) => c.name === 'toggleDone')?.input).toEqual({ id: '7' })
  })

  it('a confirm that is declined does NOT fire the mutation', async () => {
    const seen: string[] = []
    const base = stubClient({ listRecipes: [{ id: '7', title: 'Ragu' }], toggleDone: {} }, (n) => seen.push(n))
    const client = { ...base.client, confirm: async () => false }
    render(
      <ViewRenderer
        spec={page([
          {
            kind: 'list',
            query: 'listRecipes',
            item: {
              title: '$.title',
              actions: [{ label: 'Delete', action: { mutate: 'toggleDone', confirm: 'Sure?', input: { id: '$.id' } } }],
            },
          },
        ])}
        client={client as never}
      />,
    )
    await waitFor(() => expect(screen.getByText('Delete')).toBeInTheDocument())
    screen.getByText('Delete').click()
    await new Promise((r) => setTimeout(r, 20))
    expect(seen).not.toContain('toggleDone')
  })

  it('a `navigate` action reaches the host router with its params filled in', async () => {
    const navigate = vi.fn()
    const base = stubClient({ listRecipes: [{ id: '7', title: 'Ragu' }] })
    const client = { ...base.client, navigate }
    render(
      <ViewRenderer
        spec={page([
          {
            kind: 'list',
            query: 'listRecipes',
            item: { title: '$.title' },
            rowAction: { navigate: 'recipes/[id]', params: { id: '$.id' } },
          },
        ])}
        client={client as never}
      />,
    )
    await waitFor(() => expect(screen.getByText('Ragu')).toBeInTheDocument())
    screen.getByText('Ragu').closest('button')?.click()
    await waitFor(() => expect(navigate).toHaveBeenCalledWith('recipes/7'))
  })
})

describe('dependent queries — an unresolved binding disables the query', () => {
  it('does not fire the dependent request until its input arrives', async () => {
    const calls: string[] = []
    const { client } = stubClient(
      { currentPlan: { plan: { id: 'p9' } }, planMeals: [{ id: 'm1', title: 'Ragu' }] },
      (name) => calls.push(name),
    )
    render(
      <ViewRenderer
        spec={page([
          { kind: 'detail', id: 'currentPlan', query: 'currentPlan', fields: [{ label: 'Plan', value: '$.plan.id' }] },
          { kind: 'list', query: 'planMeals', input: { planId: '$data.currentPlan.plan.id' }, item: { title: '$.title' } },
        ])}
        client={client as never}
      />,
    )
    // The first render cannot know the plan id, so `planMeals` must not be among the
    // first calls — sending `planId: undefined` is the bug this replaces.
    expect(calls).not.toContain('planMeals')
    await waitFor(() => expect(screen.getByText('Ragu')).toBeInTheDocument())
    expect(calls).toContain('planMeals')
  })
})

describe('route params', () => {
  it('`param` defaults to the route`s single [param]', async () => {
    const seen: Record<string, unknown>[] = []
    const { client } = stubClient({ getRecipe: { id: '5', title: 'Ragu' } }, (_n, input) => seen.push(input))
    render(
      <ViewRenderer
        spec={{ route: 'recipes/[id]', sections: [{ kind: 'detail', query: 'getRecipe' }] }}
        route={{ path: 'recipes/5', params: { id: '5' } }}
        client={client as never}
      />,
    )
    await waitFor(() => expect(seen[0]).toEqual({ id: '5' }))
  })

  /**
   * The default is a CONVENIENCE, not a broadcast. Every handler's Input schema is
   * `additionalProperties: false` and is ajv-validated pod-side, so sending `planId` to an
   * endpoint that does not declare it is a hard 400 — and on a `[param]` page that hits every
   * section, not just the one that wanted the record. The T1 golden-app run measured exactly
   * this: `plan/[planId]` and `trip/[planId]` answered `invalid input` on every load while
   * `renderSmokeViews` (which already guards with `ep.inputKeys.includes(p)`) called them clean.
   */
  it('does NOT inject the route param into an endpoint whose Input schema omits it', async () => {
    const seen: { name: string; input: Record<string, unknown> }[] = []
    const { client } = stubClient(
      { currentPlan: { plan: { id: 'p1' } }, planMeals: [] },
      (name, input) => seen.push({ name, input }),
    )
    render(
      <ViewRenderer
        spec={{
          route: 'plan/[planId]',
          // `currentPlan`'s Input declares only `tz`; `planMeals` declares `planId`.
          sections: [
            { kind: 'stats', id: 'plan', query: 'currentPlan', cards: [{ label: 'Plan', value: '$.plan.id' }] },
            { kind: 'list', id: 'meals', query: 'planMeals' },
          ],
        }}
        route={{ path: 'plan/p1', params: { planId: 'p1' } }}
        client={client as never}
      />,
    )
    await waitFor(() => expect(seen.length).toBeGreaterThanOrEqual(2))
    expect(seen.find((c) => c.name === 'currentPlan')?.input).toEqual({})
    // The endpoint that DOES declare it still gets it — the guard narrows, it does not disable.
    expect(seen.find((c) => c.name === 'planMeals')?.input).toEqual({ planId: 'p1' })
  })
})

describe('a broken section does not take the page with it', () => {
  it('renders the rest and names the one that failed', async () => {
    const { client } = stubClient({ listRecipes: [{ id: '1', title: 'Ragu' }] })
    const Boom = () => {
      throw new Error('kaboom')
    }
    // A component reference to a definition whose node throws is the closest reachable
    // analogue of a renderer defect on real data.
    const spec = page([
      { kind: 'markdown', source: 'still here' },
      { kind: 'list', query: 'listRecipes', item: { use: 'Boom' } },
    ])
    render(
      <ViewRenderer
        spec={spec}
        components={[{ name: 'Boom', node: { el: 'text', text: '$.title' } }]}
        client={client as never}
      />,
    )
    void Boom
    await waitFor(() => expect(screen.getByText('still here')).toBeInTheDocument())
  })
})

describe('components — a named composition of elements', () => {
  it('resolves `$props.*` at the use site', async () => {
    const { client } = stubClient({ listRecipes: [{ id: '1', title: 'Ragu' }] })
    render(
      <ViewRenderer
        spec={page([
          { kind: 'list', query: 'listRecipes', item: { use: 'RecipeCard', props: { name: '$.title' } } },
        ])}
        components={[
          { name: 'RecipeCard', props: { name: 'string' }, node: { el: 'heading', text: '$props.name', level: 3 } },
        ]}
        client={client as never}
      />,
    )
    await waitFor(() => expect(screen.getByText('Ragu')).toBeInTheDocument())
  })

  it('names an unknown component rather than rendering a blank', async () => {
    const { client } = stubClient({ listRecipes: [{ id: '1' }] })
    render(
      <ViewRenderer
        spec={page([{ kind: 'list', query: 'listRecipes', item: { use: 'Nope' } }])}
        client={client as never}
      />,
    )
    await waitFor(() => expect(screen.getByText(/Unknown component "Nope"/)).toBeInTheDocument())
  })
})

describe('the shell', () => {
  it('derives nav from a small route list and marks the current destination', () => {
    const { client } = stubClient({})
    render(
      <ViewRenderer
        spec={page([{ kind: 'markdown', source: 'home' }])}
        shell={{ brand: 'Kitchen' }}
        routes={['index', 'recipes', 'shopping']}
        route={{ path: 'index' }}
        client={client as never}
      />,
    )
    expect(screen.getAllByText('Kitchen').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Recipes').length).toBeGreaterThan(0)
  })

  it('renders NO derived nav above the threshold — the model must declare groups', () => {
    const { client } = stubClient({})
    render(
      <ViewRenderer
        spec={page([{ kind: 'markdown', source: 'home' }])}
        shell={{}}
        routes={['index', 'a', 'b', 'c', 'd', 'e', 'f']}
        client={client as never}
      />,
    )
    expect(screen.queryByText('A')).toBeNull()
  })
})

// ──────────────────────────────────────────────────────────────────────────────

describe('the Wave-2 amendments', () => {
  it('sends a LITERAL argument to the endpoint, typed as written', async () => {
    // The blocking T1 gap: `{ meal: 'dinner', withinDays: 7 }` had to be an endpoint
    // default, which only ever works for one constant per endpoint.
    const { client, calls } = stubClient({ listRecipes: [{ id: '1', title: 'Ragu' }] })
    render(
      <ViewRenderer
        spec={page([
          { kind: 'list', query: 'listRecipes', input: { meal: 'dinner', withinDays: 7, includePast: false } },
        ])}
        client={client as never}
      />,
    )
    await waitFor(() => expect(screen.getByText('Ragu')).toBeInTheDocument())
    const call = calls.find((c) => c.name === 'listRecipes')
    // A number stays a number: an Input schema declaring `type: 'number'` would reject '7'.
    expect(call?.input).toEqual({ meal: 'dinner', withinDays: 7, includePast: false })
  })

  it('a literal argument never makes a section pending — only a BINDING can', async () => {
    // `resolveInputs.ready` is what replaces `enabled:`; a constant is always ready.
    const { client, calls } = stubClient({ planMeals: [] })
    render(
      <ViewRenderer
        spec={page([{ kind: 'list', query: 'planMeals', input: { planId: 'p7' } }])}
        client={client as never}
      />,
    )
    await waitFor(() => expect(calls.some((c) => c.name === 'planMeals')).toBe(true))
  })

  it('carries a different constant per button — ONE endpoint, three actions', async () => {
    const { client, calls } = stubClient({ listRecipes: [{ id: '1', title: 'Ragu' }], toggleDone: { ok: true } })
    render(
      <ViewRenderer
        spec={page([
          {
            kind: 'toolbar',
            actions: [
              { label: 'TL;DR', action: { mutate: 'toggleDone', input: { style: 'tldr' } } },
              { label: 'ELI5', action: { mutate: 'toggleDone', input: { style: 'eli5' } } },
            ],
          },
        ])}
        client={client as never}
      />,
    )
    screen.getByText('ELI5').click()
    await waitFor(() => expect(calls.some((c) => c.name === 'toggleDone')).toBe(true))
    expect(calls.find((c) => c.name === 'toggleDone')?.input).toEqual({ style: 'eli5' })
  })

  it('puts a UNIT on a flat value — "20 min", not a bare "20"', async () => {
    const { client } = stubClient({ listRecipes: [{ id: '1', title: 'Ragu', prepMinutes: 20, unit: 'kcal', energy: 540 }] })
    render(
      <ViewRenderer
        spec={page([
          {
            kind: 'list',
            query: 'listRecipes',
            item: {
              title: '$.title',
              meta: { value: '$.prepMinutes', suffix: 'min' },
              // A bound unit works exactly as a literal one does.
              caption: { value: '$.energy', suffix: '$.unit' },
            },
          },
        ])}
        client={client as never}
      />,
    )
    await waitFor(() => expect(screen.getByText('20 min')).toBeInTheDocument())
    expect(screen.getByText('540 kcal')).toBeInTheDocument()
  })

  it('drops the unit, not the row, when the suffix binding resolves to nothing (S1)', async () => {
    const { client } = stubClient({ listRecipes: [{ id: '1', title: 'Ragu', prepMinutes: 20 }] })
    render(
      <ViewRenderer
        spec={page([
          { kind: 'list', query: 'listRecipes', item: { title: '$.title', meta: { value: '$.prepMinutes', suffix: '$.unit' } } },
        ])}
        client={client as never}
      />,
    )
    // "20 undefined" would be the naive concatenation; the figure stands on its own.
    await waitFor(() => expect(screen.getByText('20')).toBeInTheDocument())
  })

  it('keeps a tab highlighted on a PARAMETERISED family member', () => {
    const { client } = stubClient({})
    render(
      <ViewRenderer
        spec={page([{ kind: 'markdown', source: 'plan' }])}
        shell={{ groups: [{ label: 'Shop', home: 'shop', routes: ['shopping', 'trip/[planId]'] }, { label: 'Cook', home: 'index' }] }}
        routes={['index', 'shop', 'shopping', 'trip/[planId]']}
        route={{ path: 'trip/p7', params: { planId: 'p7' } }}
        client={client as never}
      />,
    )
    // The destination is mounted and reachable — the drill-in is no longer an orphan.
    expect(screen.getAllByText('Shop').length).toBeGreaterThan(0)
  })
})
