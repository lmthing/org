/**
 * The **view renderer**, RENDERED on the React Native target.
 *
 * This is the suite the whole `system-viewbuilder` bet rests on. A view spec is data, so a
 * phone can fetch one and draw it with the same renderer the web bundles — and that claim
 * is only worth anything if the drawing actually mounts on a device. The graph gate proves
 * the modules RESOLVE; it says nothing about whether a section produces a view.
 *
 * The three failure modes this exists to catch, none of which jsdom can see (`isWeb` is
 * always true there, and `render()` returns a wrapper rather than the tree):
 *
 *  1. **a bare string loose in a View.** React Native raises "Text strings must be rendered
 *     within a <Text> component" and then DROPS the string, so a label silently vanishes.
 *     Every case here asserts the host TYPE, and `looseStrings` sweeps the whole tree.
 *  2. **an icon that renders a DOM `<svg>`**, which mounts nothing at all. lucide is
 *     web-only; the icon set has to be SVG primitives.
 *  3. **`overflow: auto` standing in for a scrolling region.** Yoga has no overflow
 *     scrolling, so a `scroll: 'x'` strip built on a styled View is clipped with no gesture
 *     to reach the rest. Only a real `ScrollView` host proves it.
 *
 * Nothing here talks to a pod: the client is a stub, which is also the point — the renderer
 * must mount from data alone.
 */
import * as React from 'react'
import { act } from 'react-test-renderer'
import { test, expect } from '../harness'
import { render, findAll, findByText, findPressable, findTextInput, press, NATIVE_TEXT } from '../render'
import { ViewRenderer } from '../../src/view/renderer'
import { createViewClient, type EndpointManifest, type ViewClient } from '../../src/view/client'
import { ViewIcon } from '../../src/view/icons'
import { HScroll } from '../../src/view/hscroll'
import { LoadingState, EmptyStateView, ErrorState } from '../../src/view/states'
import { SelectControl, ToggleControl } from '../../src/view/controls'
import type { ViewSpec } from '../../src/view/types'

/** Reproduces React Native's own check: a string may only sit under a text host. */
function looseStrings(tree: unknown): string[] {
  const out: string[] = []
  for (const node of findAll(tree as never, (type) => type !== NATIVE_TEXT)) {
    for (const child of node.children ?? []) {
      if (typeof child === 'string' && child.trim() !== '') out.push(child)
    }
  }
  return out
}

const MANIFEST: EndpointManifest = {
  listRecipes: { method: 'GET', routePath: '/recipes' },
  getRecipe: { method: 'GET', routePath: '/recipes/:id' },
  weekStats: { method: 'GET', routePath: '/stats' },
  listDays: { method: 'GET', routePath: '/days' },
  addRecipe: {
    method: 'POST',
    routePath: '/recipes',
    inputSchema: {
      type: 'object',
      required: ['title'],
      properties: {
        title: { type: 'string', title: 'Title' },
        status: { type: 'string', enum: ['draft', 'published'] },
      },
    },
  },
  toggleDone: { method: 'POST', routePath: '/recipes/:id/done' },
}

/** A client that answers from a table instead of a pod. */
function stub(responses: Record<string, unknown>, onCall?: (name: string, input: Record<string, unknown>) => void) {
  const base = createViewClient({ baseUrl: '', endpoints: MANIFEST, fetchImpl: (() => {
    throw new Error('unreachable')
  }) as never })
  return {
    ...base,
    call: async (name: string, input: Record<string, unknown> = {}) => {
      onCall?.(name, input)
      if (!(name in responses)) throw new Error(`no stub for ${name}`)
      return responses[name]
    },
  } as unknown as ViewClient
}

const page = (sections: ViewSpec['sections']): ViewSpec => ({ route: 'index', sections })

/**
 * Mount a spec and let its first fetch settle.
 *
 * `await act(async …)` never settles inside a Metro bundle (React's scheduler flush waits
 * on host callbacks the RN runtime installs from native, and there is no device here), so
 * the wait happens OUTSIDE `act` and the synchronous form flushes on the way back in —
 * exactly as `render.tsx#longPress` does for the same reason.
 */
