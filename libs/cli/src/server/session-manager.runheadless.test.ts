/**
 * SessionManager.runHeadless — keyless, in-process. Uses the scripted mock
 * provider (createMockStreamFn) so no API keys are needed. Proves:
 *   (a) a headless run whose agent emits display('done') returns
 *       { ok:true, sessionId } with result 'done', and disposes the VM;
 *   (b) a run that throws surfaces { ok:false, error, sessionId };
 *   (c) the headless session NEVER appears in listSessions() and never counts
 *       against capacity.
 */
import { describe, it, expect, afterAll } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { Session, createMockStreamFn } from '@lmthing/core';
import type { StreamOpts } from '@lmthing/core';
import { SessionManager } from './session-manager.js';
import type { BuildSessionArgs } from './session-manager.js';

const tmpDirs: string[] = [];

afterAll(async () => {
  await Promise.all(tmpDirs.map((d) => rm(d, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })));
});

/** A tmp lmthingRoot with a minimal one-agent 'user' project (spaces-only, no
 *  database/ → bootProjectApp returns null; agent lives at the project root so
 *  spaceDir defaults to it). */
async function makeRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'lmthing-runheadless-'));
  tmpDirs.push(root);
  const file = join(root, 'user', 'agents', 'thing', 'instruct.md');
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, 'You are a test agent.\n', 'utf8');
  return root;
}

/** Mock: emit display('done') on the first turn, then stop. */
const mockStreamFn = createMockStreamFn((opts: StreamOpts) => {
  const hasAssistant = opts.messages.some((m) => m.role === 'assistant');
  if (hasAssistant) return ''; // already emitted → done
  return `display("done");`;
});

