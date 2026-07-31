/**
 * {@link deriveFormOptions} — the derived `x-options` that turns a foreign key in a
 * generated create form from a raw UUID text box into a picker.
 *
 * The end-to-end case is scenario 30 (`30-bike-workshop`) reduced to its bones: a
 * `jobs-create` POST whose Input carries `customer_id` and `bike_id`, alongside the
 * `customers/select` and `bikes/select` endpoints the same app already built and never
 * connected to anything.
 */
import { describe, it, expect, afterAll } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { deriveFormOptions, foreignKeyColumns, optionSourcesFor } from './fk-options.js';
import { generateAppTypes, type EndpointContract } from './schema.js';
import { readXOptions } from '../view-spec/schema.js';
import type { LoadedTable } from '@lmthing/core';

const tmpDirs: string[] = [];
async function scratch(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'lm-fkopts-'));
  tmpDirs.push(dir);
  return dir;
}
afterAll(async () => {
  await Promise.all(tmpDirs.map((d) => rm(d, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })));
});

// ── fixtures: scenario 30's tables, verbatim in shape ────────────────────────

const CUSTOMERS: LoadedTable = {
  name: 'customers',
  schema: {
    title: 'Customers',
    description: 'Customer name and phone.',
    columns: {
      id: { type: 'string', description: 'Primary key', primaryKey: true, generated: 'uuid' },
      name: { type: 'string', description: 'Customer full name', required: true },
      phone: { type: 'string', description: 'Phone number', required: true },
    },
  },
};

const BIKES: LoadedTable = {
  name: 'bikes',
  schema: {
    title: 'Bikes',
    description: 'Every bike known to the shop.',
    columns: {
      id: { type: 'string', description: 'Primary key', primaryKey: true, generated: 'uuid' },
      make: { type: 'string', description: 'Manufacturer', required: true },
      model: { type: 'string', description: 'Model name', required: true },
      // Scenario 30 declared its foreign keys in PROSE only — no `references`, no
      // relations. The convention rule is what has to carry this.
      owner_id: { type: 'string', description: 'FK to customers.id — who owns this bike', required: true },
    },
  },
};

const JOBS: LoadedTable = {
  name: 'jobs',
  schema: {
    title: 'Jobs',
    description: 'Each repair job booked in.',
    columns: {
      id: { type: 'string', description: 'Primary key', primaryKey: true, generated: 'uuid' },
      bike_id: { type: 'string', description: 'FK to bikes.id', required: true },
      work_description: { type: 'string', description: 'The work needed', required: true },
      is_collected: { type: 'boolean', description: 'Collected yet', required: true },
    },
  },
};

const TABLES = [CUSTOMERS, BIKES, JOBS];

function endpoint(over: Partial<EndpointContract> & Pick<EndpointContract, 'name' | 'method' | 'routePath'>): EndpointContract {
  return {
    description: '',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    outputSchema: { type: 'object', properties: {}, additionalProperties: false },
    inputTsType: '{}',
    outputTsType: '{}',
    ...over,
  };
}

/** `{ items: T[] }` — the envelope every read endpoint in this pipeline returns. */
function itemsOutput(props: Record<string, { type: string }>): Record<string, unknown> {
  return {
    type: 'object',
    properties: {
      items: { type: 'array', items: { type: 'object', properties: props, required: Object.keys(props) } },
    },
    required: ['items'],
  };
}

function bikeShopEndpoints(): EndpointContract[] {
  return [
    endpoint({
      name: 'jobs-create',
      method: 'POST',
      routePath: '/jobs',
      inputSchema: {
        type: 'object',
        additionalProperties: false,
        required: ['customer_id', 'bike_id', 'work_description'],
        properties: {
          customer_id: { type: 'string' },
          bike_id: { type: 'string' },
          work_description: { type: 'string' },
        },
      },
    }),
    endpoint({
      name: 'bikes-list',
      method: 'GET',
      routePath: '/bikes',
      outputSchema: itemsOutput({
        id: { type: 'string' },
        make: { type: 'string' },
        model: { type: 'string' },
        colour: { type: 'string' },
        owner_name: { type: 'string' },
      }),
    }),
    endpoint({
      name: 'bikes-for-select',
      method: 'GET',
      routePath: '/bikes/select',
      outputSchema: itemsOutput({ id: { type: 'string' }, label: { type: 'string' } }),
    }),
    endpoint({
      name: 'customers-list',
      method: 'GET',
      routePath: '/customers',
      outputSchema: itemsOutput({ id: { type: 'string' }, name: { type: 'string' }, phone: { type: 'string' } }),
    }),
    endpoint({
      name: 'customers-for-select',
      method: 'GET',
      routePath: '/customers/select',
      outputSchema: itemsOutput({ id: { type: 'string' }, name: { type: 'string' } }),
    }),
  ];
}

