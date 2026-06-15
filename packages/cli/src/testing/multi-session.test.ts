/**
 * Multi-session manager — keyless, in-process. Uses the scripted mock provider
 * (createMockStreamFn) so no API keys are needed. Proves:
 *   (a) two sessions can be created and listed;
 *   (b) a display in session A is observable via session A's hub/state but NOT
 *       session B's (per-session renderHost + TraceHub isolation);
 *   (c) the maxSessions cap throws a clear error.
 */
import { describe, it, expect, afterAll } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { Session, createMockStreamFn, buildTraceTree } from '@lmthing/core';
import type { StreamOpts, TraceEvent } from '@lmthing/core';
import { SessionManager } from '../server/session-manager.js';
import type { BuildSessionArgs } from '../server/session-manager.js';

const tmpDirs: string[] = [];

afterAll(async () => {
  await Promise.all(tmpDirs.map((d) => rm(d, { recursive: true, force: true })));
});

/** Minimal one-agent space on disk (no functions, no system spaces needed). */
async function makeSpace(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'lmthing-multisess-'));
  tmpDirs.push(dir);
  const file = join(dir, 'agents', 'main', 'instruct.md');
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, 'You are a test agent.\n', 'utf8');
  return dir;
}

/** Wait until predicate() is true (polling) or timeout. */
async function until(predicate: () => boolean, timeoutMs = 5000): Promise<void> {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) throw new Error('timed out waiting for condition');
    await new Promise((r) => setTimeout(r, 25));
  }
}

/** Collect display descriptors from a hub's buffered trace events. */
function displaysFromHub(events: Array<{ event: TraceEvent }>): unknown[] {
  return events
    .map((e) => e.event)
    .filter((ev): ev is Extract<TraceEvent, { type: 'display' }> => ev.type === 'display')
    .map((ev) => ev.descriptor);
}

describe('SessionManager (keyless, mock provider)', () => {
  /** Mock that emits a single display(<text>) keyed off the task message, then
   *  stops. callIndex is GLOBAL across all sessions, so we gate "one turn then
   *  done" on whether this turn already has an assistant message (i.e. the
   *  display statement already ran for THIS session's run). */
  const mockStreamFn = createMockStreamFn((opts: StreamOpts) => {
    const hasAssistant = opts.messages.some((m) => m.role === 'assistant');
    if (hasAssistant) return ''; // already emitted the display this run → done
    const lastUser = [...opts.messages].reverse().find((m) => m.role === 'user');
    const content = typeof lastUser?.content === 'string' ? lastUser.content : '';
    const tag = content.includes('MESSAGE_A') ? 'FROM_A'
      : content.includes('MESSAGE_B') ? 'FROM_B'
      : 'FROM_X';
    return `display(${JSON.stringify(tag)});`;
  });

  /** A SessionManager whose buildSession disables system spaces (fast, keyless). */
  function makeManager(maxSessions?: number): SessionManager {
    return new SessionManager({
      streamFn: mockStreamFn,
      ...(maxSessions !== undefined ? { maxSessions } : {}),
      snapshotsDir: join(tmpdir(), 'lmthing-multisess-snaps'),
      buildSession: (args: BuildSessionArgs) =>
        new Session(
          {
            spaceDir: args.spaceDir,
            agentSlug: args.agentSlug,
            modelAlias: 'mock',
            renderHost: args.renderHost,
            systemSpaceDirs: [],
          },
          { streamFn: mockStreamFn },
        ),
    });
  }

  it('(a) creates and lists two sessions', async () => {
    const manager = makeManager(8);
    const spaceDir = await makeSpace();
    const { sessionId: a } = manager.createSession({ spaceDir, agentSlug: 'default' });
    const { sessionId: b } = manager.createSession({ spaceDir, agentSlug: 'default' });
    expect(a).not.toBe(b);

    const list = manager.listSessions();
    expect(list.length).toBe(2);
    const ids = list.map((s) => s.sessionId).sort();
    expect(ids).toEqual([a, b].sort());
    // listSessions returns metadata, never the Session object.
    expect((list[0] as unknown as Record<string, unknown>)['session']).toBeUndefined();
    expect(list[0]!.spaceDir).toBe(spaceDir);

    await manager.disposeSession(a);
    await manager.disposeSession(b);
  });

  it('(b) a display in session A is observable in A but NOT B', async () => {
    const manager = makeManager(8);
    const spaceDir = await makeSpace();
    const { sessionId: a } = manager.createSession({ spaceDir, agentSlug: 'default' });
    const { sessionId: b } = manager.createSession({ spaceDir, agentSlug: 'default' });

    const entryA = manager.getSession(a)!;
    const entryB = manager.getSession(b)!;

    manager.sendMessage(a, 'MESSAGE_A please');

    // Wait until A's run finished (status back to idle) and a display landed.
    await until(() => displaysFromHub(entryA.hub.snapshot().events).length > 0);

    const aDisplays = displaysFromHub(entryA.hub.snapshot().events);
    const bDisplays = displaysFromHub(entryB.hub.snapshot().events);
    expect(aDisplays).toContain('FROM_A');
    expect(bDisplays.length).toBe(0); // session B saw nothing

    // The execution tree built from A's hub has a session/run; B's is empty.
    const treeA = buildTraceTree(entryA.hub.snapshot().events.map((e) => e.event));
    const treeB = buildTraceTree(entryB.hub.snapshot().events.map((e) => e.event));
    expect(Object.keys(treeA.nodes).length).toBeGreaterThan(0);
    expect(Object.keys(treeB.nodes).length).toBe(0);

    // Now drive B; its display must NOT leak back into A.
    manager.sendMessage(b, 'MESSAGE_B please');
    await until(() => displaysFromHub(entryB.hub.snapshot().events).length > 0);
    expect(displaysFromHub(entryB.hub.snapshot().events)).toContain('FROM_B');
    // A still only has its own display.
    const aAfter = displaysFromHub(entryA.hub.snapshot().events);
    expect(aAfter).toContain('FROM_A');
    expect(aAfter).not.toContain('FROM_B');

    await manager.disposeSession(a);
    await manager.disposeSession(b);
  });

  it('(c) maxSessions cap throws a clear error', async () => {
    const manager = makeManager(2);
    const spaceDir = await makeSpace();
    const { sessionId: a } = manager.createSession({ spaceDir, agentSlug: 'default' });
    const { sessionId: b } = manager.createSession({ spaceDir, agentSlug: 'default' });
    expect(() => manager.createSession({ spaceDir, agentSlug: 'default' })).toThrow(/max sessions reached \(2\)/);

    // After disposing one, a new session can be created again.
    await manager.disposeSession(a);
    const { sessionId: c } = manager.createSession({ spaceDir, agentSlug: 'default' });
    expect(c).toBeTruthy();

    await manager.disposeSession(b);
    await manager.disposeSession(c);
  });
});