describe('SessionManager.runHeadless (keyless, mock provider)', () => {
  it('(a) returns { ok:true, result } and disposes the VM', async () => {
    const root = await makeRoot();
    let disposed = false;
    const manager = new SessionManager({
      streamFn: mockStreamFn,
      lmthingRoot: root,
      buildSession: (args: BuildSessionArgs) => {
        const s = new Session(
          {
            spaceDir: args.spaceDir,
            agentSlug: args.agentSlug,
            modelAlias: 'mock',
            renderHost: args.renderHost,
            systemSpaceDirs: [], // keyless: no system spaces
            budget: args.budget,
          },
          { streamFn: mockStreamFn },
        );
        const origDispose = s.dispose.bind(s);
        s.dispose = () => {
          disposed = true;
          origDispose();
        };
        return s;
      },
    });

    const res = await manager.runHeadless({ agentSlug: 'thing', message: 'hello' });
    expect(res.ok).toBe(true);
    expect(res.sessionId).toBeTruthy();
    expect(res.error).toBeUndefined();
    expect(res.result).toBe('done');
    // The ephemeral VM was torn down.
    expect(disposed).toBe(true);
    // Never registered in the interactive pool.
    expect(manager.listSessions().length).toBe(0);
    expect(manager.getSession(res.sessionId)).toBeUndefined();
  });

  it('(d) a turn that displays NOTHING returns no result — never its own code', async () => {
    // The model does not answer in prose here, it writes TypeScript. `result`
    // used to fall back to the last history entry, so a turn that displayed
    // nothing "answered" with its own source — and a team channel posted the
    // agent's comments and `setActivity(...)` call into the thread as the reply.
    const root = await makeRoot();
    const silent = createMockStreamFn((opts: StreamOpts) => {
      const hasAssistant = opts.messages.some((m) => m.role === 'assistant');
      if (hasAssistant) return '';
      return `// checking what is already here first\nconst step = 1;`;
    });
    const manager = new SessionManager({
      streamFn: silent,
      lmthingRoot: root,
      buildSession: (args: BuildSessionArgs) =>
        new Session(
          {
            spaceDir: args.spaceDir,
            agentSlug: args.agentSlug,
            modelAlias: 'mock',
            renderHost: args.renderHost,
            systemSpaceDirs: [],
            budget: args.budget,
          },
          { streamFn: silent },
        ),
    });

    const res = await manager.runHeadless({ agentSlug: 'thing', message: 'build me something' });
    expect(res.ok).toBe(true);
    expect(res.displays).toEqual([]);
    expect(res.result).toBeUndefined();
    // The specific regression: no shape of the answer may carry the source.
    expect(JSON.stringify(res)).not.toContain('setActivity');
    expect(JSON.stringify(res)).not.toContain('const step');
  });

  it('(e) a WATCHED silent turn is nudged; an unwatched one is left alone', async () => {
    // The anti-silent guard skips forks, hooks and code-node runs because nobody
    // reads those. A THING turn in a team channel IS read — by everyone in the
    // thread — so a turn that does work and displays nothing must be nudged, not
    // allowed to settle in silence. That silence is why a channel got no answer.
    const root = await makeRoot();
    const calls = { n: 0 };
    // Always produces a real statement, never a display() — the shape that
    // settles `done` having shown a reader nothing.
    const silent = createMockStreamFn(() => {
      calls.n++;
      return `const step = ${calls.n};`;
    });
    const build = (args: BuildSessionArgs) =>
      new Session(
        {
          spaceDir: args.spaceDir,
          agentSlug: args.agentSlug,
          modelAlias: 'mock',
          renderHost: args.renderHost,
          systemSpaceDirs: [],
          budget: args.budget,
          interactive: args.interactive === true || args.visibleToUser === true,
        },
        { streamFn: silent },
      );

    const unwatched = new SessionManager({ streamFn: silent, lmthingRoot: root, buildSession: build });
    await unwatched.runHeadless({ agentSlug: 'thing', message: 'go' });
    const withoutGuard = calls.n;

    calls.n = 0;
    const watched = new SessionManager({ streamFn: silent, lmthingRoot: root, buildSession: build });
    await watched.runHeadless({ agentSlug: 'thing', message: 'go', visibleToUser: true });
    const withGuard = calls.n;

    // Unwatched: asked once and left to finish silently. Watched: asked again,
    // which is the nudge — "you did work and showed the reader nothing".
    expect(withGuard).toBeGreaterThan(withoutGuard);
  });

  it('(h) a THREADED turn that displays nothing returns no result — never its own code', async () => {
    // Case (d) pinned this for `runHeadless`, and the fallback was removed there
    // because a team channel had posted the agent's own statements into a thread.
    // It survived in `runHeadlessThreaded` — and a channel is the ONLY caller of
    // that path, so the fix reached every caller except the one it was written
    // for. A live run put "ERROR (attempt 3 of 3)" and a TypeScript overload
    // diagnostic in front of four colleagues.
    const root = await makeRoot();
    const silent = createMockStreamFn((opts: StreamOpts) => {
      const hasAssistant = opts.messages.some((m) => m.role === 'assistant');
      if (hasAssistant) return '';
      return `// checking what is already here first\nsetActivity('rebuilding');\nconst step = 1;`;
    });
    const manager = new SessionManager({
      streamFn: silent,
      lmthingRoot: root,
      buildSession: (args: BuildSessionArgs) =>
        new Session(
          {
            spaceDir: args.spaceDir,
            agentSlug: args.agentSlug,
            modelAlias: 'mock',
            renderHost: args.renderHost,
            systemSpaceDirs: [],
            budget: args.budget,
          },
          { streamFn: silent },
        ),
    });

    const res = await manager.runHeadlessThreaded({
      sessionId: 'silent-thread',
      agentSlug: 'thing',
      message: 'add a column',
    });
    expect(res.ok).toBe(true);
    expect(res.displays).toEqual([]);
    expect(res.result, 'no display means no answer — not the source').toBeUndefined();
    expect(JSON.stringify(res)).not.toContain('setActivity');
    expect(JSON.stringify(res)).not.toContain('const step');
  });

  it('(f) a THREADED run is recorded in the session ledger, like every other run', async () => {
    // `runHeadlessThreaded` subscribed to the session's tracer for displays but
    // never called `sessionLedger.trackTracer`, which `runHeadless` does. The two
    // are different jobs: the subscription feeds this call's RETURN VALUE, the
    // ledger is what the pod can answer `GET /api/session-ledger` with.
    //
    // So every threaded turn — every team-channel message and every inbound
    // webhook — spent real tokens and left no record of having spent them. It is
    // worst on a team pod, where the tokens are the TEAM's and a channel turn is
    // the one kind of run no member can see the cost of anywhere else.
    const root = await makeRoot();
    const manager = new SessionManager({
      streamFn: mockStreamFn,
      lmthingRoot: root,
      buildSession: (args: BuildSessionArgs) =>
        new Session(
          {
            spaceDir: args.spaceDir,
            agentSlug: args.agentSlug,
            modelAlias: 'mock',
            renderHost: args.renderHost,
            systemSpaceDirs: [],
            budget: args.budget,
          },
          { streamFn: mockStreamFn },
        ),
    });

    const res = await manager.runHeadlessThreaded({
      sessionId: 'thread-session-1',
      agentSlug: 'thing',
      message: 'hello',
      origin: { source: 'team-channel' },
    });
    expect(res.ok).toBe(true);

    const ledger = manager.listSessionLedger();
    const entry = ledger.find((r) => r.sessionId === 'thread-session-1');
    expect(entry, 'a threaded turn must appear in the ledger').toBeDefined();
    // The caller names the turn, so a team channel is distinguishable from a
    // webhook in the record rather than all of them reading as 'headless'.
    expect(entry!.source).toBe('team-channel');
  });

  it('(g) a threaded run with no stated origin is still recorded', async () => {
    // The webhook and event-dispatch callers pass no origin. Defaulting must not
    // be the difference between being in the ledger and being invisible.
    const root = await makeRoot();
    const manager = new SessionManager({
      streamFn: mockStreamFn,
      lmthingRoot: root,
      buildSession: (args: BuildSessionArgs) =>
        new Session(
          {
            spaceDir: args.spaceDir,
            agentSlug: args.agentSlug,
            modelAlias: 'mock',
            renderHost: args.renderHost,
            systemSpaceDirs: [],
            budget: args.budget,
          },
          { streamFn: mockStreamFn },
        ),
    });

    await manager.runHeadlessThreaded({ sessionId: 'thread-session-2', agentSlug: 'thing', message: 'hi' });
    const entry = manager.listSessionLedger().find((r) => r.sessionId === 'thread-session-2');
    expect(entry).toBeDefined();
    expect(entry!.source).toBe('headless-threaded');
  });

  it('(b) surfaces { ok:false, error } when the run throws', async () => {
    const root = await makeRoot();
    const manager = new SessionManager({
      streamFn: mockStreamFn,
      lmthingRoot: root,
      buildSession: () => {
        throw new Error('boom');
      },
    });

    const res = await manager.runHeadless({ agentSlug: 'thing', message: 'hello' });
    expect(res.ok).toBe(false);
    expect(res.error).toBe('boom');
    expect(res.sessionId).toBeTruthy();
    expect(res.result).toBeUndefined();
    // Failure still leaves the pool empty.
    expect(manager.listSessions().length).toBe(0);
  });

  it('(c) headless runs do not count against maxSessions capacity', async () => {
    const root = await makeRoot();
    const manager = new SessionManager({
      streamFn: mockStreamFn,
      lmthingRoot: root,
      maxSessions: 1,
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

    // Run several headless turns at a cap of 1 — none should register or evict.
    for (let i = 0; i < 3; i++) {
      const res = await manager.runHeadless({ agentSlug: 'thing', message: `msg ${i}` });
      expect(res.ok).toBe(true);
      expect(manager.listSessions().length).toBe(0);
    }
  });
});