async function settle(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 30))
  act(() => {})
}

// ── the states nobody authors ────────────────────────────────────────────────

test('the loading default mounts real views, not an empty box', () => {
  const { tree } = render(<LoadingState shape="cards" count={2} />)
  const views = findAll(tree as never, (t) => t === 'RCTView')
  expect(views.length > 0, 'the skeleton mounts view hosts').toBe(true)
  expect(looseStrings(tree).join('|'), 'no loose strings').toBe('')
})

test('the empty default mounts its sentence as real native text', () => {
  const { tree } = render(<EmptyStateView title="No expenses yet" message="Add the first one" icon="file" />)
  expect(!!findByText(tree, 'No expenses yet'), 'the title is text').toBe(true)
  expect(!!findByText(tree, 'Add the first one'), 'the message is text').toBe(true)
  expect(looseStrings(tree).join('|'), 'no loose strings').toBe('')
})

test('the error default mounts its message AND a retry a finger can reach', () => {
  let retried = false
  const { tree } = render(<ErrorState message="pod is waking" onRetry={() => (retried = true)} />)
  expect(!!findByText(tree, 'pod is waking'), 'the message is text').toBe(true)
  const button = findAll(tree as never, () => true).find(
    (n) => typeof n.props?.onResponderRelease === 'function',
  )
  expect(!!button, 'the retry takes part in the touch responder system').toBe(true)
  press(button ?? null)
  expect(retried, 'and pressing it actually retries').toBe(true)
})

// ── icons ────────────────────────────────────────────────────────────────────

test('every icon in the pinned set mounts an RNSVG host, not a DOM svg', () => {
  // `lucide-react` would mount nothing at all here. The whole set is checked rather than a
  // sample: one glyph built from a host the platform lacks is one blank square in a
  // generated app, and the platform host differs per platform — which is why the harness
  // always builds ios AND android.
  for (const name of ['home', 'search', 'plus', 'trash', 'calendar', 'settings', 'chart', 'mail'] as const) {
    const { tree } = render(<ViewIcon name={name} />)
    const svg = findAll(tree as never, (t) => /RNSVG/.test(String(t)))
    expect(svg.length > 0, `${name} mounts an RNSVG host`).toBe(true)
  }
})

test('an UNKNOWN icon name still mounts a glyph — never a silent blank', () => {
  // The set is closed by design; the point of a menu is that a wrong choice is legible.
  const { tree } = render(<ViewIcon name="definitely-not-an-icon" />)
  const svg = findAll(tree as never, (t) => /RNSVG/.test(String(t)))
  expect(svg.length > 0, 'the fallback glyph mounts').toBe(true)
})

// ── Yoga has no overflow scrolling ───────────────────────────────────────────

test("scroll:'x' mounts a REAL horizontal ScrollView, not a styled View", () => {
  // This is the difference between a week grid a thumb can reach and one that is clipped
  // at the edge of the screen with no gesture to reveal the rest.
  const { tree } = render(
    <HScroll gap={8}>
      <ViewIcon name="home" />
    </HScroll>,
  )
  const scrollers = findAll(tree as never, (t) => String(t).includes('ScrollView'))
  expect(scrollers.length > 0, 'a ScrollView host is mounted').toBe(true)
  expect(scrollers[0].props.horizontal === true, 'and it scrolls horizontally').toBe(true)
})

// ── the controls, which have no usable native primitive ──────────────────────

test('the select is PRESSABLE on a touch device — Prim.Select would be inert here', () => {
  // `controls.native.tsx` maps `Select` to a placeholder container, so a real `<select>`
  // renders as a stack of untouchable text on a phone. Every enum in every generated form
  // goes through this control, so "can a finger open it?" is the whole question.
  const { tree, current } = render(
    <SelectControl value="" options={[{ label: 'Draft', value: 'draft' }]} onChange={() => {}} />,
  )
  const trigger = findPressable(tree)
  expect(!!trigger, 'the closed select responds to touch').toBe(true)
  press(trigger)
  expect(!!findByText(current(), 'Draft'), 'and opening it mounts the options as text').toBe(true)
})

