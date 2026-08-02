/**
 * {@link validateEntityIr} / {@link compileEntity} — the entity-model IR (W7 / §2.1): facts, not
 * columns. Proves the shape validation, the `money`/`enum`/`ref` companion rules, the "one vocabulary
 * per fact forever" + "a fact key names one column" cross-build registry rules, and that `compile()`
 * projects to a `TableSchema` real enough for `schemaToCreateTableSql` to actually build a table.
 */
import { describe, it, expect } from 'vitest';

import { validateEntityIr, compileEntity, type EntityIr, type FactRecord } from './entity.js';
import { schemaToCreateTableSql } from '../store.js';

const JOB_IR: EntityIr = {
  entity: 'job',
  title: 'Job',
  identity: 'id',
  fields: {
    id: { fact: 'job.id', type: 'id' },
    client: { fact: 'job.client', type: 'ref', to: 'client', required: true },
    status: {
      fact: 'job.status',
      type: 'enum',
      values: ['quoted', 'approved', 'in-progress', 'waiting-on-parts'],
      source: 'asked:2026-08-02#what-states',
    },
    hours: { fact: 'job.hours', type: 'decimal', unit: 'hour' },
    priceMinor: { fact: 'job.price', type: 'money', currencyField: 'currency' },
    currency: { fact: 'job.currency', type: 'enum', values: ['GBP', 'USD'] },
  },
  relations: { parts: { hasMany: 'part', via: 'jobId', description: 'parts fitted' } },
};

describe('validateEntityIr', () => {
  it('accepts the §2.1 worked example', () => {
    const res = validateEntityIr(JOB_IR);
    expect(res.errors).toEqual([]);
    expect(res.ok).toBe(true);
  });

  it('rejects a duplicate fact key within one entity', () => {
    const ir = { ...JOB_IR, fields: { ...JOB_IR.fields, altStatus: { fact: 'job.status', type: 'enum', values: ['x'] } } };
    const res = validateEntityIr(ir);
    expect(res.errors.join(' ')).toMatch(/fact "job.status" is already used by field "status"/);
  });

  it('rejects an enum field with no values', () => {
    const res = validateEntityIr({ ...JOB_IR, fields: { ...JOB_IR.fields, status: { fact: 'job.status', type: 'enum' } } });
    expect(res.errors.join(' ')).toMatch(/"values" must be a non-empty array/);
  });

  it('rejects a ref field with no target', () => {
    const res = validateEntityIr({ ...JOB_IR, fields: { ...JOB_IR.fields, client: { fact: 'job.client', type: 'ref' } } });
    expect(res.errors.join(' ')).toMatch(/"to".*required/);
  });

  it('rejects money with no currencyField, and money whose currencyField is not string/enum', () => {
    const noCompanion = validateEntityIr({
      ...JOB_IR,
      fields: { ...JOB_IR.fields, priceMinor: { fact: 'job.price', type: 'money' } },
    });
    expect(noCompanion.errors.join(' ')).toMatch(/"currencyField" is required/);

    const wrongType = validateEntityIr({
      ...JOB_IR,
      fields: { ...JOB_IR.fields, currency: { fact: 'job.currency', type: 'number' } },
    });
    expect(wrongType.errors.join(' ')).toMatch(/must be type "string" or "enum"/);
  });

  it('rejects more than one identity field', () => {
    const res = validateEntityIr({
      ...JOB_IR,
      fields: { ...JOB_IR.fields, id2: { fact: 'job.id2', type: 'id' } },
    });
    expect(res.errors.join(' ')).toMatch(/only one field may be type "id"/);
  });

  it('rejects a belongsTo relation whose via is not a real field', () => {
    const res = validateEntityIr({
      ...JOB_IR,
      relations: { client: { belongsTo: 'client', via: 'clientId', description: 'the client' } },
    });
    expect(res.errors.join(' ')).toMatch(/"via" names "clientId", which is not a field/);
  });

  describe('fact registry — one vocabulary per fact, forever', () => {
    it('rejects an enum rebuild that DROPS a previously-declared value', () => {
      const existingFacts = new Map<string, FactRecord>([
        ['job.status', { entity: 'job', field: 'status', type: 'enum', values: ['quoted', 'approved', 'in-progress', 'waiting-on-parts', 'archived'] }],
      ]);
      const res = validateEntityIr(JOB_IR, { existingFacts });
      expect(res.errors.join(' ')).toMatch(/DROPPED value.*"archived"/);
    });

    it('accepts an enum rebuild that only EXTENDS the value set', () => {
      const existingFacts = new Map<string, FactRecord>([
        ['job.status', { entity: 'job', field: 'status', type: 'enum', values: ['quoted', 'approved'] }],
      ]);
      const res = validateEntityIr(JOB_IR, { existingFacts });
      expect(res.ok).toBe(true);
    });

    it('rejects a fact key reused on a different entity/field ("job_name beside job_title")', () => {
      const existingFacts = new Map<string, FactRecord>([
        ['job.status', { entity: 'invoice', field: 'state', type: 'enum', values: ['quoted'] }],
      ]);
      const res = validateEntityIr(JOB_IR, { existingFacts });
      expect(res.errors.join(' ')).toMatch(/fact "job.status" was previously declared on invoice.state/);
    });
  });
});

describe('compileEntity', () => {
  it('projects to a TableSchema that schemaToCreateTableSql can actually build', () => {
    const { tableName, schema, facts } = compileEntity(JOB_IR);
    expect(tableName).toBe('job');
    expect(schema.columns.id).toEqual(expect.objectContaining({ type: 'string', primaryKey: true, generated: 'uuid' }));
    expect(schema.columns.client).toEqual(expect.objectContaining({ type: 'string', required: true, references: { table: 'client' } }));
    expect(schema.columns.status.enum).toEqual(['quoted', 'approved', 'in-progress', 'waiting-on-parts']);
    expect(schema.columns.hours.type).toBe('number'); // decimal → number storage
    expect(schema.columns.priceMinor.type).toBe('number'); // money → integer minor units
    expect(schema.relations?.parts).toEqual({ hasMany: 'part', via: 'jobId', description: 'parts fitted' });
    expect(facts.get('job.status')).toEqual({ entity: 'job', field: 'status', type: 'enum', values: schema.columns.status.enum });

    // The real proof: a live SQLite CREATE TABLE from the compiled schema does not throw.
    expect(() => schemaToCreateTableSql(tableName, schema)).not.toThrow();
    const sql = schemaToCreateTableSql(tableName, schema);
    expect(sql).toContain('"id" TEXT PRIMARY KEY');
    expect(sql).toContain('FOREIGN KEY ("client") REFERENCES "client"');
  });
});
