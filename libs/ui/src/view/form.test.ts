import { describe, it, expect } from 'vitest'
import { controlFor, deriveFields, initialValues, isComplete, mergeFillEmpty, type JsonSchemaNode } from './form'

/**
 * A `create` section declares NO fields — these come from the mutation's Input JSON Schema.
 * The three cases the desk check actually blocked on are the last three describes.
 */

const schema: JsonSchemaNode = {
  type: 'object',
  required: ['title', 'status'],
  properties: {
    title: { type: 'string', title: 'Recipe name' },
    notes: { type: 'string', maxLength: 4000 },
    status: { type: 'string', enum: ['draft', 'published'] },
    servings: { type: 'integer', minimum: 1 },
    isFavourite: { type: 'boolean' },
    tags: { type: 'array', items: { type: 'string' } },
    commuteTargets: {
      type: 'array',
      items: {
        type: 'object',
        required: ['label'],
        properties: { label: { type: 'string' }, address: { type: 'string' }, maxMinutes: { type: 'integer' } },
      },
    },
    paidByTravelerId: {
      type: 'string',
      'x-options': { query: 'listTravelers', label: '$.name', value: '$.id' },
    },
    tripId: { type: 'string' },
  },
}

describe('control derivation', () => {
  it('picks a control per property type', () => {
    expect(controlFor({ type: 'string' })).toBe('text')
    expect(controlFor({ type: 'string', maxLength: 4000 })).toBe('textarea')
    expect(controlFor({ type: 'string', enum: ['a', 'b'] })).toBe('select')
    expect(controlFor({ type: 'boolean' })).toBe('boolean')
    expect(controlFor({ type: 'integer' })).toBe('number')
    expect(controlFor({ type: 'array', items: { type: 'string' } })).toBe('string-list')
  })

  it('labels from `title`, falling back to a humanised key', () => {
    const fields = deriveFields(schema)
    expect(fields.find((f) => f.key === 'title')?.label).toBe('Recipe name')
    expect(fields.find((f) => f.key === 'isFavourite')?.label).toBe('Is Favourite')
  })

  it('carries `required` through — it is what gates submit', () => {
    const fields = deriveFields(schema)
    expect(fields.find((f) => f.key === 'title')?.required).toBe(true)
    expect(fields.find((f) => f.key === 'notes')?.required).toBe(false)
  })

  it('HIDES the keys the page supplies — a parent id is not a question for the user', () => {
    const fields = deriveFields(schema, new Set(['tripId']))
    expect(fields.map((f) => f.key)).not.toContain('tripId')
  })

  it('an endpoint with no Input schema derives no fields rather than throwing', () => {
    expect(deriveFields(undefined)).toEqual([])
  })
})

describe('the three cases the desk check blocked on', () => {
  it('an enum becomes a select', () => {
    expect(deriveFields(schema).find((f) => f.key === 'status')?.control).toBe('select')
  })

  it('an array-of-object becomes a repeating row group — `homes/new` commute targets', () => {
    expect(deriveFields(schema).find((f) => f.key === 'commuteTargets')?.control).toBe('object-list')
  })

  it('`x-options` becomes an endpoint-sourced select, NOT a raw UUID text box', () => {
    const field = deriveFields(schema).find((f) => f.key === 'paidByTravelerId')
    expect(field?.control).toBe('query-select')
    expect(field?.schema['x-options']?.query).toBe('listTravelers')
  })
})

describe('values', () => {
  it('seeds defaults, false booleans and empty lists', () => {
    const values = initialValues(deriveFields(schema))
    expect(values.isFavourite).toBe(false)
    expect(values.tags).toEqual([])
    expect(values.commuteTargets).toEqual([])
  })

  it('completeness gates submit on the REQUIRED keys only', () => {
    const fields = deriveFields(schema)
    expect(isComplete(fields, { title: 'Ragu' })).toBe(false)
    expect(isComplete(fields, { title: 'Ragu', status: 'draft' })).toBe(true)
    expect(isComplete(fields, { title: '   ', status: 'draft' })).toBe(false)
  })
})

describe('prefill merge: fill-empty — the only policy in v1', () => {
  const fields = deriveFields(schema)

  it('fills what the user has not touched and leaves the rest alone', () => {
    const out = mergeFillEmpty({ title: 'Mine' }, { title: 'Theirs', notes: 'from the endpoint' }, fields)
    expect(out.title).toBe('Mine')
    expect(out.notes).toBe('from the endpoint')
  })

  it('ignores keys that are not fields of this form', () => {
    const out = mergeFillEmpty({}, { notAField: 'x' }, fields)
    expect(out.notAField).toBeUndefined()
  })

  it('treats an empty array and an untouched false as empty', () => {
    const out = mergeFillEmpty({ tags: [], isFavourite: false }, { tags: ['pasta'], isFavourite: true }, fields)
    expect(out.tags).toEqual(['pasta'])
    expect(out.isFavourite).toBe(true)
  })
})
