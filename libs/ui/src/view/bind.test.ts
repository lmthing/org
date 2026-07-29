import { describe, it, expect } from 'vitest'
import {
  EMPTY_SCOPE,
  fillRoute,
  isBinding,
  itemScope,
  lastSegment,
  pollWhileHolds,
  resolveArray,
  resolveBinding,
  resolveInputs,
  resolveOptional,
  resolveValue,
  routeParams,
} from './bind'

/**
 * The evaluator. These cases are the contract's §2 and its S1/S3 semantics, and they are
 * the reason the renderer can claim "no expression ever runs on the phone": everything
 * below is a walk, and the failure mode of a wrong path is `undefined`, never a throw.
 */

const scope = {
  self: { id: 'r1', title: 'Ragu', tags: ['pasta', 'slow'], nested: { deep: { n: 3 } }, total: 0 },
  props: { recipe: { name: 'Ragu' } },
  route: { tripId: 't7' },
  data: { currentPlan: { plan: { id: 'p9' } } },
  result: { id: 'new-1' },
  form: { blob: 'pasted text' },
  timezone: 'Europe/Athens',
}

describe('the binding namespace (S3) — these roots and no others', () => {
  it('resolves every root', () => {
    expect(resolveBinding('$', scope)).toBe(scope.self)
    expect(resolveBinding('$.title', scope)).toBe('Ragu')
    expect(resolveBinding('$.tags[1]', scope)).toBe('slow')
    expect(resolveBinding('$.nested.deep.n', scope)).toBe(3)
    expect(resolveBinding('$props.recipe.name', scope)).toBe('Ragu')
    expect(resolveBinding('$route.tripId', scope)).toBe('t7')
    expect(resolveBinding('$data.currentPlan.plan.id', scope)).toBe('p9')
    expect(resolveBinding('$result.id', scope)).toBe('new-1')
    expect(resolveBinding('$form.blob', scope)).toBe('pasted text')
    expect(resolveBinding('$client.timezone', scope)).toBe('Europe/Athens')
  })

  it('an unknown root is undefined, not a throw', () => {
    expect(resolveBinding('$selection.ids', scope)).toBeUndefined()
    expect(resolveBinding('$value', scope)).toBeUndefined()
  })

  it('a path off a null is undefined, not a throw', () => {
    expect(resolveBinding('$.missing.deeper.still', scope)).toBeUndefined()
    expect(resolveBinding('$.title.nope', scope)).toBeUndefined()
  })
})

describe('S1 — a null binding omits its element, a literal never does', () => {
  it('a literal is always present', () => {
    expect(resolveValue('Total', scope)).toEqual({ present: true, value: 'Total' })
    // An author who wrote an empty string wrote it on purpose.
    expect(resolveValue('', scope).present).toBe(true)
  })

  it('an unresolved binding is absent', () => {
    expect(resolveValue('$.missing', scope).present).toBe(false)
    expect(resolveValue('$.tags[9]', scope).present).toBe(false)
  })

  it('an empty string or empty array from a binding counts as absent', () => {
    expect(resolveValue('$.blank', { self: { blank: '   ' } }).present).toBe(false)
    expect(resolveValue('$.none', { self: { none: [] } }).present).toBe(false)
  })

  it('but a falsy NUMBER or BOOLEAN is present — 0 items is a fact worth showing', () => {
    expect(resolveValue('$.total', scope)).toEqual({ present: true, value: 0 })
    expect(resolveValue('$.done', { self: { done: false } })).toEqual({ present: true, value: false })
  })
})

describe('resolveInputs — an unresolved binding DISABLES the query', () => {
  it('is ready when every binding resolves', () => {
    expect(resolveInputs({ id: '$data.currentPlan.plan.id' }, scope)).toEqual({
      ready: true,
      values: { id: 'p9' },
    })
  })

  it('is not ready when one does not — replacing the hand-coded `enabled:`', () => {
    const out = resolveInputs({ id: '$data.notYet.plan.id' }, scope)
    expect(out.ready).toBe(false)
  })

  it('an absent input map is ready with no values', () => {
    expect(resolveInputs(undefined, scope)).toEqual({ ready: true, values: {} })
  })
})

describe('scope + arrays', () => {
  it('itemScope replaces `$` and carries every other root through', () => {
    const inner = itemScope(scope, { title: 'row' })
    expect(resolveBinding('$.title', inner)).toBe('row')
    expect(resolveBinding('$route.tripId', inner)).toBe('t7')
  })

  it('resolveArray yields [] for anything that is not an array', () => {
    expect(resolveArray('$.tags', scope)).toEqual(['pasta', 'slow'])
    expect(resolveArray('$.title', scope)).toEqual([])
    expect(resolveArray(undefined, scope)).toEqual([])
  })
})

describe('routes', () => {
  it('fills [param] segments', () => {
    expect(fillRoute('searches/[searchId]/inbox', { searchId: 'abc' })).toBe('searches/abc/inbox')
  })

  it('leaves an unfilled placeholder STANDING rather than writing undefined into a url', () => {
    expect(fillRoute('trips/[tripId]/expenses', {})).toBe('trips/[tripId]/expenses')
  })

  it('names its params', () => {
    expect(routeParams('trips/[tripId]/days/[dayId]')).toEqual(['tripId', 'dayId'])
  })
})

describe('poll.while — a named policy, evaluated per row, true if ANY row matches', () => {
  const rows = [{ status: 'ready' }, { status: 'parsing' }]

  it('holds while any row is in the set', () => {
    expect(pollWhileHolds({ field: '$.status', in: ['pending', 'parsing'] }, rows)).toBe(true)
  })

  it('stops when none is', () => {
    expect(pollWhileHolds({ field: '$.status', in: ['pending'] }, rows)).toBe(false)
  })

  it('polls unconditionally with no policy', () => {
    expect(pollWhileHolds(undefined, [])).toBe(true)
  })
})

describe('helpers', () => {
  it('lastSegment gives a `field` element its default arg name', () => {
    expect(lastSegment('$.completed')).toBe('completed')
    expect(lastSegment('$.meal.rating')).toBe('rating')
  })

  it('isBinding is the `$` test the schema pattern uses', () => {
    expect(isBinding('$.x')).toBe(true)
    expect(isBinding('Total')).toBe(false)
  })
})

describe('Wave-2: an argument may be a CONSTANT', () => {
  it('passes a number and a boolean through with their types intact', () => {
    // Coercing here would break every endpoint whose Input declares `type: 'number'`.
    expect(resolveInputs({ withinDays: 7, includePast: false, meal: 'dinner' }, EMPTY_SCOPE)).toEqual({
      ready: true,
      values: { withinDays: 7, includePast: false, meal: 'dinner' },
    })
  })

  it('a constant is never pending — only a binding can disable a query', () => {
    const out = resolveInputs({ meal: 'dinner', id: '$data.notYet.id' }, EMPTY_SCOPE)
    expect(out.ready).toBe(false)
  })

  it('resolveOptional returns a non-string argument as itself', () => {
    expect(resolveOptional(7, EMPTY_SCOPE)).toBe(7)
    expect(resolveOptional(false, EMPTY_SCOPE)).toBe(false)
    expect(resolveOptional('dinner', EMPTY_SCOPE)).toBe('dinner')
  })
})
