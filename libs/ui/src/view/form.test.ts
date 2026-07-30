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

  /**
   * `ts-json-schema-generator` emits a NAMED `Input` type as a root `$ref` with a `definitions` map —
   * and a named type (`export type Input = CreatePlantInput`) is the shape the pipeline TEACHES, so
   * this is the normal case. Reading `properties` off that root found nothing, so EVERY create form
   * derived zero fields and rendered "Nothing to fill in." above a Save button. Measured on two
   * model-built apps, web and native (0 `EditText` nodes).
   */
  describe('a root $ref — the shape a named Input actually serves', () => {
    const refSchema: JsonSchemaNode = {
      $ref: '#/definitions/Body',
      definitions: {
        Body: {
          type: 'object',
          properties: {
            name: { type: 'string' },
            room: { type: 'string' },
            watering_interval_days: { type: 'number' },
            last_watered: { type: 'string' },
          },
          required: ['name', 'room', 'watering_interval_days'],
        },
      },
    } as unknown as JsonSchemaNode

    it('follows it and derives the real fields', () => {
      const fields = deriveFields(refSchema)
      expect(fields.map((f) => f.key)).toEqual(['name', 'room', 'watering_interval_days', 'last_watered'])
      expect(fields.find((f) => f.key === 'watering_interval_days')?.control).toBe('number')
      // `required` lives on the RESOLVED node, so it has to survive the hop.
      expect(fields.find((f) => f.key === 'name')?.required).toBe(true)
      expect(fields.find((f) => f.key === 'last_watered')?.required).toBe(false)
    })

    it('still hides the keys the page supplies', () => {
      expect(deriveFields(refSchema, new Set(['room'])).map((f) => f.key)).not.toContain('room')
    })

    it('resolves a PROPERTY that is itself a ref, so its control is picked from the real node', () => {
      const nested = {
        $ref: '#/definitions/Outer',
        definitions: {
          Outer: { type: 'object', properties: { flag: { $ref: '#/definitions/Flag' } }, required: [] },
          Flag: { type: 'boolean' },
        },
      } as unknown as JsonSchemaNode
      expect(deriveFields(nested).find((f) => f.key === 'flag')?.control).toBe('boolean')
    })

    it('degrades to no fields — never a throw — on a ref that resolves nowhere', () => {
      const dangling = { $ref: '#/definitions/Missing', definitions: {} } as unknown as JsonSchemaNode
      expect(deriveFields(dangling)).toEqual([])
    })

    it('does not spin on a cyclic definition', () => {
      const cyclic = {
        $ref: '#/definitions/A',
        definitions: { A: { $ref: '#/definitions/B' }, B: { $ref: '#/definitions/A' } },
      } as unknown as JsonSchemaNode
      expect(deriveFields(cyclic)).toEqual([])
    })

    it('supports $defs as well as definitions', () => {
      const defs = {
        $ref: '#/$defs/Body',
        $defs: { Body: { type: 'object', properties: { q: { type: 'string' } }, required: ['q'] } },
      } as unknown as JsonSchemaNode
      expect(deriveFields(defs).map((f) => f.key)).toEqual(['q'])
    })
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
