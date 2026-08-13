/**
 * The team agent-action audit log (team-audit.ts) — offline, deterministic.
 *
 * Two properties: an action is recorded attributed and readable back, and the
 * parser is tolerant — one corrupt line costs that line, not the whole log.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { appendAudit, parseAuditLog, readAudit, serializeAudit } from './team-audit.js';
import { teamDir } from './team-channels.js';

const entry = (over: Partial<Parameters<typeof appendAudit>[1]> = {}) => ({
  ts: '2026-08-13T00:00:00.000Z',
  actor: 'u-ana',
  channelId: 'general',
  action: 'post',
  ...over,
});

describe('parseAuditLog — tolerant', () => {
  it('is empty for missing/blank input', () => {
    expect(parseAuditLog(undefined)).toEqual([]);
    expect(parseAuditLog('')).toEqual([]);
    expect(parseAuditLog('\n\n')).toEqual([]);
  });

  it('keeps well-formed rows and skips corrupt or incomplete ones', () => {
    const raw = [
      serializeAudit(entry()),
      'not json at all',
      JSON.stringify({ ts: '2026-08-13T00:00:01Z', actor: 'u-bo' }), // missing channelId/action
      serializeAudit(entry({ actor: 'u-bo', action: 'remember', detail: '2 facts' })),
    ].join('\n');
    const parsed = parseAuditLog(raw);
    expect(parsed).toHaveLength(2);
    expect(parsed[1]).toMatchObject({ actor: 'u-bo', action: 'remember', detail: '2 facts' });
  });
});

describe('appendAudit / readAudit', () => {
  let root: string;
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'lm-team-audit-'));
  });
  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('is empty before anything is recorded', async () => {
    expect(await readAudit(root)).toEqual([]);
  });

  it('records and reads back, NEWEST FIRST', async () => {
    await appendAudit(root, entry({ ts: '2026-08-13T00:00:00Z', action: 'post' }));
    await appendAudit(root, entry({ ts: '2026-08-13T00:00:01Z', action: 'remember' }));
    const all = await readAudit(root);
    expect(all.map((e) => e.action)).toEqual(['remember', 'post']);
  });

  it('filters by channel, actor, and action', async () => {
    await appendAudit(root, entry({ actor: 'u-ana', channelId: 'general', action: 'post' }));
    await appendAudit(root, entry({ actor: 'u-bo', channelId: 'design', action: 'pinApp' }));
    await appendAudit(root, entry({ actor: 'u-ana', channelId: 'design', action: 'remember' }));

    expect((await readAudit(root, { channelId: 'design' })).map((e) => e.action)).toEqual(['remember', 'pinApp']);
    expect((await readAudit(root, { actor: 'u-ana' })).map((e) => e.action)).toEqual(['remember', 'post']);
    expect((await readAudit(root, { action: 'pinApp' }))).toHaveLength(1);
  });

  it('caps at limit', async () => {
    for (let i = 0; i < 5; i++) await appendAudit(root, entry({ ts: `2026-08-13T00:00:0${i}Z` }));
    expect(await readAudit(root, { limit: 2 })).toHaveLength(2);
  });

  it('tolerates a corrupt line already on disk', async () => {
    await mkdir(teamDir(root), { recursive: true });
    await writeFile(join(teamDir(root), 'audit.jsonl'), 'garbage\n' + serializeAudit(entry()) + '\n', 'utf8');
    expect(await readAudit(root)).toHaveLength(1);
  });
});