const propertyOf = (ep: EndpointContract, key: string) =>
  ((ep.inputSchema as { properties: Record<string, unknown> }).properties[key]);

// ── the tests ────────────────────────────────────────────────────────────────

describe('which columns are foreign keys', () => {
  it('reads the `<table>_id` convention — the only form real apps ship', () => {
    const fks = foreignKeyColumns(TABLES);
    expect(fks.get('bike_id')).toBe('bikes');
    expect(fks.get('owner_id')).toBeUndefined(); // no `owners` table, and no declaration
    expect(fks.get('work_description')).toBeUndefined();
    expect(fks.get('id')).toBeUndefined(); // a primary key is not a foreign key
  });

  it('a declared `references` beats the name, and a `belongsTo` relation is read too', () => {
    const declared: LoadedTable = {
      name: 'bikes',
      schema: {
        ...BIKES.schema,
        columns: {
          ...BIKES.schema.columns,
          owner_id: { ...BIKES.schema.columns.owner_id, references: { table: 'customers' } },
        },
      },
    };
    expect(foreignKeyColumns([CUSTOMERS, declared]).get('owner_id')).toBe('customers');

    const related: LoadedTable = {
      name: 'bikes',
      schema: {
        ...BIKES.schema,
        relations: { owner: { belongsTo: 'customers', via: 'owner_id', description: 'the owner' } },
      },
    };
    expect(foreignKeyColumns([CUSTOMERS, related]).get('owner_id')).toBe('customers');
  });

  it('a column name two tables disagree about is DROPPED rather than guessed', () => {
    const owners: LoadedTable = {
      name: 'owners',
      schema: { title: 'Owners', description: 'people', columns: { id: { type: 'string', description: 'pk', primaryKey: true } } },
    };
    const conflicting: LoadedTable = {
      name: 'leases',
      schema: {
        title: 'Leases',
        description: 'leases',
        columns: {
          id: { type: 'string', description: 'pk', primaryKey: true },
          owner_id: { type: 'string', description: 'the customer', references: { table: 'customers' } },
        },
      },
    };
    // `bikes.owner_id` resolves to `owners` by convention, `leases.owner_id` to `customers`
    // by declaration. Two answers for one key ⇒ no answer.
    expect(foreignKeyColumns([CUSTOMERS, owners, BIKES, conflicting]).get('owner_id')).toBeUndefined();
  });
});

describe('which endpoint supplies the options', () => {
  it('ranks a purpose-built picker above the full list, deterministically', () => {
    const sources = optionSourcesFor('bikes', bikeShopEndpoints());
    expect(sources.map((s) => s.ep.name)).toEqual(['bikes-for-select', 'bikes-list']);
    expect(sources[0].labelProperty).toBe('label');
  });

  it('skips an endpoint that cannot be called with no arguments', () => {
    const eps = bikeShopEndpoints().map((e) =>
      e.name === 'bikes-for-select' ? endpoint({ ...e, routePath: '/customers/:id/bikes' }) : e,
    );
    expect(optionSourcesFor('bikes', eps).map((s) => s.ep.name)).toEqual(['bikes-list']);
  });

  it('skips an endpoint whose rows carry no `id` to submit', () => {
    const eps = [
      endpoint({
        name: 'bike-makes',
        method: 'GET',
        routePath: '/bikes/makes',
        outputSchema: itemsOutput({ make: { type: 'string' } }),
      }),
    ];
    expect(optionSourcesFor('bikes', eps)).toEqual([]);
  });
});

