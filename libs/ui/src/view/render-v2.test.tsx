import * as React from 'react'
import { describe, it, expect } from 'vitest'
import { render, screen, waitFor, fireEvent } from '../test-utils/index'
import { ViewRenderer } from './renderer'
import { createViewClient, type EndpointManifest } from './client'
import type { ViewLayoutSpec, ViewSpec } from './types'

/**
 * The v2 vocabulary, in jsdom: the eight new elements, the five new field kinds, the three
 * arranged sections, nested layouts, and the always-on assistant dock.
 *
 * Split from `render.test.tsx` rather than appended so the two read as what they are: that suite
 * is the v1 contract's behaviour (lifecycle, defaults, S1, dispatch), this one is the v2
 * additions. Both are jsdom, and neither proves anything about native — `metro/suites/view.tsx`
 * carries the same cases against `react-test-renderer`, which is the only place "renders on a
 * phone" is a fact rather than an intention.
 */

const MANIFEST: EndpointManifest = {
  listJobs: { method: 'GET', routePath: '/jobs' },
  monthly: { method: 'GET', routePath: '/monthly' },
  getTrip: { method: 'GET', routePath: '/trips/:tripId' },
  listExpenses: { method: 'GET', routePath: '/trips/:tripId/expenses' },
  setStatus: { method: 'PATCH', routePath: '/jobs/:id/status' },
}

function stubClient(responses: Record<string, unknown>) {
  const calls: { name: string; input: Record<string, unknown> }[] = []
  const client = createViewClient({
    baseUrl: '',
    endpoints: MANIFEST,
    fetchImpl: (async () => {
      throw new Error('fetchImpl should not be reached — call is stubbed')
    }) as never,
  })
  return {
    calls,
    client: {
      ...client,
      call: async (name: string, input: Record<string, unknown> = {}) => {
        calls.push({ name, input })
        if (!(name in responses)) throw new Error(`no stub for ${name}`)
        const value = responses[name]
        if (value instanceof Error) throw value
        return value
      },
    },
  }
}

const page = (sections: ViewSpec['sections'], route = 'index'): ViewSpec => ({ route, sections })

const JOBS = [
  { id: '1', title: 'Kittiwake hull', status: 'quoted', owner: 'Ana Ferreira', due: '2026-08-04', total: 120 },
  { id: '2', title: 'Marisol shaft', status: 'in-progress', owner: 'Bo Lima', due: '2026-08-11', total: 340 },
  { id: '3', title: 'Bright Penny mast', status: 'in-progress', owner: 'Ana Ferreira', due: '2026-08-18', total: 90 },
]

// ── the eight new elements ────────────────────────────────────────────────────

