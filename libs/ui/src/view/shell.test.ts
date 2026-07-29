import { describe, it, expect } from 'vitest'
import { activeDestination, deriveNav, isStaticRoute, matchesPrefix, paramsFromRoute, subnavFor, topLevel } from './shell'
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

  it('paramsFromRoute recovers the parameter values from the live route', () => {
    expect(paramsFromRoute('trips/[tripId]', 'trips/t7/expenses')).toEqual({ tripId: 't7' })
  })

  it('isStaticRoute / topLevel', () => {
    expect(isStaticRoute('recipes/new')).toBe(true)
    expect(isStaticRoute('recipes/[id]')).toBe(false)
    expect(topLevel('searches/abc/inbox')).toBe('searches')
  })
})