describe('deriveFormOptions — the defect: a create form asking for a UUID', () => {
  it('annotates every foreign-key property of a write endpoint', () => {
    const endpoints = bikeShopEndpoints();
    const result = deriveFormOptions(TABLES, endpoints);
    const create = endpoints.find((e) => e.name === 'jobs-create') as EndpointContract;

    expect(readXOptions(propertyOf(create, 'bike_id'))).toEqual({
      query: 'bikes-for-select',
      label: '$.label',
      value: '$.id',
    });
    // `customer_id` is not even a column of `jobs` — it narrows the bike picker. A
    // per-table lookup would have missed exactly the field the shop owner had to type.
    expect(readXOptions(propertyOf(create, 'customer_id'))).toEqual({
      query: 'customers-for-select',
      label: '$.name',
      value: '$.id',
    });
    expect(readXOptions(propertyOf(create, 'work_description'))).toBeUndefined();
    expect(result.applied.map((a) => a.property).sort()).toEqual(['bike_id', 'customer_id']);
  });

  it('never overwrites a hand-written annotation', () => {
    const endpoints = bikeShopEndpoints();
    const create = endpoints.find((e) => e.name === 'jobs-create') as EndpointContract;
    (propertyOf(create, 'bike_id') as Record<string, unknown>)['x-options'] = {
      query: 'bikes-list',
      label: '$.model',
      value: '$.id',
    };
    deriveFormOptions(TABLES, endpoints);
    expect(readXOptions(propertyOf(create, 'bike_id'))?.query).toBe('bikes-list');
  });

  it('leaves an unresolvable foreign key alone and REPORTS the candidate set', () => {
    const endpoints = bikeShopEndpoints().filter((e) => !e.name.startsWith('bikes'));
    const result = deriveFormOptions(TABLES, endpoints);
    const create = endpoints.find((e) => e.name === 'jobs-create') as EndpointContract;
    expect(readXOptions(propertyOf(create, 'bike_id'))).toBeUndefined();
    expect(result.unresolved).toEqual([
      { endpoint: 'jobs-create', property: 'bike_id', table: 'bikes', candidates: [] },
    ]);
  });

  it('a GET is a facet map, not a form — its inputs are left alone', () => {
    const endpoints = [
      endpoint({
        name: 'jobs-list',
        method: 'GET',
        routePath: '/jobs',
        inputSchema: { type: 'object', properties: { bike_id: { type: 'string' } } },
      }),
      ...bikeShopEndpoints().filter((e) => e.method === 'GET'),
    ];
    deriveFormOptions(TABLES, endpoints);
    expect(readXOptions(propertyOf(endpoints[0], 'bike_id'))).toBeUndefined();
  });

  it('a route `[param]` is the page`s to supply and never becomes a picker', () => {
    const endpoints = [
      endpoint({
        name: 'bike-update',
        method: 'PATCH',
        routePath: '/bikes/:bike_id',
        inputSchema: { type: 'object', properties: { bike_id: { type: 'string' }, model: { type: 'string' } } },
      }),
      ...bikeShopEndpoints().filter((e) => e.method === 'GET'),
    ];
    deriveFormOptions(TABLES, endpoints);
    expect(readXOptions(propertyOf(endpoints[0], 'bike_id'))).toBeUndefined();
  });
});

describe('generateAppTypes carries the annotation into the real contract', () => {
  it('a handler declaring a bare `bike_id: string` still gets a picker', async () => {
    const root = await scratch();
    await mkdir(join(root, 'database'), { recursive: true });
    await writeFile(join(root, 'database', 'bikes.json'), JSON.stringify(BIKES.schema), 'utf8');
    await writeFile(join(root, 'database', 'customers.json'), JSON.stringify(CUSTOMERS.schema), 'utf8');
    await writeFile(join(root, 'database', 'jobs.json'), JSON.stringify(JOBS.schema), 'utf8');

    await mkdir(join(root, 'api', 'jobs'), { recursive: true });
    await writeFile(
      join(root, 'api', 'jobs', 'POST.ts'),
      [
        "export const name = 'jobs-create';",
        'export interface Input { bike_id: string; work_description: string }',
        'export interface Output { items: { id: string }[] }',
        'export default async function handler(input: Input): Promise<Output> { return { items: [{ id: input.bike_id }] }; }',
      ].join('\n'),
      'utf8',
    );
    await mkdir(join(root, 'api', 'bikes', 'select'), { recursive: true });
    await writeFile(
      join(root, 'api', 'bikes', 'select', 'GET.ts'),
      [
        "export const name = 'bikes-for-select';",
        'export interface Output { items: { id: string; label: string }[] }',
        'export default async function handler(): Promise<Output> { return { items: [] }; }',
      ].join('\n'),
      'utf8',
    );

    const { endpoints } = await generateAppTypes(root);
    const create = endpoints.find((e) => e.name === 'jobs-create') as EndpointContract;
    expect(readXOptions(propertyOf(create, 'bike_id'))).toEqual({
      query: 'bikes-for-select',
      label: '$.label',
      value: '$.id',
    });
  }, 60_000);
});
