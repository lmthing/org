/**
 * Durable per-channel memory (team-memory.ts) — offline, deterministic.
 *
 * Two properties matter: the store round-trips a fact across separate reads (the
 * point of "durable"), and it is BOUNDED — a model that writes junk or a thousand
 * facts cannot make the note unbounded or throw. The bounding logic is pure, so
 * it is tested directly, without a pod.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  MAX_FACTS,
  MAX_FACT_LEN,
  parseChannelMemory,
  readChannelMemory,
  sanitizeFacts,
  writeChannelMemory,
} from './team-memory.js';
import { teamDir } from './team-channels.js';

describe('sanitizeFacts — the bound', () => {
  it('keeps non-empty trimmed strings, in order', () => {
    expect(sanitizeFacts(['  a ', 'b', '  '])).toEqual(['a', 'b']);
  });

  it('drops non-strings and non-arrays', () => {
    expect(sanitizeFacts([1, 'a', null, { x: 1 }, 'b'])).toEqual(['a', 'b']);
    expect(sanitizeFacts(undefined)).toEqual([]);
    expect(sanitizeFacts('a fact' as unknown)).toEqual([]);
  });

  it('de-duplicates, keeping the first occurrence', () => {
    expect(sanitizeFacts(['a', 'b', 'a', 'c', 'b'])).toEqual(['a', 'b', 'c']);
  });

  it('truncates a single over-long fact', () => {
    const long = 'x'.repeat(MAX_FACT_LEN + 100);
    expect(sanitizeFacts([long])[0]!.length).toBe(MAX_FACT_LEN);
  });

  it('caps the count, keeping the NEWEST (tail)', () => {
    const many = Array.from({ length: MAX_FACTS + 10 }, (_, i) => `fact-${i}`);
    const out = sanitizeFacts(many);
    expect(out).toHaveLength(MAX_FACTS);
    expect(out[out.length - 1]).toBe(`fact-${MAX_FACTS + 9}`);
    expect(out[0]).toBe('fact-10');
  });
});

describe('parseChannelMemory — tolerant', () => {
  it('is empty for missing / bad / junk input', () => {
    expect(parseChannelMemory(undefined)).toEqual({ facts: [] });
    expect(parseChannelMemory('not json')).toEqual({ facts: [] });
    expect(parseChannelMemory('42')).toEqual({ facts: [] });
    expect(parseChannelMemory('{"facts": "nope"}')).toEqual({ facts: [] });
  });

  it('reads facts and updatedAt, sanitizing the facts', () => {
    const mem = parseChannelMemory('{"facts": ["a", 2, "a"], "updatedAt": "2026-01-01T00:00:00Z"}');
    expect(mem).toEqual({ facts: ['a'], updatedAt: '2026-01-01T00:00:00Z' });
  });
});

describe('readChannelMemory / writeChannelMemory — round-trip', () => {
  let root: string;
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'lm-team-mem-'));
  });
  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('is empty before anything is written', async () => {
    expect(await readChannelMemory(root, 'general')).toEqual({ facts: [] });
  });

  it('persists a fact so a LATER read still sees it', async () => {
    await writeChannelMemory(root, 'general', ['ships on Fridays'], '2026-08-11T00:00:00Z');
    const mem = await readChannelMemory(root, 'general');
    expect(mem.facts).toEqual(['ships on Fridays']);
    expect(mem.updatedAt).toBe('2026-08-11T00:00:00Z');
  });

  it('is per-channel — one channel does not see another\'s memory', async () => {
    await writeChannelMemory(root, 'eng', ['eng fact'], '2026-08-11T00:00:00Z');
    expect((await readChannelMemory(root, 'design')).facts).toEqual([]);
    expect((await readChannelMemory(root, 'eng')).facts).toEqual(['eng fact']);
  });

  it('stores under .team/memory/<channelId>.json', async () => {
    await writeChannelMemory(root, 'general', ['x'], '2026-08-11T00:00:00Z');
    const raw = await readFile(join(teamDir(root), 'memory', 'general.json'), 'utf8');
    expect(JSON.parse(raw).facts).toEqual(['x']);
  });

  it('refuses a channel id that could escape the directory', async () => {
    await expect(writeChannelMemory(root, '../evil', ['x'], 'now')).rejects.toThrow();
    await expect(readChannelMemory(root, 'a/b')).rejects.toThrow();
  });
});