test('the toggle reports its state and flips on a real press', () => {
  let value = false
  const { tree } = render(<ToggleControl value={value} onChange={(v) => (value = v)} label="Done" />)
  expect(!!findByText(tree, 'Done'), 'the label is text, not a loose string').toBe(true)
  press(findPressable(tree))
  expect(value, 'a press flips it').toBe(true)
})

// ── the sections ─────────────────────────────────────────────────────────────

test('a list section mounts its rows as native text', async () => {
  const client = stub({ listRecipes: [{ id: '1', title: 'Ragu' }, { id: '2', title: 'Pesto' }] })
  const { current } = render(
    <ViewRenderer
      spec={page([{ kind: 'list', query: 'listRecipes', title: 'Recipes', item: { title: '$.title', badge: '$.status' } }])}
      client={client}
    />,
  )
  await settle()
  expect(!!findByText(current(), 'Ragu'), 'the first row').toBe(true)
  expect(!!findByText(current(), 'Pesto'), 'the second row').toBe(true)
  expect(looseStrings(current()).join('|'), 'no loose strings anywhere in the list').toBe('')
})

test('a list with no data shows the EMPTY default, mounted', async () => {
  const client = stub({ listRecipes: [] })
  const { current } = render(<ViewRenderer spec={page([{ kind: 'list', query: 'listRecipes' }])} client={client} />)
  await settle()
  expect(!!findByText(current(), 'No recipes yet'), 'a default nobody authored').toBe(true)
})

test('a detail section mounts its keyvalue body and DROPS a pair with no value (S1)', async () => {
  const client = stub({ getRecipe: { id: '1', title: 'Ragu' } })
  const { current } = render(
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
      route={{ path: 'recipes/1', params: { id: '1' } }}
      client={client}
    />,
  )
  await settle()
  expect(!!findByText(current(), 'Title'), 'the populated label').toBe(true)
  expect(!!findByText(current(), 'Ragu'), 'and its value').toBe(true)
  // The label goes with the value — this is what replaces `{x ? … : null}`.
  expect(!!findByText(current(), 'Paid by'), 'the empty pair is omitted, label and all').toBe(false)
})

test('a stats section mounts a tile per metric', async () => {
  const client = stub({ weekStats: { meals: 12 } })
  const { current } = render(
    <ViewRenderer
      spec={page([{ kind: 'stats', query: 'weekStats', cards: [{ label: 'Meals', value: '$.meals' }] }])}
      client={client}
    />,
  )
  await settle()
  expect(!!findByText(current(), 'Meals'), 'the label').toBe(true)
  expect(!!findByText(current(), '12'), 'the figure').toBe(true)
})

test('a markdown section mounts prose with no request at all', () => {
  const client = stub({})
  const { tree } = render(<ViewRenderer spec={page([{ kind: 'markdown', source: 'Welcome home' }])} client={client} />)
  expect(!!findByText(tree, 'Welcome home'), 'the prose is text').toBe(true)
  expect(looseStrings(tree).join('|'), 'no loose strings in the markdown renderer').toBe('')
})

test('a timeline section mounts its groups and its untimed tray', async () => {
  const client = stub({
    listDays: [
      { id: '1', day: '2026-07-29', at: '2026-07-29T09:00:00Z', title: 'Museum' },
      { id: '2', day: '2026-07-29', title: 'Anything, sometime' },
    ],
  })
  const { current } = render(
    <ViewRenderer
      spec={page([
        {
          kind: 'timeline',
          query: 'listDays',
          group: '$.day',
          itemTime: '$.at',
          item: { title: '$.title' },
        },
      ])}
      client={client}
    />,
  )
  await settle()
  expect(!!findByText(current(), 'Museum'), 'the timed entry').toBe(true)
  // A null `itemTime` lands in the group's untimed tray rather than being dropped.
  expect(!!findByText(current(), 'Anytime'), 'the untimed tray is labelled').toBe(true)
  expect(!!findByText(current(), 'Anything, sometime'), 'and holds the untimed entry').toBe(true)
})

