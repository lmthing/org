/**
 * SessionManager.evictOneIdle + resident/running/last-activity counters (P1/P3).
 *
 * evictOneIdle is the shared shed primitive for both the capacity gate and the
 * memory watchdog: it must evict the least-recently-active NON-running session and
 * never touch a running turn. Tested by injecting lightweight fake entries into the
 * private map (no real VMs needed) — persistSession is a no-op without lmthingRoot,
 * and a fake entry has no `session`, so the background dispose is a safe no-op.
 */
import { describe, it, expect } from 'vitest';
import { createMockStreamFn } from '@lmthing/core';
import { SessionManager } from './session-manager.js';

const mgr = (): SessionManager =>
  new SessionManager({ streamFn: createMockStreamFn(() => ''), maxSessions: 3 });

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function fakeEntry(id: string, lastActivity: number, status = 'idle'): any {
  return {
    sessionId: id,
    session: undefined,
    renderHost: {},
    hub: {},
    spaceDir: '',
    agentSlug: 'thing',
    lastActivity,
    started: true,
    status,
    createdAt: 0,
    messageCount: 0,
    totalCostUsd: 0,
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mapOf = (m: SessionManager): Map<string, any> => (m as any).sessions;

describe('SessionManager.evictOneIdle + counters', () => {
  it('evicts the least-recently-active non-running session', () => {
    const m = mgr();
    const map = mapOf(m);
    map.set('a', fakeEntry('a', 100));
    map.set('b', fakeEntry('b', 50)); // LRU
    map.set('c', fakeEntry('c', 200));
    expect(m.residentCount()).toBe(3);
    expect(m.lastActivityAt()).toBe(200);

    expect(m.evictOneIdle()).toBe(true);
    expect(map.has('b')).toBe(false); // the LRU one is gone
    expect(m.residentCount()).toBe(2);
  });

  it('never evicts a running session; returns false when all are running', () => {
    const m = mgr();
    const map = mapOf(m);
    map.set('a', fakeEntry('a', 100, 'running'));
    map.set('b', fakeEntry('b', 50, 'running'));
    expect(m.runningCount()).toBe(2);
    expect(m.evictOneIdle()).toBe(false);
    expect(m.residentCount()).toBe(2);
  });

  it('prefers an idle session over an older running one', () => {
    const m = mgr();
    const map = mapOf(m);
    map.set('run', fakeEntry('run', 10, 'running')); // oldest, but running
    map.set('idle', fakeEntry('idle', 300, 'idle')); // newer, but idle
    expect(m.evictOneIdle()).toBe(true);
    expect(map.has('idle')).toBe(false);
    expect(map.has('run')).toBe(true);
  });

  it('counters are zero on an empty manager', () => {
    const m = mgr();
    expect(m.residentCount()).toBe(0);
    expect(m.runningCount()).toBe(0);
    expect(m.lastActivityAt()).toBe(0);
  });
});

/**
 * ITEM 1: the idle reaper must NEVER reap a session whose turn is in flight
 * (`status === 'running'`), mirroring evictOneIdle's guard. `lastActivity` is only
 * touched at turn start/end, so a long build/turn that outlasts the idle TTL would
 * otherwise be reaped mid-work ("session vanished mid-turn"). reapIdleOnce is the
 * extracted, deterministically-testable sweep (an explicit `now` avoids wall-clock flake).
 */
describe('SessionManager.reapIdleOnce — never reaps a running turn', () => {
  const reaperMgr = (): SessionManager =>
    new SessionManager({ streamFn: createMockStreamFn(() => ''), maxSessions: 80, idleTtlMs: 1000 });

  const flush = () => new Promise((r) => setTimeout(r, 20));

  it('reaps a genuinely idle session past the TTL but SPARES a running one', async () => {
    const m = reaperMgr();
    const map = mapOf(m);
    const stale = Date.now() - 10 * 60_000; // 10 min ago — well past the 1s TTL
    map.set('running', fakeEntry('running', stale, 'running')); // in-flight turn: must survive
    map.set('idle', fakeEntry('idle', stale, 'idle')); // truly idle: must be reaped

    m.reapIdleOnce(Date.now());

    // Running session is never even selected — deterministic, independent of async dispose.
    expect(map.has('running')).toBe(true);
    // The idle one is disposed (persist-first dispose is async without a live session).
    await flush();
    expect(map.has('idle')).toBe(false);
  });

  it('does not reap a running session even long past the TTL (revert-proof of the guard)', async () => {
    const m = reaperMgr();
    const map = mapOf(m);
    map.set('build', fakeEntry('build', Date.now() - 60 * 60_000, 'running')); // 1h-long build turn

    m.reapIdleOnce(Date.now());
    await flush();
    expect(map.has('build')).toBe(true); // WITHOUT the status==='running' guard this would be gone
    expect(m.runningCount()).toBe(1);
  });

  it('reaps a non-running session that is idle past the TTL', async () => {
    const m = reaperMgr();
    const map = mapOf(m);
    map.set('old', fakeEntry('old', Date.now() - 5 * 60_000, 'idle'));
    map.set('fresh', fakeEntry('fresh', Date.now(), 'idle')); // within TTL — survives

    m.reapIdleOnce(Date.now());
    await flush();
    expect(map.has('old')).toBe(false);
    expect(map.has('fresh')).toBe(true);
  });
});
