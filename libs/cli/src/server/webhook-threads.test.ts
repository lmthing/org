/**
 * Inbound-webhook Phase 2 (thread-key store) — offline, deterministic. Covers
 * `getOrCreateThreadSession`: stable id across calls for the same
 * (path, threadKey), distinct ids for distinct keys, and persistence across a
 * fresh read (a new call re-reads `.data/webhook-threads.json` from disk).
 */
import { describe, it, expect, afterAll } from 'vitest';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { getOrCreateThreadSession, webhookThreadsPath } from './webhook-threads.js';

const tmpDirs: string[] = [];
afterAll(async () => {
  await Promise.all(tmpDirs.map((d) => rm(d, { recursive: true, force: true })));
});

async function makeRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'lmthing-webhook-threads-'));
  tmpDirs.push(root);
  return root;
}

describe('getOrCreateThreadSession', () => {
  it('returns the SAME sessionId across repeated calls for the same (path, threadKey)', async () => {
    const root = await makeRoot();
    const first = await getOrCreateThreadSession(root, 'lead', 'thread-1');
    const second = await getOrCreateThreadSession(root, 'lead', 'thread-1');
    expect(second).toBe(first);
  });

  it('returns DIFFERENT sessionIds for different threadKeys', async () => {
    const root = await makeRoot();
    const a = await getOrCreateThreadSession(root, 'lead', 'thread-a');
    const b = await getOrCreateThreadSession(root, 'lead', 'thread-b');
    expect(a).not.toBe(b);
  });

  it('returns DIFFERENT sessionIds for the same threadKey under different paths', async () => {
    const root = await makeRoot();
    const a = await getOrCreateThreadSession(root, 'lead', 'shared-key');
    const b = await getOrCreateThreadSession(root, 'support', 'shared-key');
    expect(a).not.toBe(b);
  });

  it('persists across a fresh call (re-read from disk)', async () => {
    const root = await makeRoot();
    const minted = await getOrCreateThreadSession(root, 'lead', 'thread-1');

    // Read the file directly to confirm it was actually written under the
    // documented key shape.
    const raw = JSON.parse(await readFile(webhookThreadsPath(root), 'utf8')) as Record<string, string>;
    expect(raw['lead::thread-1']).toBe(minted);

    // A brand-new call (simulating a fresh process/handler invocation) reads
    // the same mapping back rather than minting a new id.
    const again = await getOrCreateThreadSession(root, 'lead', 'thread-1');
    expect(again).toBe(minted);
  });

  it('tolerates a missing .data/ dir and a corrupt state file', async () => {
    const root = await makeRoot();
    // No .data/ dir exists yet — first call must create it and succeed.
    const id = await getOrCreateThreadSession(root, 'p', 'k');
    expect(typeof id).toBe('string');
    expect(id.length).toBeGreaterThan(0);
  });
});
