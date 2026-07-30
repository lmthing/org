import { describe, it, expect } from 'vitest'
import {
  activeDestination,
  deriveNav,
  isStaticRoute,
  matchesPrefix,
  paramsFromRoute,
  routeShapeMatches,
  subnavFor,
  topLevel,
} from './shell'
import { SHELL_DERIVE_MAX_ROUTES, type ShellSpec } from './types'

describe('nav derivation', () => {
  it('derives from a small route list', () => {
    const nav = deriveNav(undefined, ['index', 'recipes', 'recipes/[id]', 'shopping'])
    expect(nav.source).toBe('derived')
    expect(nav.destinations.map((d) => d.label)).toEqual(['Home', 'Recipes', 'Shopping'])
  })

  it('never makes a nav item of a parameterised route — those are drill-ins', () => {
    const nav = deriveNav(undefined, ['index', 'feed/[articleId]', 'searches/[searchId]/compare'])
    expect(nav.destinations.map((d) => d.home)).toEqual(['index'])
  })

  it('STOPS deriving above the threshold rather than mispredicting a 13-item phone bar', () => {
    const routes = ['index', 'a', 'b', 'c', 'd', 'e', 'f']
    expect(routes.length).toBeGreaterThan(SHELL_DERIVE_MAX_ROUTES)
    const nav = deriveNav(undefined, routes)
    expect(nav.source).toBe('undecidable')
    expect(nav.destinations).toEqual([])
    // The reason is the message a validator surfaces to the model.
    expect(nav.reason).toContain('shell.groups')
  })

  it('declared groups win, and carry their whole route family', () => {
    const shell: ShellSpec = {
      groups: [
        { label: 'Kitchen', home: 'shopping', routes: ['shop', 'trip'], icon: 'list' },
        { label: 'Plan', home: 'index' },
      ],
    }
    const nav = deriveNav(shell, ['index', 'shopping', 'shop', 'trip', 'a', 'b', 'c', 'd'])
    expect(nav.source).toBe('declared-groups')
    expect(nav.destinations[0].family).toEqual(['shopping', 'shop', 'trip'])
  })

  it('a declared flat nav is used as written', () => {
    const nav = deriveNav({ nav: [{ route: 'inbox', label: 'Inbox', icon: 'mail' }] }, ['inbox', 'index'])
    expect(nav.source).toBe('declared-nav')
    expect(nav.destinations[0].label).toBe('Inbox')
  })

  it('an empty app derives nothing and says so without failing', () => {
    expect(deriveNav(undefined, []).destinations).toEqual([])
  })
})

describe('the active destination', () => {
  const nav = deriveNav(undefined, ['index', 'recipes', 'shopping'])

  it('matches the exact route', () => {
    expect(activeDestination(nav.destinations, 'recipes')).toBe('recipes')
  })

  it('and keeps the family highlighted on a sub-route', () => {
    expect(activeDestination(nav.destinations, 'recipes/new')).toBe('recipes')
  })
})

describe('subnav — entity-scoped, declared once per route family', () => {
  const shell: ShellSpec = {
    subnav: [
      {
        match: 'trips/[tripId]',
        items: [
          { route: 'trips/[tripId]/expenses', label: 'Expenses' },
          { route: 'trips/[tripId]/timeline', label: 'Timeline' },
        ],
      },
    ],
  }

  it('applies to every page under the parameterised prefix', () => {
    const sub = subnavFor(shell, 'trips/t7/expenses', { tripId: 't7' })
    expect(sub?.items.map((i) => i.route)).toEqual(['trips/t7/expenses', 'trips/t7/timeline'])
  })

  it('does not apply outside the family', () => {
    expect(subnavFor(shell, 'index', {})).toBeUndefined()
  })

  it('flattens the grouped form — 15 tabs in 3 groups is one bar', () => {
    const grouped: ShellSpec = {
      subnav: [
        {
          match: 'trips/[tripId]',
          groups: [
            { label: 'Money', items: [{ route: 'trips/[tripId]/expenses' }] },
            { label: 'Plan', items: [{ route: 'trips/[tripId]/timeline' }] },
          ],
        },
      ],
    }
    expect(subnavFor(grouped, 'trips/t7', { tripId: 't7' })?.items).toHaveLength(2)
  })
})

describe('route helpers', () => {
  it('matchesPrefix compares segment SHAPES, so [tripId] matches whatever is in the slot', () => {
    expect(matchesPrefix('trips/[tripId]', 'trips/t7/expenses')).toBe(true)
    expect(matchesPrefix('trips/[tripId]', 'trips')).toBe(false)
    expect(matchesPrefix('trips/[tripId]', 'homes/h1/expenses')).toBe(false)
  })

  it('a parameterised subnav does NOT capture a STATIC sibling route', () => {
    // Seen live on the emulator: `plants/new` drew the DETAIL page's subnav, because `[id]` accepts
    // any non-empty segment and `new` is one. Its "Details" pill then navigated to the literal
    // `plants/[id]` with no params, onto a page whose every query was unresolvable.
    const shell: ShellSpec = {
      subnav: [{ match: 'plants/[id]', items: [{ route: 'plants/[id]', label: 'Details' }] }],
    }
    const routes = ['index', 'plants', 'plants/[id]', 'plants/new']

    // `new` is a declared static route, so it owns the path and the parameter yields.
    expect(subnavFor(shell, 'plants/new', {}, routes)).toBeUndefined()
    // A real id is not a declared route, so the subnav still applies — the feature must survive.
    expect(subnavFor(shell, 'plants/p1', { id: 'p1' }, routes)?.items).toHaveLength(1)
    // matchesPrefix itself is unchanged: it is a shape test and still answers `true` for both.
    expect(matchesPrefix('plants/[id]', 'plants/new')).toBe(true)
  })

  it('paramsFromRoute recovers the parameter values from the live route', () => {
    expect(paramsFromRoute('trips/[tripId]', 'trips/t7/expenses')).toEqual({ tripId: 't7' })
  })

  it('isStaticRoute / topLevel', () => {
    expect(isStaticRoute('recipes/new')).toBe(true)
    expect(isStaticRoute('recipes/[id]')).toBe(false)
    expect(topLevel('searches/abc/inbox')).toBe('searches')
  })
})

describe('Wave-2: a highlight family may be parameterised', () => {
  // Kitchen's real `_layout.tsx` keeps one tab lit for /shop ↔ /shopping ↔ /trip/:planId.
  const shell: ShellSpec = {
    groups: [
      { label: 'Shop', home: 'shop', routes: ['shopping', 'trip/[planId]'] },
      { label: 'Cook', home: 'index' },
    ],
  }
  const nav = deriveNav(shell, ['index', 'shop', 'shopping', 'trip/[planId]'])

  it('highlights the tab on the live drill-in route', () => {
    // A string compare could never match `trip/p7` against `trip/[planId]`, which is what
    // left drill-ins belonging to no tab at all.
    expect(activeDestination(nav.destinations, 'trip/p7')).toBe('shop')
    expect(activeDestination(nav.destinations, 'shopping')).toBe('shop')
    expect(activeDestination(nav.destinations, 'index')).toBe('index')
  })

  it('matches by segment SHAPE, not by prefix', () => {
    expect(routeShapeMatches('trip/[planId]', 'trip/p7')).toBe(true)
    expect(routeShapeMatches('trip/[planId]', 'trip')).toBe(false)
    expect(routeShapeMatches('trip/[planId]', 'plan/p7')).toBe(false)
    expect(routeShapeMatches('shopping', 'shopping')).toBe(true)
  })
})