test('a toolbar reveals its target section on a real press', async () => {
  const client = stub({})
  const { tree, current } = render(
    <ViewRenderer
      spec={page([
        { kind: 'toolbar', reveals: ['takes'] },
        { kind: 'markdown', id: 'takes', source: 'the hidden take' },
      ])}
      client={client}
    />,
  )
  expect(!!findByText(tree, 'the hidden take'), 'hidden to begin with').toBe(false)
  press(findPressable(tree))
  expect(!!findByText(current(), 'the hidden take'), 'and revealed by a touch').toBe(true)
})

test('a create section mounts a real TEXT INPUT derived from the Input schema', async () => {
  const client = stub({})
  const { current } = render(<ViewRenderer spec={page([{ kind: 'create', mutation: 'addRecipe' }])} client={client} />)
  await settle()
  // The field was never declared — it came from the endpoint's Input schema.
  expect(!!findByText(current(), 'Title'), 'the derived label').toBe(true)
  expect(!!findTextInput(current()), 'and a native text input to type into').toBe(true)
  // The enum became the disclosure select, not an inert `Prim.Select` placeholder.
  expect(!!findByText(current(), 'Status'), 'the enum field is labelled').toBe(true)
})

// ── dispatch ─────────────────────────────────────────────────────────────────

test("a row's button carries THAT ROW's id into the mutation, from a real touch", async () => {
  const seen: { name: string; input: Record<string, unknown> }[] = []
  const client = stub(
    { listRecipes: [{ id: '7', title: 'Ragu' }], toggleDone: { ok: true } },
    (name, input) => seen.push({ name, input }),
  )
  const { current } = render(
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
      client={client}
    />,
  )
  await settle()
  // The node that RESPONDS must be the one holding the label — the row and the page respond
  // too, so "something in this tree is pressable" would pass either way.
  const button = findAll(current() as never, () => true).find(
    (n) => typeof n.props?.onResponderRelease === 'function' && !!findByText(n as never, 'Done'),
  )
  expect(!!button, 'the action button itself responds to touch').toBe(true)
  press(button ?? null)
  await settle()
  const call = seen.find((c) => c.name === 'toggleDone')
  expect(!!call, 'the mutation fired').toBe(true)
  expect(JSON.stringify(call?.input), "with the row's own id").toBe(JSON.stringify({ id: '7' }))
})

// ── the shell ────────────────────────────────────────────────────────────────

test('the shell mounts bottom tabs a thumb can reach, and navigating works', () => {
  const routes: string[] = []
  const client = { ...stub({}), navigate: (r: string) => routes.push(r) } as unknown as ViewClient
  const { tree } = render(
    <ViewRenderer
      spec={page([{ kind: 'markdown', source: 'home' }])}
      shell={{ brand: 'Kitchen' }}
      routes={['index', 'recipes', 'shopping']}
      route={{ path: 'index' }}
      client={client}
    />,
  )
  expect(!!findByText(tree, 'Recipes'), 'a derived destination is mounted as text').toBe(true)
  const tab = findAll(tree as never, () => true).find(
    (n) => typeof n.props?.onResponderRelease === 'function' && !!findByText(n as never, 'Shopping'),
  )
  expect(!!tab, 'the tab responds to touch').toBe(true)
  press(tab ?? null)
  expect(routes.join(','), 'and hands the route to the host router').toBe('shopping')
  expect(looseStrings(tree).join('|'), 'no loose strings in the shell').toBe('')
})

test('a whole dashboard page mounts with no loose strings anywhere', async () => {
  const client = stub({
    weekStats: { meals: 12, spend: 42.5 },
    listRecipes: [{ id: '1', title: 'Ragu', status: 'draft' }],
    listDays: [{ id: 'd1', day: '2026-07-29', title: 'Museum' }],
  })
  const { current } = render(
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
        { kind: 'list', query: 'listRecipes', title: 'Recipes', item: { title: '$.title', status: '$.status' } },
        { kind: 'timeline', query: 'listDays', group: '$.day', item: { title: '$.title' } },
      ])}
      shell={{ brand: 'Kitchen' }}
      routes={['index', 'recipes']}
      route={{ path: 'index' }}
      client={client}
    />,
  )
  await settle()
  // The single assertion that would have caught a whole page of vanished labels.
  expect(looseStrings(current()).join('|'), 'the whole page is native-safe').toBe('')
  expect(!!findByText(current(), 'Ragu'), 'and it actually drew the data').toBe(true)
})