describe('v2 elements', () => {
  it('renders `code` and `quote` as text, not as markdown', async () => {
    const { client } = stubClient({ listJobs: JOBS })
    render(
      <ViewRenderer
        spec={page([
          {
            kind: 'list',
            query: 'listJobs',
            item: {
              el: 'col',
              children: [
                { el: 'code', text: '$.id', language: 'id' },
                { el: 'quote', text: '$.title', cite: '$.owner' },
              ],
            },
          },
        ])}
        client={client as never}
      />,
    )
    await waitFor(() => expect(screen.getByText('Kittiwake hull')).toBeInTheDocument())
    expect(screen.getAllByText('id').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Ana Ferreira').length).toBeGreaterThan(0)
  })

  it('`avatar` falls back to INITIALS when there is no image — a row still identifies its person', async () => {
    const { client } = stubClient({ listJobs: JOBS })
    render(
      <ViewRenderer
        spec={page([
          { kind: 'list', query: 'listJobs', item: { el: 'avatar', name: '$.owner' } },
        ])}
        client={client as never}
      />,
    )
    // "Ana Ferreira" → AF, "Bo Lima" → BL. Two initials, first + last word.
    await waitFor(() => expect(screen.getAllByText('AF').length).toBe(2))
    expect(screen.getByText('BL')).toBeInTheDocument()
  })

  it('`steps` marks the current step from a LABEL, not just an index', async () => {
    const { client } = stubClient({ listJobs: [JOBS[1]] })
    render(
      <ViewRenderer
        spec={page([
          {
            kind: 'list',
            query: 'listJobs',
            item: {
              el: 'steps',
              current: '$.status',
              items: [{ label: 'quoted' }, { label: 'in-progress' }, { label: 'done' }],
            },
          },
        ])}
        client={client as never}
      />,
    )
    await waitFor(() => expect(screen.getByText('in-progress')).toBeInTheDocument())
    // All three steps paint; the numbering is the renderer's, so the spec never counts.
    expect(screen.getByText('1')).toBeInTheDocument()
    expect(screen.getByText('3')).toBeInTheDocument()
  })

  it('`tabs` mounts only the selected panel, and switches on press', async () => {
    const { client } = stubClient({ listJobs: JOBS })
    render(
      <ViewRenderer
        spec={page([
          {
            kind: 'markdown',
            source: 'x',
          },
          {
            kind: 'list',
            query: 'listJobs',
            limit: 1,
            item: {
              el: 'tabs',
              items: [
                { label: 'Summary', children: [{ el: 'text', text: '$.title' }] },
                { label: 'Owner', children: [{ el: 'text', text: '$.owner' }] },
              ],
            },
          },
        ])}
        client={client as never}
      />,
    )
    await waitFor(() => expect(screen.getByText('Kittiwake hull')).toBeInTheDocument())
    // The unselected panel is NOT in the tree — that is the point of not hiding with a style.
    expect(screen.queryByText('Ana Ferreira')).not.toBeInTheDocument()
    fireEvent.click(screen.getByText('Owner'))
    await waitFor(() => expect(screen.getByText('Ana Ferreira')).toBeInTheDocument())
  })

  it('`accordion` opens one group at a time unless `multiple`', async () => {
    const { client } = stubClient({ listJobs: [JOBS[0]] })
    render(
      <ViewRenderer
        spec={page([
          {
            kind: 'list',
            query: 'listJobs',
            item: {
              el: 'accordion',
              items: [
                { label: 'Details', children: [{ el: 'text', text: '$.title' }] },
                { label: 'Owner', children: [{ el: 'text', text: '$.owner' }] },
              ],
            },
          },
        ])}
        client={client as never}
      />,
    )
    await waitFor(() => expect(screen.getByText('Details')).toBeInTheDocument())
    expect(screen.queryByText('Kittiwake hull')).not.toBeInTheDocument()
    fireEvent.click(screen.getByText('Details'))
    await waitFor(() => expect(screen.getByText('Kittiwake hull')).toBeInTheDocument())
    fireEvent.click(screen.getByText('Owner'))
    await waitFor(() => expect(screen.getByText('Ana Ferreira')).toBeInTheDocument())
    expect(screen.queryByText('Kittiwake hull')).not.toBeInTheDocument()
  })

  it('`chart` draws SVG geometry, never a canvas or a library', async () => {
    const { client } = stubClient({ listJobs: JOBS })
    const { container } = render(
      <ViewRenderer
        spec={page([
          {
            kind: 'list',
            query: 'listJobs',
            limit: 1,
            item: { el: 'chart', kind: 'bar', data: '$data.rows', x: '$.title', y: '$.total' },
            id: 'rows',
          },
        ])}
        client={client as never}
      />,
    )
    await waitFor(() => expect(container.querySelector('svg')).not.toBeNull())
    expect(container.querySelector('canvas')).toBeNull()
  })

  it('`calendar` places a dated entry on the grid and keeps an undated one visible', async () => {
    const { client } = stubClient({
      listJobs: [JOBS[0], { id: '9', title: 'Unscheduled survey', due: null }],
    })
    render(
      <ViewRenderer
        spec={page([
          {
            kind: 'list',
            query: 'listJobs',
            limit: 1,
            id: 'rows',
            item: { el: 'calendar', items: '$data.rows', date: '$.due', title: '$.title' },
          },
        ])}
        client={client as never}
      />,
    )
    await waitFor(() => expect(screen.getByText('August 2026')).toBeInTheDocument())
    expect(screen.getByText('Kittiwake hull')).toBeInTheDocument()
    // A row whose date does not parse is NOT dropped — it would otherwise tell the user they
    // have nothing on a day they in fact have something on.
    expect(screen.getByText('No date')).toBeInTheDocument()
    expect(screen.getByText('Unscheduled survey')).toBeInTheDocument()
  })
})

// ── the three arranged sections ───────────────────────────────────────────────

describe('v2 sections', () => {
  it('`board` buckets rows by `group` and keeps a DECLARED empty column', async () => {
    const { client } = stubClient({ listJobs: JOBS })
    render(
      <ViewRenderer
        spec={page([
          {
            kind: 'board',
            query: 'listJobs',
            group: '$.status',
            columns: [
              { value: 'quoted', label: 'Quoted' },
              { value: 'in-progress', label: 'In progress' },
              { value: 'done', label: 'Done' },
            ],
            item: { title: '$.title' },
          },
        ])}
        client={client as never}
      />,
    )
    await waitFor(() => expect(screen.getByText('Quoted')).toBeInTheDocument())
    // The empty stage is the most interesting column on the board — it must not vanish.
    expect(screen.getByText('Done')).toBeInTheDocument()
    expect(screen.getByText('Empty')).toBeInTheDocument()
    expect(screen.getByText('Marisol shaft')).toBeInTheDocument()
  })

  it('`board` sends an unexpected group to a trailing column rather than dropping the row', async () => {
    const { client } = stubClient({ listJobs: [{ id: '4', title: 'Odd one', status: 'archived' }] })
    render(
      <ViewRenderer
        spec={page([
          {
            kind: 'board',
            query: 'listJobs',
            group: '$.status',
            columns: [{ value: 'quoted', label: 'Quoted' }],
            item: { title: '$.title' },
          },
        ])}
        client={client as never}
      />,
    )
    await waitFor(() => expect(screen.getByText('Other')).toBeInTheDocument())
    expect(screen.getByText('Odd one')).toBeInTheDocument()
  })

  it('`calendar` section renders the month of the earliest row, not today', async () => {
    const { client } = stubClient({ listJobs: JOBS })
    render(
      <ViewRenderer
        spec={page([{ kind: 'calendar', query: 'listJobs', date: '$.due', item: { title: '$.title' } }])}
        client={client as never}
      />,
    )
    await waitFor(() => expect(screen.getByText('August 2026')).toBeInTheDocument())
    expect(screen.getByText('Marisol shaft')).toBeInTheDocument()
  })

  it('`chart` section plots every declared chart over one endpoint', async () => {
    const { client } = stubClient({ monthly: [{ month: 'Jul', total: 10 }, { month: 'Aug', total: 30 }] })
    const { container } = render(
      <ViewRenderer
        spec={page([
          {
            kind: 'chart',
            query: 'monthly',
            charts: [
              { kind: 'bar', x: '$.month', y: '$.total', label: 'Revenue' },
              { kind: 'donut', x: '$.month', y: '$.total', label: 'Share' },
            ],
          },
        ])}
        client={client as never}
      />,
    )
    await waitFor(() => expect(screen.getByText('Revenue')).toBeInTheDocument())
    expect(screen.getByText('Share')).toBeInTheDocument()
    expect(container.querySelectorAll('svg').length).toBe(2)
  })

  it('a chart over rows with no numbers says so rather than drawing an empty plot', async () => {
    const { client } = stubClient({ monthly: [{ month: 'Jul', total: null }] })
    render(
      <ViewRenderer
        spec={page([{ kind: 'chart', query: 'monthly', charts: [{ kind: 'line', x: '$.month', y: '$.total' }] }])}
        client={client as never}
      />,
    )
    await waitFor(() => expect(screen.getByText('No data to plot')).toBeInTheDocument())
  })
})

// ── nested layouts ────────────────────────────────────────────────────────────

describe('nested layouts', () => {
  const layout: ViewLayoutSpec = {
    prefix: 'trips/[tripId]',
    sections: [
      { kind: 'detail', id: 'tripHeader', query: 'getTrip', header: { title: '$.name' } },
      { kind: 'outlet' },
    ],
  }

  it('frames a child route with the layout, outermost first', async () => {
    const { client } = stubClient({
      getTrip: { id: 't1', name: 'Tanzania 2026' },
      listExpenses: [{ id: 'e1', label: 'Flights' }],
    })
    render(
      <ViewRenderer
        spec={page([{ kind: 'list', query: 'listExpenses', item: { title: '$.label' } }], 'trips/[tripId]/expenses')}
        layouts={[layout]}
        route={{ path: 'trips/[tripId]/expenses', params: { tripId: 't1' } }}
        client={client as never}
      />,
    )
    // The frame and the child are both on the page — one render, one runtime scope.
    await waitFor(() => expect(screen.getByText('Tanzania 2026')).toBeInTheDocument())
    expect(screen.getByText('Flights')).toBeInTheDocument()
  })

  it('does NOT frame a sibling whose route merely starts with the same string', async () => {
    const { client } = stubClient({ listExpenses: [{ id: 'e1', label: 'Flights' }] })
    render(
      <ViewRenderer
        spec={page([{ kind: 'list', query: 'listExpenses', item: { title: '$.label' } }], 'trips-archive')}
        layouts={[layout]}
        route={{ path: 'trips-archive' }}
        client={client as never}
      />,
    )
    await waitFor(() => expect(screen.getByText('Flights')).toBeInTheDocument())
    expect(screen.queryByText('Tanzania 2026')).not.toBeInTheDocument()
  })

  it("a child page reads the layout's fetched data through `$data.<sectionId>`", async () => {
    const { client } = stubClient({
      getTrip: { id: 't1', name: 'Tanzania 2026' },
      listExpenses: [{ id: 'e1', label: 'Flights' }],
    })
    render(
      <ViewRenderer
        spec={page(
          [
            { kind: 'markdown', query: undefined, source: 'Expenses' },
            { kind: 'list', query: 'listExpenses', item: { title: '$.label', caption: '$data.tripHeader.name' } },
          ],
          'trips/[tripId]/expenses',
        )}
        layouts={[layout]}
        route={{ path: 'trips/[tripId]/expenses', params: { tripId: 't1' } }}
        client={client as never}
      />,
    )
    // The caption comes from the LAYOUT's section, not from this page's endpoint.
    await waitFor(() => expect(screen.getAllByText('Tanzania 2026').length).toBe(2))
  })
})

// ── the always-on assistant ───────────────────────────────────────────────────

describe('the assistant dock is renderer chrome', () => {
  it('is present with NO shell authored at all', async () => {
    const { client } = stubClient({ listJobs: [] })
    render(<ViewRenderer spec={page([{ kind: 'list', query: 'listJobs' }])} shell={{}} client={client as never} />)
    await waitFor(() => expect(screen.getByText('Assistant')).toBeInTheDocument())
  })

  it('is present when the shell authors navigation but never mentions an assistant', async () => {
    const { client } = stubClient({ listJobs: [] })
    render(
      <ViewRenderer
        spec={page([{ kind: 'list', query: 'listJobs' }])}
        shell={{ brand: 'Yard', nav: [{ route: 'index', label: 'Home' }] }}
        routes={['index']}
        client={client as never}
      />,
    )
    await waitFor(() => expect(screen.getByText('Assistant')).toBeInTheDocument())
    expect(screen.getByText('Yard')).toBeInTheDocument()
  })

  it('`assistant: false` is the one opt-out', async () => {
    const { client } = stubClient({ listJobs: [] })
    render(
      <ViewRenderer
        spec={page([{ kind: 'list', query: 'listJobs' }])}
        shell={{ assistant: false }}
        client={client as never}
      />,
    )
    await waitFor(() => expect(screen.getByText(/No jobs yet/i)).toBeInTheDocument())
    expect(screen.queryByText('Assistant')).not.toBeInTheDocument()
  })
})
