import { describe, it, expect } from 'vitest'
import { entityOf, isGridCell, predictArchetype, revealTargetsOf, sameEntity, ARCHETYPE_WIDTH } from './archetype'
import type { SectionSpec, ViewSpec } from './types'

const page = (sections: SectionSpec[], layout?: ViewSpec['layout']): ViewSpec => ({
  route: 'index',
  ...(layout ? { layout } : {}),
  sections,
})

const list = (query: string, id?: string): SectionSpec => ({ kind: 'list', query, ...(id ? { id } : {}) })
const create = (mutation: string, invalidates?: string[]): SectionSpec => ({
  kind: 'create',
  mutation,
  ...(invalidates ? { invalidates } : {}),
})

describe('archetype prediction', () => {
  it('stats + several collections ⇒ dashboard', () => {
    const d = predictArchetype(page([{ kind: 'stats', query: 'summary', cards: [] }, list('listA'), list('listB')]))
    expect(d.archetype).toBe('dashboard')
    expect(d.authored).toBe(false)
  })

  it('a single collection ⇒ list', () => {
    expect(predictArchetype(page([{ kind: 'toolbar' }, list('listRecipes')])).archetype).toBe('list')
  })

  it('detail + related collections ⇒ detail', () => {
    expect(predictArchetype(page([{ kind: 'detail', query: 'getTrip' }, list('listExpenses')])).archetype).toBe('detail')
  })

  it('create only ⇒ form', () => {
    expect(predictArchetype(page([create('addRecipe')])).archetype).toBe('form')
  })

  it('anything unrecognised ⇒ `stack`, the explicit fallback', () => {
    expect(predictArchetype(page([{ kind: 'markdown', source: '# hi' }])).archetype).toBe('stack')
    expect(predictArchetype(page([{ kind: 'chat', agent: 'chef' }])).archetype).toBe('stack')
  })

  it('an authored layout wins and is recorded as an override — the ratchet metric', () => {
    const d = predictArchetype(page([list('listRecipes')], 'dashboard'))
    expect(d.archetype).toBe('dashboard')
    expect(d.authored).toBe(true)
  })

  it('every archetype has a content width — a form is not a metre-wide line of inputs', () => {
    expect(ARCHETYPE_WIDTH.form).toBeLessThan(ARCHETYPE_WIDTH.dashboard)
  })
})

describe('rule (b) — create + collection on one entity ⇒ a list page with a header form', () => {
  it('recognises the pairing through `invalidates` — the declared signal', () => {
    const spec = page([create('addRecipe', ['listRecipes']), list('listRecipes')])
    const d = predictArchetype(spec)
    expect(d.archetype).toBe('list')
    expect(d.headerCreateIndex).toBe(0)
  })

  it('and through the entity noun when nothing was declared', () => {
    const d = predictArchetype(page([create('addRecipe'), list('listRecipes')]))
    expect(d.archetype).toBe('list')
    expect(d.headerCreateIndex).toBe(0)
  })

  it('does NOT pair a create with an unrelated collection', () => {
    const d = predictArchetype(page([create('addRecipe'), list('listExpenses')]))
    expect(d.headerCreateIndex).toBe(-1)
  })

  it('entityOf strips the verb and normalises the plural', () => {
    expect(entityOf('addRecipe')).toBe(entityOf('listRecipes'))
    expect(entityOf('createCategory')).toBe(entityOf('listCategories'))
    expect(entityOf(undefined)).toBe('')
  })

  it('sameEntity only ever pairs a create with a collection', () => {
    expect(sameEntity(create('addRecipe'), list('listRecipes'))).toBe(true)
    expect(sameEntity(list('listRecipes'), list('listRecipes'))).toBe(false)
  })
})

describe('rule (a) — an archetype NEVER reorders sections', () => {
  it('the section array is the render order, whatever the archetype', () => {
    // `kitchen/index`'s shape: the hero card FIRST, the stats strip after. A
    // "stats on top" heuristic would bury the one thing the page exists to show.
    const spec = page([
      { kind: 'detail', query: 'tonight', id: 'hero' },
      { kind: 'stats', query: 'weekStats', cards: [] },
      list('listMeals'),
    ])
    const d = predictArchetype(spec)
    // Nothing in the decision names an ordering — it carries a width/grid verdict only.
    expect(Object.keys(d).sort()).toEqual(['archetype', 'authored', 'headerCreateIndex', 'reason'])
    expect(spec.sections.map((s) => s.kind)).toEqual(['detail', 'stats', 'list'])
  })
})

describe('rule (c) — master-detail stays unexercised in v1', () => {
  it('the shape that would be master-detail renders as a detail page, deliberately', () => {
    const d = predictArchetype(page([list('listRecipes'), { kind: 'detail', query: 'getRecipe' }]))
    expect(d.archetype).toBe('detail')
    expect(d.archetype).not.toBe('master-detail')
  })
})

describe('reveal targets', () => {
  it('collects every id named by a `reveals` anywhere on the page', () => {
    const spec = page([
      { kind: 'toolbar', reveals: ['takes'] },
      { kind: 'list', query: 'listX', item: { el: 'button', label: 'more', reveals: ['notes'] } },
      { kind: 'markdown', id: 'takes', source: 'x' },
    ])
    expect([...revealTargetsOf(spec)].sort()).toEqual(['notes', 'takes'])
  })

  it('a page with no reveals hides nothing', () => {
    expect(revealTargetsOf(page([list('listX')])).size).toBe(0)
  })
})

describe('grid cells', () => {
  it('only a dashboard grids, and only over its collections', () => {
    expect(isGridCell('dashboard', list('a'))).toBe(true)
    expect(isGridCell('dashboard', { kind: 'stats', query: 'q', cards: [] })).toBe(false)
    expect(isGridCell('list', list('a'))).toBe(false)
  })
})