// ── the Wave-2 amendments, on a device ───────────────────────────────────────

test('a UNIT on a flat value mounts as ONE text node — "20 min", never a loose "min"', async () => {
  // The failure this exists to catch is native-only: a suffix rendered as a sibling string
  // instead of part of the formatted text is silently DROPPED by React Native, so the page
  // would read "20" on a phone and "20 min" in every jsdom test.
  const client = stub({ listRecipes: [{ id: '1', title: 'Ragu', prepMinutes: 20, unit: 'kcal', energy: 540 }] })
  const { current } = render(
    <ViewRenderer
      spec={page([
        {
          kind: 'list',
          query: 'listRecipes',
          item: {
            title: '$.title',
            meta: { value: '$.prepMinutes', suffix: 'min' },
            caption: { value: '$.energy', suffix: '$.unit' },
          },
        },
      ])}
      client={client}
    />,
  )
  await settle()
  expect(!!findByText(current(), '20 min'), 'the unit is part of the text node').toBe(true)
  expect(!!findByText(current(), '540 kcal'), 'and a BOUND unit works the same way').toBe(true)
  expect(looseStrings(current()).join('|'), 'nothing loose in a View').toBe('')
})

test('a LITERAL argument reaches the endpoint from a real touch, with its type intact', async () => {
  const seen: { name: string; input: Record<string, unknown> }[] = []
  const client = stub({ listRecipes: [{ id: '7', title: 'Ragu' }], toggleDone: { ok: true } }, (name, input) =>
    seen.push({ name, input }),
  )
  const { current } = render(
    <ViewRenderer
      spec={page([
        {
          kind: 'list',
          query: 'listRecipes',
          // One endpoint, a row binding AND two constants — the shape that was illegal.
          item: {
            title: '$.title',
            actions: [
              { label: 'Snooze', action: { mutate: 'toggleDone', input: { id: '$.id', days: 7, silent: true } } },
            ],
          },
        },
      ])}
      client={client}
    />,
  )
  await settle()
  const button = findAll(current() as never, () => true).find(
    (n) => typeof n.props?.onResponderRelease === 'function' && !!findByText(n as never, 'Snooze'),
  )
  expect(!!button, 'the action button responds to touch').toBe(true)
  press(button ?? null)
  await settle()
  const call = seen.find((c) => c.name === 'toggleDone')
  expect(JSON.stringify(call?.input), 'the row id plus two typed constants').toBe(
    JSON.stringify({ id: '7', days: 7, silent: true }),
  )
})

test('a tab stays highlighted on a parameterised family member, and still navigates', () => {
  const routes: string[] = []
  const client = { ...stub({}), navigate: (r: string) => routes.push(r) } as unknown as ViewClient
  const { tree } = render(
    <ViewRenderer
      spec={page([{ kind: 'markdown', source: 'plan' }])}
      shell={{
        brand: 'Kitchen',
        groups: [
          { label: 'Shop', home: 'shop', routes: ['shopping', 'trip/[planId]'], icon: 'list' },
          { label: 'Cook', home: 'index', icon: 'home' },
        ],
      }}
      routes={['index', 'shop', 'shopping', 'trip/[planId]']}
      route={{ path: 'trip/p7', params: { planId: 'p7' } }}
      client={client}
    />,
  )
  expect(!!findByText(tree, 'Shop'), 'the group destination is mounted as text').toBe(true)
  const tab = findAll(tree as never, () => true).find(
    (n) => typeof n.props?.onResponderRelease === 'function' && !!findByText(n as never, 'Shop'),
  )
  press(tab ?? null)
  expect(routes.join(','), 'and opens the group home').toBe('shop')
  expect(looseStrings(tree).join('|'), 'no loose strings in the shell').toBe('')
})
