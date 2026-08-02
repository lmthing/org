/**
 * {@link deriveInvalidates} — write-set ∩ read-set (§7). Proves the direct-entity case, the
 * `include`-relation case (a dashboard reading `job` + `parts` must be invalidated by a PART
 * mutation, not just a job one), self-exclusion, and that non-read kinds are never candidates.
 */
import { describe, it, expect } from 'vitest';
import type { TableSchema } from '@lmthing/core';
import { deriveInvalidates } from './invalidates.js';
import type { QueryIr } from './query.js';

const JOB: TableSchema = {
  title: 'Job',
  description: 'Job',
  columns: { id: { type: 'string', description: 'id', primaryKey: true } },
  relations: { parts: { hasMany: 'part', via: 'jobId', description: 'parts' } },
};
const PART: TableSchema = {
  title: 'Part',
  description: 'Part',
  columns: {
    id: { type: 'string', description: 'id', primaryKey: true },
    jobId: { type: 'string', description: 'owning job' },
  },
};
const TABLES = new Map([['job', JOB], ['part', PART]]);

const jobsList: QueryIr = { name: 'jobs-list', kind: 'list', entity: 'job', route: 'jobs/list' };
const jobDetail: QueryIr = { name: 'job-detail', kind: 'get', entity: 'job', route: 'jobs/[id]' };
const dashboard: QueryIr = { name: 'dashboard', kind: 'aggregate', entity: 'job', route: 'jobs/dashboard', include: ['parts'], compute: { total: { count: '' } } };
const partsForJob: QueryIr = { name: 'parts-for-job', kind: 'list', entity: 'part', route: 'jobs/[id]/parts' };
const jobUpdate: QueryIr = { name: 'job-update', kind: 'update', entity: 'job', route: 'jobs/[id]', set: { status: { input: 'status' } } };
const partCreate: QueryIr = { name: 'part-create', kind: 'create', entity: 'part', route: 'parts/create', set: { jobId: { input: 'jobId' } } };

const ALL = [jobsList, jobDetail, dashboard, partsForJob, jobUpdate, partCreate];

describe('deriveInvalidates', () => {
  it('a job mutation invalidates every read whose entity is job', () => {
    expect(deriveInvalidates(jobUpdate, ALL, TABLES).sort()).toEqual(['dashboard', 'job-detail', 'jobs-list'].sort());
  });

  it('a PART mutation invalidates a job-entity dashboard that `include`s parts — the include-relation case', () => {
    const result = deriveInvalidates(partCreate, ALL, TABLES);
    expect(result).toContain('dashboard'); // job-entity read, but reads parts via include
    expect(result).toContain('parts-for-job'); // direct part-entity read
    expect(result).not.toContain('jobs-list'); // jobs-list reads job only, no parts include
  });

  it('never includes the mutation itself, and never a write-kind query', () => {
    const result = deriveInvalidates(jobUpdate, ALL, TABLES);
    expect(result).not.toContain('job-update');
    expect(result).not.toContain('part-create');
  });
});
