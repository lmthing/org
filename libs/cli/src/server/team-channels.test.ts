/**
 * Team channels (team-channels.ts + routes/team-channels.ts) — offline.
 *
 * The behaviour that matters is the one the spec calls for: members talk in
 * channels, and when they call THING in a thread it answers there and REMEMBERS
 * the conversation across messages — including across different members, since
 * the thread owns the session, not the person.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, rm, readFile, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';
import {
  appendMessage,
  channelIdFromName,
  createChannel,
  dmChannelId,
  ensureDefaultChannel,
  isValidChannelId,
  listChannels,
  mentionsThing,
  patchChannel,
  promptFor,
  readMessages,
  stripMention,
  teamDir,
  threadRootOf,
  type ChannelMessage,
} from './team-channels.js';
import {
  hasPendingAsk,
  handleCreateChannel,
  handleListChannels,
  handleListMessages,
  handlePostMessage,
  runningTurns,
  settleChannelWork,
} from './routes/team-channels.js';
import { registerChannelSocket, resetChannelSockets } from './ws/team-channels.js';

/**
 * A socket that only records. `broadcastChannelEvent` writes to real subscribers,
 * so watching what a member would have received is more faithful than mocking the
 * broadcaster out — and it is the only way to see a frame that carries no message.
 */
function watchEvents(): any[] {
  const seen: any[] = [];
  const fake = {
    readyState: 1,
    send: (raw: string) => seen.push(JSON.parse(raw)),
    on: () => {},
  };
  registerChannelSocket(fake as never, { userId: 'u1', email: 'ana@example.com' });
  return seen;
}

let root: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'lm-team-'));
  process.env['LMTHING_TEAM_MODE'] = '1';
  resetChannelSockets();
});
afterEach(async () => {
  // A POST returns before its delivery bookkeeping finishes, by design. Draining
  // it here stops that write racing the teardown below — which surfaced as an
  // ENOTEMPTY on a directory being removed while it was still being written to.
  await settleChannelWork();
  delete process.env['LMTHING_TEAM_MODE'];
  await rm(root, { recursive: true, force: true });
});

// ─── HTTP test doubles ───────────────────────────────────────────────────────

const VIEWER = {
  'x-user-id': 'u1',
  'x-user-email': 'ana@example.com',
  'x-team-id': 't1',
  'x-lmthing-role': 'viewer',
};
const OTHER = { ...VIEWER, 'x-user-id': 'u2', 'x-user-email': 'bo@example.com' };

function mkReq(method: string, url: string, body?: unknown, headers = VIEWER): IncomingMessage {
  const chunks = body === undefined ? [] : [Buffer.from(JSON.stringify(body))];
  const req = {
    method,
    url,
    headers,
    async *[Symbol.asyncIterator]() {
      for (const c of chunks) yield c;
    },
    on(event: string, cb: (arg?: unknown) => void) {
      if (event === 'data') chunks.forEach((c) => cb(c));
      if (event === 'end') cb();
      return req;
    },
    setEncoding() {
      return req;
    },
  } as unknown as IncomingMessage;
  return req;
}

function mkRes(): ServerResponse & { statusCode: number; json: () => any } {
  let payload = '';
  let status = 0;
  const res = {
    setHeader() {},
    writeHead(s: number) {
      status = s;
      return res;
    },
    end(body?: string) {
      if (body) payload = body;
    },
    get statusCode() {
      return status;
    },
    json: () => JSON.parse(payload || '{}'),
  } as unknown as ServerResponse & { statusCode: number; json: () => any };
  return res;
}

/** A SessionManager stub that records the threaded runs THING was asked to do. */
function mkManager(reply: string | ((msg: string) => string) = 'ok') {
  const runs: Array<{ sessionId: string; message: string; agentSlug: string }> = [];
  return {
    runs,
    manager: {
      runHeadlessThreaded: vi.fn(async (opts: any) => {
        runs.push({ sessionId: opts.sessionId, message: opts.message, agentSlug: opts.agentSlug });
        return {
          ok: true,
          result: typeof reply === 'function' ? reply(opts.message) : reply,
          sessionId: opts.sessionId,
        };
      }),
    } as any,
  };
}

/** A manager stub with an in-memory upload store, standing in for
 *  `SessionManager.readUploadMeta`/`bindUploadToChannel`/`assembleAttachments`. */
function mkManagerWithUploads(reply: string | ((msg: unknown) => string) = 'ok') {
  const { manager, runs } = mkManager(reply as never);
  const uploads = new Map<string, { ownerUserId?: string; kind: string; mediaType: string; filename?: string }>();
  const bound: Array<{ id: string; channelId: string }> = [];
  manager.readUploadMeta = vi.fn(async (id: string) => uploads.get(id) ?? null);
  manager.bindUploadToChannel = vi.fn(async (id: string, channelId: string) => {
    bound.push({ id, channelId });
  });
  // Mirrors the real `SessionManager.assembleAttachments`'s shape closely enough
  // to prove the ROUTING: THING's turn receives the attachment ids the message
  // carried, not the ids re-derived some other way.
  manager.assembleAttachments = vi.fn(async (text: string, attachmentIds: string[]) => ({
    input: {
      text,
      attachments: attachmentIds.map((id) => ({ id, kind: 'image', mediaType: 'image/png' })),
    },
  }));
  return { manager, runs, uploads, bound };
}

/** Wait for the out-of-band THING reply the POST handler kicked off. */
const settle = settleChannelWork;

// ─── Pure helpers ────────────────────────────────────────────────────────────

describe('channel ids', () => {
  it('slugifies a display name', () => {
    expect(channelIdFromName('Product Design')).toBe('product-design');
    expect(channelIdFromName('  Q3 planning!  ')).toBe('q3-planning');
  });

  it('rejects ids that could escape the log directory', () => {
    for (const bad of ['../etc', 'a/b', '', 'A', '-lead', 'x'.repeat(65)]) {
      expect(isValidChannelId(bad)).toBe(false);
    }
    expect(isValidChannelId('general')).toBe(true);
  });

  /**
   * The DM-id separator used to be a RAW NUL byte written into this source file
   * rather than the `\0` escape. It compiled and worked, but `file` reported the
   * source as binary and grep silently skipped the entire module — which is how a
   * file this central stayed invisible to every search anyone ran.
   *
   * Replacing it with the escape produces the identical string, so every DM
   * channel already on disk keeps its id. These are the values the RAW-NUL version
   * produced, computed before the change and pinned here: if the separator ever
   * changes again, two people's existing conversation silently splits in half.
   */
  it('derives a stable, order-independent DM id (unchanged by the \\0 escape fix)', () => {
    expect(dmChannelId(['a', 'b'])).toBe('dm-59b271ae1bbcb1d31d41929817f4b16f');
    expect(dmChannelId(['u2', 'u1'])).toBe('dm-c2eb696335ff17c2691c63055d1afb18');
    // Order and duplicates cannot change it — two people opening a DM from
    // opposite ends must land in the same channel.
    expect(dmChannelId(['b', 'a', 'b'])).toBe(dmChannelId(['a', 'b']));
    expect(isValidChannelId(dmChannelId(['a', 'b']))).toBe(true);
  });
});

describe('addressing THING', () => {
  it('recognises a mention only as a whole word', () => {
    expect(mentionsThing('@thing what is this?')).toBe(true);
    expect(mentionsThing('hey @THING')).toBe(true);
    expect(mentionsThing('the thing is broken')).toBe(false);
    expect(mentionsThing('email me@things.com')).toBe(false);
  });

  it('strips the handle before the agent sees it', () => {
    expect(stripMention('@thing summarise the docs')).toBe('summarise the docs');
  });

  it('names the sender so a multi-person thread reads correctly', () => {
    const m = {
      id: 'm1', ts: '', channelId: 'general', kind: 'user' as const,
      text: '@thing hi', email: 'ana@example.com',
    };
    expect(promptFor(m)).toBe('[ana@example.com in #general] hi');
  });

  it('threads a reply under the message that opened the thread', () => {
    const root_ = { id: 'm1', ts: '', channelId: 'c', kind: 'user' as const, text: 'x' };
    expect(threadRootOf(root_)).toBe('m1');
    expect(threadRootOf({ ...root_, id: 'm2', threadId: 'm1' })).toBe('m1');
  });
});

// ─── Store ───────────────────────────────────────────────────────────────────

describe('the channel store', () => {
  it('seeds #general so a new team can talk immediately', async () => {
    expect(await listChannels(root)).toEqual([]);
    const channels = await ensureDefaultChannel(root);
    expect(channels.map((c) => c.id)).toEqual(['general']);
    // Idempotent — a second call must not add a duplicate.
    expect((await ensureDefaultChannel(root)).length).toBe(1);
  });

  // Whichever entry point a fresh team hits first must not decide whether it
  // gets a #general. Seeding on "the list is empty" meant creating a channel
  // before anyone listed wrote the file WITHOUT #general, permanently.
  it('still seeds #general when the first act is creating another channel', async () => {
    const made = await createChannel(root, 'standup', 'u1');
    expect(made.created).toBe(true);
    expect((await listChannels(root)).map((c) => c.id).sort()).toEqual(['general', 'standup']);
  });

  it('does not resurrect #general once a team has deliberately removed it', async () => {
    await ensureDefaultChannel(root);
    await createChannel(root, 'standup', 'u1');
    // Drop #general the way a future delete would: rewrite the file without it.
    const remaining = (await listChannels(root)).filter((c) => c.id !== 'general');
    await writeFile(join(teamDir(root), 'channels.json'), JSON.stringify(remaining), 'utf8');
    expect((await ensureDefaultChannel(root)).map((c) => c.id)).toEqual(['standup']);
  });

  it('creates channels and is idempotent on the id', async () => {
    await ensureDefaultChannel(root);
    const first = await createChannel(root, 'Product Design', 'u1');
    expect(first.created).toBe(true);
    const again = await createChannel(root, 'product design', 'u2');
    expect(again.created).toBe(false);
    expect(again.channel.createdBy).toBe('u1');
  });

  it('lives in a dot-dir so it is never mistaken for a project', async () => {
    await ensureDefaultChannel(root);
    expect(teamDir(root).endsWith('/.team')).toBe(true);
    // listProjects only accepts a dir containing project.json; .team has none.
    const { listProjects } = await import('./projects.js');
    expect(await listProjects(root)).toEqual([]);
  });

  it('appends and reads back messages in order', async () => {
    for (const text of ['one', 'two', 'three']) {
      await appendMessage(root, { channelId: 'general', kind: 'user', text, userId: 'u1' });
    }
    const { messages } = await readMessages(root, 'general');
    expect(messages.map((m) => m.text)).toEqual(['one', 'two', 'three']);
  });

  it('returns an empty page for a channel with no history', async () => {
    expect(await readMessages(root, 'never-used')).toEqual({ messages: [], hasMore: false });
  });

  it('pages backwards from a message id', async () => {
    const ids: string[] = [];
    for (let i = 0; i < 10; i++) {
      const m = await appendMessage(root, {
        channelId: 'general', kind: 'user', text: `m${i}`, userId: 'u1',
      });
      ids.push(m.id);
    }
    const tail = await readMessages(root, 'general', { limit: 3 });
    expect(tail.messages.map((m) => m.text)).toEqual(['m7', 'm8', 'm9']);
    expect(tail.hasMore).toBe(true);

    const older = await readMessages(root, 'general', { limit: 3, before: ids[7] });
    expect(older.messages.map((m) => m.text)).toEqual(['m4', 'm5', 'm6']);
  });

  it('survives a torn trailing line rather than losing the channel', async () => {
    await appendMessage(root, { channelId: 'general', kind: 'user', text: 'kept', userId: 'u1' });
    const log = join(teamDir(root), 'channels', 'general.jsonl');
    await writeFile(log, (await readFile(log, 'utf8')) + '{"id":"broken", "te', 'utf8');
    const { messages } = await readMessages(root, 'general');
    expect(messages.map((m) => m.text)).toEqual(['kept']);
  });
});

// ─── Routes ──────────────────────────────────────────────────────────────────

describe('channel routes', () => {
  it('lists channels, seeding the default', async () => {
    const res = mkRes();
    await handleListChannels(root)(mkReq('GET', '/api/team/channels'), res, {}, {} as any);
    expect(res.statusCode).toBe(200);
    expect(res.json().channels.map((c: any) => c.id)).toEqual(['general']);
  });

  it('creates a channel, attributed to the caller', async () => {
    const res = mkRes();
    await handleCreateChannel(root)(
      mkReq('POST', '/api/team/channels', { name: 'Design' }), res, {}, {} as any,
    );
    expect(res.statusCode).toBe(201);
    expect(res.json().channel).toMatchObject({ id: 'design', createdBy: 'u1' });
  });

  it('rejects a nameless channel and an unsafe channel id', async () => {
    const r1 = mkRes();
    await handleCreateChannel(root)(
      mkReq('POST', '/api/team/channels', { name: '  ' }), r1, {}, {} as any,
    );
    expect(r1.statusCode).toBe(400);

    const r2 = mkRes();
    await handleListMessages(root)(
      mkReq('GET', '/api/team/channels/x/messages'), r2, { channelId: '../etc' }, {} as any,
    );
    expect(r2.statusCode).toBe(400);
  });

  it('stores a posted message with its author', async () => {
    const { manager } = mkManager();
    const res = mkRes();
    await handlePostMessage(manager, root)(
      mkReq('POST', '/api/team/channels/general/messages', { text: 'morning all' }),
      res, { channelId: 'general' }, {} as any,
    );
    expect(res.statusCode).toBe(201);
    expect(res.json().message).toMatchObject({
      text: 'morning all', kind: 'user', userId: 'u1', email: 'ana@example.com',
    });
    // No mention → THING is not invoked.
    await settle();
    expect(manager.runHeadlessThreaded).not.toHaveBeenCalled();
  });

  it('rejects an empty message', async () => {
    const { manager } = mkManager();
    const res = mkRes();
    await handlePostMessage(manager, root)(
      mkReq('POST', '/api/team/channels/general/messages', { text: '   ' }),
      res, { channelId: 'general' }, {} as any,
    );
    expect(res.statusCode).toBe(400);
  });
});

describe('message attachments', () => {
  it('refuses attachments with no verified caller — defence in depth', async () => {
    // The team guard already refuses any team-mode request with no caller
    // before this handler ever runs, so a real client cannot reach this path —
    // but there is no identity to check ownership against, so it must refuse
    // rather than silently posting no attachments.
    const { manager, bound } = mkManagerWithUploads();
    const res = mkRes();
    await handlePostMessage(manager, root)(
      mkReq('POST', '/api/team/channels/general/messages', {
        text: 'hi', attachmentIds: ['up-1'],
      }, {} as unknown as typeof VIEWER),
      res, { channelId: 'general' }, {} as any,
    );
    expect(res.statusCode).toBe(401);
    expect(bound).toEqual([]);
  });

  it('stores an owned attachment on the message, and binds it to the channel', async () => {
    const { manager, uploads, bound } = mkManagerWithUploads();
    uploads.set('up-1', { ownerUserId: 'u1', kind: 'image', mediaType: 'image/png', filename: 'cat.png' });

    const res = mkRes();
    await handlePostMessage(manager, root)(
      mkReq('POST', '/api/team/channels/general/messages', { text: 'look at this', attachmentIds: ['up-1'] }),
      res, { channelId: 'general' }, {} as any,
    );
    expect(res.statusCode).toBe(201);
    expect(res.json().message.attachments).toEqual([
      { id: 'up-1', kind: 'image', mediaType: 'image/png', filename: 'cat.png', url: '/api/uploads/up-1' },
    ]);
    // Bound BEFORE the response even went out — no window where the socket frame
    // could beat the write that makes the id fetchable.
    expect(bound).toEqual([{ id: 'up-1', channelId: 'general' }]);

    const { messages } = await readMessages(root, 'general');
    expect(messages[0]!.attachments).toEqual([
      { id: 'up-1', kind: 'image', mediaType: 'image/png', filename: 'cat.png', url: '/api/uploads/up-1' },
    ]);
  });

  it("refuses to post someone else's upload as an attachment", async () => {
    // Without this, a member could name an upload id they do not own and
    // thereby publish it to the whole channel — reopening the authorization
    // gap `GET /api/uploads/:id`'s owner check exists to close, by naming it in
    // a POST instead of a GET.
    const { manager, bound } = mkManagerWithUploads();
    manager.readUploadMeta = vi.fn(async (id: string) =>
      id === 'not-mine' ? { ownerUserId: 'u2', kind: 'image', mediaType: 'image/png' } : null,
    );

    const res = mkRes();
    await handlePostMessage(manager, root)(
      mkReq('POST', '/api/team/channels/general/messages', {
        text: 'sneaky', attachmentIds: ['not-mine'],
      }),
      res, { channelId: 'general' }, {} as any,
    );
    expect(res.statusCode).toBe(403);
    expect(res.json().attachmentIds).toEqual(['not-mine']);
    expect(bound).toEqual([]);

    // Nothing was posted at all — refusing the attachment refuses the message,
    // rather than silently dropping the attachment and posting the text anyway.
    const { messages } = await readMessages(root, 'general');
    expect(messages).toEqual([]);
  });

  it('allows an ownerless (legacy) upload to be attached — same decision as serving it', async () => {
    const { manager, bound } = mkManagerWithUploads();
    manager.readUploadMeta = vi.fn(async (id: string) =>
      id === 'legacy' ? { kind: 'image', mediaType: 'image/png' } : null,
    );

    const res = mkRes();
    await handlePostMessage(manager, root)(
      mkReq('POST', '/api/team/channels/general/messages', { text: 'old one', attachmentIds: ['legacy'] }),
      res, { channelId: 'general' }, {} as any,
    );
    expect(res.statusCode).toBe(201);
    expect(bound).toEqual([{ id: 'legacy', channelId: 'general' }]);
  });
});

describe('THING in a thread', () => {
  it('answers a mention in the thread, and stores the reply', async () => {
    const { manager, runs } = mkManager('42');
    const res = mkRes();
    await handlePostMessage(manager, root)(
      mkReq('POST', '/api/team/channels/general/messages', { text: '@thing what is 6*7?' }),
      res, { channelId: 'general' }, {} as any,
    );
    const asked = res.json().message as ChannelMessage;
    await settle();

    expect(runs).toHaveLength(1);
    expect(runs[0]!.agentSlug).toBe('thing');
    expect(runs[0]!.message).toBe('[ana@example.com in #general] what is 6*7?');

    const { messages } = await readMessages(root, 'general');
    expect(messages.map((m) => [m.kind, m.text])).toEqual([
      ['user', '@thing what is 6*7?'],
      ['thing', '42'],
    ]);
    // The reply is threaded under the question, so the channel stays readable.
    expect(messages[1]!.threadId).toBe(asked.id);
  });

  it("passes the asking message's attachments into THING's turn", async () => {
    // The path already exists for `/chat` (`assembleAttachments`) — this proves
    // a channel mention routes through the SAME mechanism rather than a second
    // one, so THING can actually see an image or read a file posted with the
    // question, not just its text.
    const { manager, runs, uploads } = mkManagerWithUploads('looks like a cat');
    uploads.set('up-1', { ownerUserId: 'u1', kind: 'image', mediaType: 'image/png', filename: 'cat.png' });

    const res = mkRes();
    await handlePostMessage(manager, root)(
      mkReq('POST', '/api/team/channels/general/messages', {
        text: '@thing what is in this?', attachmentIds: ['up-1'],
      }),
      res, { channelId: 'general' }, {} as any,
    );
    expect(res.statusCode).toBe(201);
    await settle();

    expect(manager.assembleAttachments).toHaveBeenCalledWith(
      '[ana@example.com in #general] what is in this?',
      ['up-1'],
    );
    // What actually reached `runHeadlessThreaded` is `assembleAttachments`'s
    // OUTPUT (text + attachments), not the bare prompt string.
    expect(runs).toHaveLength(1);
    expect(runs[0]!.message).toEqual({
      text: '[ana@example.com in #general] what is in this?',
      attachments: [{ id: 'up-1', kind: 'image', mediaType: 'image/png' }],
    });
  });

  it('does not touch attachment assembly for a plain mention with no attachments', async () => {
    const { manager, runs } = mkManagerWithUploads('ok');
    const res = mkRes();
    await handlePostMessage(manager, root)(
      mkReq('POST', '/api/team/channels/general/messages', { text: '@thing hello' }),
      res, { channelId: 'general' }, {} as any,
    );
    await settle();
    expect(manager.assembleAttachments).not.toHaveBeenCalled();
    expect(runs[0]!.message).toBe('[ana@example.com in #general] hello');
  });

  it('keeps one session per thread — so THING remembers across messages', async () => {
    const { manager, runs } = mkManager();
    const first = mkRes();
    await handlePostMessage(manager, root)(
      mkReq('POST', '/api/team/channels/general/messages', {
        text: '@thing remember the word pineapple',
      }),
      first, { channelId: 'general' }, {} as any,
    );
    const opener = first.json().message as ChannelMessage;
    await settle();

    // A DIFFERENT member replies in the same thread.
    const second = mkRes();
    await handlePostMessage(manager, root)(
      mkReq(
        'POST', '/api/team/channels/general/messages',
        { text: '@thing what word?', threadId: opener.id },
        OTHER,
      ),
      second, { channelId: 'general' }, {} as any,
    );
    await settle();

    expect(runs).toHaveLength(2);
    // Same session id → the second turn resumes the first's conversation. This
    // is what makes the memory work, and it works across members.
    expect(runs[1]!.sessionId).toBe(runs[0]!.sessionId);
    expect(runs[1]!.message).toBe('[bo@example.com in #general] what word?');
  });

  it('gives a different thread its own session', async () => {
    const { manager, runs } = mkManager();
    for (const text of ['@thing question one', '@thing unrelated question']) {
      const res = mkRes();
      await handlePostMessage(manager, root)(
        mkReq('POST', '/api/team/channels/general/messages', { text }),
        res, { channelId: 'general' }, {} as any,
      );
      await settle();
    }
    expect(runs).toHaveLength(2);
    expect(runs[1]!.sessionId).not.toBe(runs[0]!.sessionId);
  });

  it('separates threads that share an id across different channels', async () => {
    const { manager, runs } = mkManager();
    await createChannel(root, 'design', 'u1'); // a message needs a real channel
    for (const channelId of ['general', 'design']) {
      const res = mkRes();
      await handlePostMessage(manager, root)(
        mkReq('POST', `/api/team/channels/${channelId}/messages`, {
          text: '@thing hello', threadId: 'shared-id',
        }),
        res, { channelId }, {} as any,
      );
      await settle();
    }
    expect(runs[0]!.sessionId).not.toBe(runs[1]!.sessionId);
  });

  it('refuses a message to a channel that does not exist', async () => {
    // Without this, a typo'd id silently created an invisible channel: messages
    // accumulated and were broadcast, but nothing ever listed it.
    const { manager, runs } = mkManager();
    const res = mkRes();
    await handlePostMessage(manager, root)(
      mkReq('POST', '/api/team/channels/typo/messages', { text: '@thing hello' }),
      res, { channelId: 'typo' }, {} as any,
    );
    await settle();
    expect(res.statusCode).toBe(404);
    expect(runs).toHaveLength(0);
  });

  it('reports a failed turn in the channel instead of swallowing it', async () => {
    const manager = {
      runHeadlessThreaded: vi.fn(async () => ({
        ok: false, error: 'budget exhausted', sessionId: 's1',
      })),
    } as any;
    const res = mkRes();
    await handlePostMessage(manager, root)(
      mkReq('POST', '/api/team/channels/general/messages', { text: '@thing hi' }),
      res, { channelId: 'general' }, {} as any,
    );
    await settle();

    const { messages } = await readMessages(root, 'general');
    expect(messages[1]).toMatchObject({ kind: 'system' });
    // The point of this test is that the failure is REPORTED, not swallowed. It
    // used to assert the raw provider string appeared verbatim; a channel is
    // shared and permanent, so the raw text now goes to the server log and the
    // member gets something they can act on. The failure is still announced, and
    // still says which kind of failure it was.
    expect(messages[1]!.text.toLowerCase()).toContain('could not finish');
    expect(messages[1]!.text.toLowerCase()).toContain('usage limit');
  });

  describe('the app card', () => {
    /** A project on disk with an authored app surface, as a build would leave it. */
    async function writeApp(projectId: string, files: Record<string, string>) {
      await mkdir(join(root, projectId), { recursive: true });
      await writeFile(join(root, projectId, 'project.json'), JSON.stringify({ id: projectId, name: projectId }), 'utf8');
      for (const [rel, body] of Object.entries(files)) {
        await mkdir(dirname(join(root, projectId, rel)), { recursive: true });
        await writeFile(join(root, projectId, rel), body, 'utf8');
      }
    }

    it('announces a NEW app as ready, and pins it to the channel', async () => {
      const manager = {
        runHeadlessThreaded: vi.fn(async (opts: any) => {
          await writeApp('jobs', { 'pages/index.tsx': 'export default () => null;', 'database/jobs.json': '{}' });
          return { ok: true, result: 'built it', sessionId: opts.sessionId };
        }),
      } as any;
      await handlePostMessage(manager, root)(
        mkReq('POST', '/api/team/channels/general/messages', { text: '@thing build me a tracker' }),
        mkRes(), { channelId: 'general' }, {} as any,
      );
      await settle();

      const { messages } = await readMessages(root, 'general');
      const card = messages.find((m) => m.kind === 'system' && /is ready/.test(m.text));
      expect(card, 'a new app must announce itself').toBeTruthy();
      const channels = await ensureDefaultChannel(root);
      expect(channels.find((c) => c.id === 'general')?.apps).toContain('jobs');
    });

    it('announces an UPDATE to an app the team already had', async () => {
      // The card fired only when a project GAINED a pages/ dir, which happens
      // exactly once in an app's life. Every later change — a column, a page, a
      // sort order — left the project set identical, so THING replied "done" and
      // the surface the team actually looks at showed nothing at all.
      await writeApp('jobs', { 'pages/index.tsx': 'export default () => null;', 'database/jobs.json': '{"columns":{}}' });
      // mtime resolution: make the edit distinguishable from the seed write.
      await new Promise((r) => setTimeout(r, 20));

      const manager = {
        runHeadlessThreaded: vi.fn(async (opts: any) => {
          await writeFile(join(root, 'jobs', 'database', 'jobs.json'), '{"columns":{"pictures_in":{}}}', 'utf8');
          return { ok: true, result: 'added it', sessionId: opts.sessionId };
        }),
      } as any;
      await handlePostMessage(manager, root)(
        mkReq('POST', '/api/team/channels/general/messages', { text: '@thing add a column for the pictures' }),
        mkRes(), { channelId: 'general' }, {} as any,
      );
      await settle();

      const { messages } = await readMessages(root, 'general');
      const card = messages.find((m) => m.kind === 'system' && /was updated/.test(m.text));
      expect(card, 'a change to an existing app must announce itself').toBeTruthy();
      expect(card!.app).toMatchObject({ projectId: 'jobs' });
    });

    it('says nothing when the turn changed no app', async () => {
      // The other half: a plain question must not produce a card.
      await writeApp('jobs', { 'pages/index.tsx': 'export default () => null;' });
      const { manager } = mkManager('just answering');
      await handlePostMessage(manager, root)(
        mkReq('POST', '/api/team/channels/general/messages', { text: '@thing what is the status' }),
        mkRes(), { channelId: 'general' }, {} as any,
      );
      await settle();

      const { messages } = await readMessages(root, 'general');
      expect(messages.filter((m) => m.kind === 'system')).toHaveLength(0);
    });
  });

  it('a pagination cursor that is not in the channel is reported, not silently reset', async () => {
    // The log is append-only and read whole, so a `before` id that is not in it
    // is not "old" — it is not this channel's. The old code discarded that fact
    // and returned the NEWEST window while still answering hasMore:true, so a
    // client paginating with a bad cursor was teleported to the top of the
    // conversation and told to keep going: an infinite loop over the same page.
    for (let i = 0; i < 3; i++) {
      await appendMessage(root, { channelId: 'general', kind: 'user', text: `m${i}`, userId: 'u1' });
    }
    const good = await readMessages(root, 'general', { limit: 10 });
    expect(good.messages).toHaveLength(3);
    expect(good.staleCursor).toBeUndefined();

    const stale = await readMessages(root, 'general', { before: 'not-a-real-id', limit: 10 });
    expect(stale.messages).toEqual([]);
    expect(stale.hasMore).toBe(false);
    expect(stale.staleCursor).toBe(true);
  });

  it('a VIEWER\'s turn runs without the write capabilities at all', async () => {
    // Not "THING declines" — THING is never granted them. The role reaches the
    // turn as data, and data is advice: live, the same request got a proper
    // role-based refusal in one run and was silently ignored in another, where
    // the turn read the role, ran display(db.tables()) and settled done.
    //
    // Withheld grants are structural: not granted means not injected AND absent
    // from the DTS, so a write is a typecheck error the model sees.
    const seen: Array<boolean | undefined> = [];
    const manager = {
      runHeadlessThreaded: vi.fn(async (opts: any) => {
        seen.push(opts.readOnly);
        return { ok: true, result: 'noted', sessionId: opts.sessionId };
      }),
    } as any;

    // VIEWER is the default header set in this suite.
    await handlePostMessage(manager, root)(
      mkReq('POST', '/api/team/channels/general/messages', { text: '@thing mark it invoiced' }),
      mkRes(), { channelId: 'general' }, {} as any,
    );
    await settle();
    expect(seen).toEqual([true]);

    // An editor is unaffected — the gate must not make the product read-only.
    const EDITOR = { ...VIEWER, 'x-lmthing-role': 'editor' };
    await handlePostMessage(manager, root)(
      mkReq('POST', '/api/team/channels/general/messages', { text: '@thing mark it invoiced' }, EDITOR),
      mkRes(), { channelId: 'general' }, {} as any,
    );
    await settle();
    expect(seen[1]).toBe(false);
  });

  it('never shows a member a sandbox-internal error string', async () => {
    // A live run posted "THING could not answer: Lifetime not alive" — QuickJS's
    // wording for an operation on a disposed handle — into a newsroom's channel,
    // where it was read by colleagues who had not asked and quoted by a push.
    //
    // The rule is not "hide errors": the member is still told it failed and
    // whether retrying is worth anything. What they cannot use is the internals.
    const manager = {
      runHeadlessThreaded: vi.fn(async () => {
        throw new Error('Lifetime not alive');
      }),
    } as any;
    await handlePostMessage(manager, root)(
      mkReq('POST', '/api/team/channels/general/messages', { text: '@thing where are we' }),
      mkRes(), { channelId: 'general' }, {} as any,
    );
    await settle();

    const { messages } = await readMessages(root, 'general');
    const failure = messages[1]!;
    expect(failure.kind).toBe('system');
    expect(failure.text).not.toContain('Lifetime not alive');
    // It still says it failed, and what to do.
    expect(failure.text.toLowerCase()).toContain('could not finish');
    expect(failure.text.toLowerCase()).toContain('ask again');
  });

  it('maps a failure the pod RETURNS, not only one it throws', async () => {
    const manager = {
      runHeadlessThreaded: vi.fn(async (opts: any) => ({
        ok: false, error: 'ETIMEDOUT: socket hang up', sessionId: opts.sessionId,
      })),
    } as any;
    await handlePostMessage(manager, root)(
      mkReq('POST', '/api/team/channels/general/messages', { text: '@thing hi' }),
      mkRes(), { channelId: 'general' }, {} as any,
    );
    await settle();

    const { messages } = await readMessages(root, 'general');
    expect(messages[1]!.text).not.toContain('ETIMEDOUT');
    expect(messages[1]!.text.toLowerCase()).toContain('could not finish');
  });

  describe('which project a channel turn runs in', () => {
    async function writeApp(projectId: string) {
      await mkdir(join(root, projectId, 'pages'), { recursive: true });
      await writeFile(join(root, projectId, 'project.json'), JSON.stringify({ id: projectId, name: projectId }), 'utf8');
      await writeFile(join(root, projectId, 'pages', 'index.tsx'), 'export default () => null;', 'utf8');
    }
    function spyManager(seen: Array<string | undefined>) {
      return {
        runHeadlessThreaded: vi.fn(async (opts: any) => {
          seen.push(opts.projectId);
          return { ok: true, result: 'ok', sessionId: opts.sessionId };
        }),
      } as any;
    }
    const post = (manager: any, channelId: string) =>
      handlePostMessage(manager, root)(
        mkReq('POST', `/api/team/channels/${channelId}/messages`, { text: '@thing what is in there' }),
        mkRes(), { channelId }, {} as any,
      );

    it('runs in the app pinned to THIS channel', async () => {
      // The bug: the turn was started with no projectId at all, so it ran in the
      // default project while THING had correctly built the team's app in one of
      // its own — db.tables() answered [] about a database holding three rows.
      //
      // The trap is that DOING THE RIGHT THING triggered it. A run where THING
      // lazily built into the shared default project worked; the run where it
      // properly made a dedicated project did not.
      await writeApp('job-tracker');
      await writeApp('something-else');
      await createChannel(root, 'studio', 'u1');
      await patchChannel(root, 'studio', { apps: ['job-tracker'] });

      const seen: Array<string | undefined> = [];
      await post(spyManager(seen), 'studio');
      await settle();
      expect(seen).toEqual(['job-tracker']);
    });

    it('falls back to the only app on the pod when this channel has no pin', async () => {
      // #press asking about what #studio built is the ordinary case, and with
      // exactly one app there is nothing to be ambiguous about.
      await writeApp('job-tracker');
      await createChannel(root, 'press', 'u1');

      const seen: Array<string | undefined> = [];
      await post(spyManager(seen), 'press');
      await settle();
      expect(seen).toEqual(['job-tracker']);
    });

    it('refuses to guess between several unpinned apps', async () => {
      // Guessing here would make a thread's meaning depend on what somebody did
      // in another channel a minute ago. Undefined keeps the caller's default.
      await writeApp('one');
      await writeApp('two');
      await createChannel(root, 'press', 'u1');

      const seen: Array<string | undefined> = [];
      await post(spyManager(seen), 'press');
      await settle();
      expect(seen).toEqual([undefined]);
    });
  });

  it('a CRASHED turn still reaches the person who asked', async () => {
    // The success path stamps `mentions: [asker]` and calls `deliver` (badge +
    // push). The crash path did neither, so the one outcome you most need to be
    // told about was the only one that never reached you: you asked THING
    // something, closed the tab, and the thread quietly held a failure addressed
    // to nobody.
    //
    // Distinct from the `ok: false` case above, which returns normally and so
    // took the stamped path all along. This is a THROW.
    const manager = {
      runHeadlessThreaded: vi.fn(async () => {
        throw new Error('the pod fell over');
      }),
    } as any;
    const res = mkRes();
    await handlePostMessage(manager, root)(
      mkReq('POST', '/api/team/channels/general/messages', { text: '@thing hi' }),
      res, { channelId: 'general' }, {} as any,
    );
    await settle();

    const { messages } = await readMessages(root, 'general');
    const asker = messages[0]!.userId;
    expect(asker, 'the test caller must have an identity for this to mean anything').toBeTruthy();
    expect(messages[1]).toMatchObject({ kind: 'system' });
    // The subject here is the ADDRESSING, not the wording — the raw throw text is
    // deliberately no longer shown in a channel (see the sandbox-internal test).
    expect(messages[1]!.text).not.toContain('the pod fell over');
    expect(messages[1]!.text.toLowerCase()).toContain('could not finish');
    expect(messages[1]!.mentions, 'a crash must be addressed to whoever asked').toContain(asker);
  });

  it('a plain reply in a THING thread reaches THING — no second @thing', async () => {
    // Having to re-address the agent in a thread it is already in is not how a
    // conversation works, and the effect was a reply that went nowhere: the
    // thread simply looked dead.
    const { manager, runs } = mkManager('42');
    const opened = mkRes();
    await handlePostMessage(manager, root)(
      mkReq('POST', '/api/team/channels/general/messages', { text: '@thing what is 6*7?' }),
      opened, { channelId: 'general' }, {} as any,
    );
    const asked = opened.json().message as ChannelMessage;
    await settle();
    expect(runs).toHaveLength(1);

    const followUp = mkRes();
    await handlePostMessage(manager, root)(
      mkReq('POST', '/api/team/channels/general/messages', {
        text: 'and what about 6*8?',
        threadId: asked.id,
      }),
      followUp, { channelId: 'general' }, {} as any,
    );
    await settle();

    expect(runs).toHaveLength(2);
    // The mention is gone from the text, so the prompt is the question as typed.
    expect(runs[1]!.message).toBe('[ana@example.com in #general] and what about 6*8?');
    // Same thread ⇒ same session, which is what "it remembers" rests on.
    expect(runs[1]!.sessionId).toBe(runs[0]!.sessionId);
  });

  it('a plain reply in a thread THING is NOT in stays between the humans', async () => {
    // The implicit addressing is scoped to threads THING is already in. A thread
    // opened between colleagues must not start invoking an agent nobody asked for.
    const { manager, runs } = mkManager();
    const opened = mkRes();
    await handlePostMessage(manager, root)(
      mkReq('POST', '/api/team/channels/general/messages', { text: 'ship it?' }),
      opened, { channelId: 'general' }, {} as any,
    );
    const rootMsg = opened.json().message as ChannelMessage;
    await settle();

    const reply = mkRes();
    await handlePostMessage(manager, root)(
      mkReq('POST', '/api/team/channels/general/messages', {
        text: 'yes, after the review',
        threadId: rootMsg.id,
      }),
      reply, { channelId: 'general' }, {} as any,
    );
    await settle();

    expect(runs).toHaveLength(0);
    expect(manager.runHeadlessThreaded).not.toHaveBeenCalled();
  });

  it('a channel-level post still needs the mention', async () => {
    // Threads are the scope that makes implicit addressing safe — you opt in by
    // opening one. A channel where every message invoked THING is unusable.
    const { manager, runs } = mkManager('42');
    const asked = mkRes();
    await handlePostMessage(manager, root)(
      mkReq('POST', '/api/team/channels/general/messages', { text: '@thing hello' }),
      asked, { channelId: 'general' }, {} as any,
    );
    await settle();
    expect(runs).toHaveLength(1);

    const bare = mkRes();
    await handlePostMessage(manager, root)(
      mkReq('POST', '/api/team/channels/general/messages', { text: 'unrelated chatter' }),
      bare, { channelId: 'general' }, {} as any,
    );
    await settle();
    expect(runs).toHaveLength(1);
  });

  it('an ask() becomes a question in the thread, and a reply ANSWERS it', async () => {
    // Parity with /chat: there, a client renders the form and posts the value
    // back. A channel has no such client, so the question is a message and the
    // next reply is the answer — which is why the turn must stay suspended
    // rather than being restarted by that reply.
    let asked: Promise<unknown> | undefined;
    const manager = {
      runHeadlessThreaded: vi.fn(async (opts: any) => {
        // The agent asks, and does not settle until somebody answers.
        asked = opts.renderHost.ask('ask-1', { type: 'Paragraph', props: {}, children: ['Which project?'] });
        const answer = await asked;
        return { ok: true, displays: [`building in ${answer}`], result: `building in ${answer}`, sessionId: 's1' };
      }),
    } as any;

    const opened = mkRes();
    await handlePostMessage(manager, root)(
      mkReq('POST', '/api/team/channels/general/messages', { text: '@thing build me an app' }),
      opened, { channelId: 'general' }, {} as any,
    );
    const rootMsg = opened.json().message as ChannelMessage;
    // NOT `settle()` — the turn is deliberately parked on the question, so the
    // drain would wait for a human. Wait for the question to land instead.
    //
    // Wait for the MESSAGE, not for `hasPendingAsk`. The two are not the same
    // moment: the `ask_start` handler registers the pending ask synchronously and
    // then appends the question on an un-awaited `track(postAsk(…))`. Polling the
    // registry therefore returns as soon as the ask exists, which can be strictly
    // before the message this test goes on to assert has been written — a race
    // that only opens under enough load to deschedule the append, which is why it
    // showed up in a full parallel run and never in isolation.
    let afterAsk: ChannelMessage[] = [];
    for (let i = 0; i < 400; i++) {
      afterAsk = (await readMessages(root, 'general')).messages;
      if (afterAsk.length >= 2) break;
      await new Promise((r) => setTimeout(r, 5));
    }

    // The question is IN the thread, as a message, under the ask.
    expect(afterAsk.map((m) => m.kind)).toEqual(['user', 'thing']);
    expect(afterAsk[1]!.text).toContain('Which project?');
    expect(afterAsk[1]!.threadId).toBe(rootMsg.id);
    expect(hasPendingAsk('general', rootMsg.id)).toBe(true);
    // Still exactly one turn: the ask did not settle it.
    expect(manager.runHeadlessThreaded).toHaveBeenCalledTimes(1);

    // Somebody replies. That is the ANSWER, not a new question.
    const reply = mkRes();
    await handlePostMessage(manager, root)(
      mkReq('POST', '/api/team/channels/general/messages', {
        text: 'the coworking one',
        threadId: rootMsg.id,
      }),
      reply, { channelId: 'general' }, {} as any,
    );
    await settle();

    expect(manager.runHeadlessThreaded).toHaveBeenCalledTimes(1);
    expect(hasPendingAsk('general', rootMsg.id)).toBe(false);
    const final = (await readMessages(root, 'general')).messages;
    expect(final[final.length - 1]!.text).toBe('building in the coworking one');
  });

  it('once the turn is over, the next reply starts a NEW turn', async () => {
    // The registry has to be cleared when the run ends, or the message after an
    // answered question would be swallowed as an answer to nothing.
    const { manager, runs } = mkManager('42');
    const opened = mkRes();
    await handlePostMessage(manager, root)(
      mkReq('POST', '/api/team/channels/general/messages', { text: '@thing hi' }),
      opened, { channelId: 'general' }, {} as any,
    );
    const rootMsg = opened.json().message as ChannelMessage;
    await settle();
    expect(hasPendingAsk('general', rootMsg.id)).toBe(false);

    const reply = mkRes();
    await handlePostMessage(manager, root)(
      mkReq('POST', '/api/team/channels/general/messages', { text: 'and again', threadId: rootMsg.id }),
      reply, { channelId: 'general' }, {} as any,
    );
    await settle();
    expect(runs).toHaveLength(2);
  });

  it('live activity reaches the thread while the turn runs', async () => {
    // A build runs for minutes; with nothing on screen a reader cannot tell it
    // apart from a hang.
    const manager = {
      runHeadlessThreaded: vi.fn(async (opts: any) => {
        opts.onActivity?.('Checking project context');
        opts.onActivity?.('Writing the schema');
        return { ok: true, displays: ['done'], result: 'done', sessionId: 's1' };
      }),
    } as any;

    const sentEvents = watchEvents();
    const res = mkRes();
    await handlePostMessage(manager, root)(
      mkReq('POST', '/api/team/channels/general/messages', { text: '@thing go' }),
      res, { channelId: 'general' }, {} as any,
    );
    await settle();

    const labels = sentEvents
      .filter((e: any) => e.type === 'thing_status' && e.activity)
      .map((e: any) => e.activity);
    expect(labels).toEqual(['Checking project context', 'Writing the schema']);
  });

  it('answers immediately, without waiting for the agent turn', async () => {
    // A slow turn must not block the composer.
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => (release = r));
    const manager = {
      runHeadlessThreaded: vi.fn(async () => {
        await gate;
        return { ok: true, result: 'late', sessionId: 's1' };
      }),
    } as any;

    const res = mkRes();
    await handlePostMessage(manager, root)(
      mkReq('POST', '/api/team/channels/general/messages', { text: '@thing slow' }),
      res, { channelId: 'general' }, {} as any,
    );
    // Responded already, while the turn is still pending.
    expect(res.statusCode).toBe(201);
    release();
    await settle();
    const { messages } = await readMessages(root, 'general');
    expect(messages.map((m) => m.kind)).toEqual(['user', 'thing']);
  });
});

// ─── A JSX answer ────────────────────────────────────────────────────────────
//
// THING answers in JSX far more often than in prose, and the channel log is the
// only record of what it said. The reply used to be `JSON.stringify(result)`,
// so every component answer reached the reader as a wall of braces — and, worse,
// was STORED that way, so no client fix could ever recover it.

/** A SessionManager stub whose turn answers with `display()` descriptors. */
function mkJsxManager(displays: unknown[], result?: unknown) {
  return {
    runHeadlessThreaded: vi.fn(async (opts: any) => ({
      ok: true,
      displays,
      result: result ?? displays[displays.length - 1],
      sessionId: opts.sessionId,
    })),
  } as any;
}

async function askThing(manager: unknown, text = '@thing report'): Promise<ChannelMessage> {
  const res = mkRes();
  await handlePostMessage(manager as any, root)(
    mkReq('POST', '/api/team/channels/general/messages', { text }),
    res, { channelId: 'general' }, {} as any,
  );
  await settle();
  const { messages } = await readMessages(root, 'general');
  return messages[messages.length - 1]!;
}

describe('THING answering with JSX', () => {
  const card = {
    type: 'Card',
    props: { title: 'Totals' },
    children: [{ type: 'KeyValue', props: { pairs: { Open: 3 } }, children: [] }],
  };

  it('stores the descriptor as blocks, not as its own JSON', async () => {
    const reply = await askThing(mkJsxManager([card]));
    expect(reply.blocks).toEqual([card]);
    // The regression: the answer must never reach the log as its source.
    expect(reply.text).not.toContain('"type"');
    expect(reply.text).not.toContain('{');
  });

  it('keeps a readable plain-text fallback for clients that cannot draw components', async () => {
    const reply = await askThing(mkJsxManager([card]));
    expect(reply.text).toContain('Totals');
    expect(reply.text).toContain('Open: 3');
  });

  it('keeps every display of the turn, not just the last', async () => {
    const heading = { type: 'Heading', props: {}, children: ['Weekly'] };
    const reply = await askThing(mkJsxManager([heading, card]));
    expect(reply.blocks).toEqual([heading, card]);
    expect(reply.text).toContain('Weekly');
    expect(reply.text).toContain('Totals');
  });

  it('drops a component nobody ships but keeps what it wrapped', async () => {
    const sneaky = {
      type: 'iframe',
      props: { src: 'http://evil' },
      children: [{ type: 'Paragraph', props: {}, children: ['the actual answer'] }],
    };
    const reply = await askThing(mkJsxManager([sneaky]));
    expect(reply.blocks).toEqual([{ type: 'Paragraph', props: {}, children: ['the actual answer'] }]);
    expect(reply.text).toBe('the actual answer');
  });

  it('recovers a descriptor that reached it already serialized', async () => {
    // An older writer, or a resumed snapshot, hands back the JSON string. It is
    // still a descriptor and must not be posted as prose.
    const reply = await askThing(mkJsxManager([JSON.stringify(card)]));
    expect(reply.blocks).toEqual([card]);
    expect(reply.text).toContain('Totals');
  });

  it('leaves a prose answer exactly as it was — no blocks, no reformatting', async () => {
    const reply = await askThing(mkJsxManager(['The answer is 42.']));
    expect(reply.blocks).toBeUndefined();
    expect(reply.text).toBe('The answer is 42.');
  });

  it('still falls back to JSON for data that is not a descriptor at all', async () => {
    const reply = await askThing(mkJsxManager([{ total: 42 }]));
    expect(reply.blocks).toBeUndefined();
    expect(reply.text).toBe('{"total":42}');
  });

  it('reads `result` when the manager reported no displays', async () => {
    // Older callers (and a turn whose answer came from history) set only `result`.
    const manager = {
      runHeadlessThreaded: vi.fn(async (opts: any) => ({ ok: true, result: card, sessionId: opts.sessionId })),
    } as any;
    const reply = await askThing(manager);
    expect(reply.blocks).toEqual([card]);
  });

  it('survives a round trip through the append-only log', async () => {
    await askThing(mkJsxManager([card]));
    const { messages } = await readMessages(root, 'general');
    expect(messages[messages.length - 1]!.blocks).toEqual([card]);
  });
});

// ─── Ordering and idempotency ────────────────────────────────────────────────
//
// A channel is a log every member and every device has to read the same way, and
// a composer that retries a timed-out send must not double-post. Neither was
// expressible: the only time field was an ISO string stamped just before an
// UNSERIALIZED append, reads returned raw file order with no tie-break, and the
// server minted a fresh id per call so nothing could tell a retry from a second
// send.

describe('message ordering', () => {
  const range = (n: number) => Array.from({ length: n }, (_, i) => i);

  it('gives every message a position, even when a burst is written at once', async () => {
    // Several members changing one thing at the same time is the ordinary case
    // this has to survive, not the pathological one.
    const written = await Promise.all(
      range(24).map((i) =>
        appendMessage(root, { channelId: 'general', kind: 'user', text: `m${i}`, userId: 'u1' }),
      ),
    );
    const seqs = written.map((m) => m.seq);
    expect(new Set(seqs).size, 'every message needs its own position').toBe(24);
    expect([...seqs].sort((a, b) => (a ?? 0) - (b ?? 0))).toEqual(range(24));

    // The file agrees with it, so a reader that never sorts still gets it right.
    const log = join(teamDir(root), 'channels', 'general.jsonl');
    const onDisk = (await readFile(log, 'utf8'))
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line).seq);
    expect(onDisk).toEqual(range(24));

    const { messages } = await readMessages(root, 'general', { limit: 200 });
    expect(messages.map((m) => m.seq)).toEqual(range(24));
  });

  it('continues the numbering of a log it did not write', async () => {
    // A channel that existed before positions did must not restart at 0 and
    // collide with its own history.
    const log = join(teamDir(root), 'channels', 'general.jsonl');
    await mkdir(dirname(log), { recursive: true });
    const legacy = [
      { id: 'old-1', ts: '2026-01-01T00:00:01.000Z', channelId: 'general', kind: 'user', text: 'one' },
      { id: 'old-2', ts: '2026-01-01T00:00:02.000Z', channelId: 'general', kind: 'user', text: 'two' },
    ];
    await writeFile(log, legacy.map((r) => JSON.stringify(r)).join('\n') + '\n', 'utf8');

    const next = await appendMessage(root, { channelId: 'general', kind: 'user', text: 'three' });
    expect(next.seq).toBe(2);
  });

  it('reads a log back in message order even when its lines are not', async () => {
    // Two appends that interleaved before they were serialized. File order is
    // then a lie, and `ts` alone cannot always break the tie either.
    const log = join(teamDir(root), 'channels', 'general.jsonl');
    await mkdir(dirname(log), { recursive: true });
    const rows = [
      { id: 'b', ts: '2026-01-01T00:00:00.000Z', seq: 1, channelId: 'general', kind: 'user', text: 'second' },
      { id: 'a', ts: '2026-01-01T00:00:00.000Z', seq: 0, channelId: 'general', kind: 'user', text: 'first' },
    ];
    await writeFile(log, rows.map((r) => JSON.stringify(r)).join('\n') + '\n', 'utf8');

    const { messages } = await readMessages(root, 'general');
    expect(messages.map((m) => m.text)).toEqual(['first', 'second']);
  });

  it('leaves a log with no positions in exactly the order it has', async () => {
    // Nothing may be re-ordered on the strength of a guess: same timestamp, no
    // seq, so file order is the only order there is.
    const log = join(teamDir(root), 'channels', 'general.jsonl');
    await mkdir(dirname(log), { recursive: true });
    const rows = ['c', 'a', 'b'].map((id) => ({
      id, ts: '2026-01-01T00:00:00.000Z', channelId: 'general', kind: 'user', text: id,
    }));
    await writeFile(log, rows.map((r) => JSON.stringify(r)).join('\n') + '\n', 'utf8');

    const { messages } = await readMessages(root, 'general');
    expect(messages.map((m) => m.id)).toEqual(['c', 'a', 'b']);
  });

  it('never lets a stamped time run backwards within a channel', async () => {
    // `seq` is the ordering key, but a transcript whose visible clock goes
    // backwards reads as broken.
    const first = await appendMessage(root, {
      channelId: 'general', kind: 'user', text: 'from the future',
      ts: new Date(Date.now() + 60_000).toISOString(),
    });
    const second = await appendMessage(root, { channelId: 'general', kind: 'user', text: 'now' });
    expect(second.ts >= first.ts).toBe(true);
  });
});

describe('a retried send', () => {
  it('stores one message, and announces it once', async () => {
    const { manager } = mkManager();
    const body = { text: 'said this once', clientId: 'composer-draft-7' };

    const first = mkRes();
    await handlePostMessage(manager, root)(
      mkReq('POST', '/api/team/channels/general/messages', body),
      first, { channelId: 'general' }, {} as any,
    );
    expect(first.statusCode).toBe(201);

    // Watch from HERE, so anything the retry broadcasts is visible on its own.
    const seen = watchEvents();
    const retry = mkRes();
    await handlePostMessage(manager, root)(
      mkReq('POST', '/api/team/channels/general/messages', body),
      retry, { channelId: 'general' }, {} as any,
    );
    await settle();

    expect(retry.statusCode).toBe(200);
    expect(retry.json().deduplicated).toBe(true);
    expect(retry.json().message.id).toBe(first.json().message.id);
    expect((await readMessages(root, 'general')).messages).toHaveLength(1);
    expect(
      seen.filter((e: any) => e.type === 'message'),
      'a retry must not put a second copy in every open transcript',
    ).toHaveLength(0);
  });

  it('is only a retry when the client says it is the same send', async () => {
    const { manager } = mkManager();
    for (const clientId of ['a', 'b']) {
      await handlePostMessage(manager, root)(
        mkReq('POST', '/api/team/channels/general/messages', { text: 'twice', clientId }),
        mkRes(), { channelId: 'general' }, {} as any,
      );
    }
    await settle();
    expect((await readMessages(root, 'general')).messages).toHaveLength(2);
  });
});

// ─── A parked question ───────────────────────────────────────────────────────
//
// `ask()` parks the turn on a human. The row it wrote was an ordinary `thing`
// message, the last frame a client had seen said `running`, and ANY next reply
// in the thread was submitted as the answer with nothing admitting it. So a
// client could not tell a question from an answer even in principle, the busy
// indicator said "working" while the agent was blocked, and "brb" could become
// the answer to "which project?".

describe('THING asking the thread a question', () => {
  /** Post `@thing …`, and return once the parked question is in the log. */
  async function parkOnQuestion(manager: unknown): Promise<{
    rootMsg: ChannelMessage;
    question: ChannelMessage;
  }> {
    const opened = mkRes();
    await handlePostMessage(manager as any, root)(
      mkReq('POST', '/api/team/channels/general/messages', { text: '@thing build me an app' }),
      opened, { channelId: 'general' }, {} as any,
    );
    const rootMsg = opened.json().message as ChannelMessage;
    // NOT settle() — the turn is parked on a human by design. Wait for the
    // MESSAGE rather than for the registry: the ask registers synchronously and
    // the question is appended on an un-awaited task after it.
    let messages: ChannelMessage[] = [];
    for (let i = 0; i < 400; i++) {
      messages = (await readMessages(root, 'general')).messages;
      if (messages.length >= 2) break;
      await new Promise((r) => setTimeout(r, 5));
    }
    return { rootMsg, question: messages[1]! };
  }

  /** A turn that asks once and answers with whatever it is told. */
  function mkAskingManager(askId = 'ask-1') {
    return {
      runHeadlessThreaded: vi.fn(async (opts: any) => {
        const answer = await opts.renderHost.ask(askId, {
          type: 'Paragraph', props: {}, children: ['Which project?'],
        });
        return { ok: true, displays: [`building in ${answer}`], result: '', sessionId: 's1' };
      }),
    } as any;
  }

  const replyIn = async (manager: unknown, threadId: string, body: Record<string, unknown>) => {
    const res = mkRes();
    await handlePostMessage(manager as any, root)(
      mkReq('POST', '/api/team/channels/general/messages', { threadId, ...body }),
      res, { channelId: 'general' }, {} as any,
    );
    return res;
  };

  it('marks the question AS a question, with an identity and a deadline', async () => {
    const seen = watchEvents();
    const manager = mkAskingManager();
    const { rootMsg, question } = await parkOnQuestion(manager);

    expect(question.ask?.id, 'a client cannot branch on a row that says nothing').toBe('ask-1');
    expect(Date.parse(question.ask!.expiresAt)).toBeGreaterThan(Date.now());
    expect(question.threadId).toBe(rootMsg.id);

    const waiting = seen.filter((e: any) => e.type === 'thing_status' && e.status === 'waiting');
    expect(waiting, 'the busy indicator was still saying it was working').toHaveLength(1);
    expect(waiting[0].askId).toBe('ask-1');
    expect(waiting[0].threadId).toBe(rootMsg.id);

    // And it goes back to `running` when the question is answered, or a client
    // that dimmed the thread stays dimmed for the rest of the turn.
    await replyIn(manager, rootMsg.id, { text: 'the coworking one' });
    await settle();
    const statuses = seen
      .filter((e: any) => e.type === 'thing_status')
      .map((e: any) => e.status);
    expect(statuses).toEqual(['running', 'waiting', 'running', 'done']);
  });

  it('refuses a reply that names a question the thread is not waiting on', async () => {
    // A client with a stale picture of the thread must not have its words
    // submitted to whatever question happens to be open instead.
    const manager = mkAskingManager();
    const { rootMsg } = await parkOnQuestion(manager);

    const res = await replyIn(manager, rootMsg.id, {
      text: 'the coworking one',
      answersAskId: 'ask-that-closed',
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().pendingAskId).toBe('ask-1');
    expect(hasPendingAsk('general', rootMsg.id), 'the question is still open').toBe(true);
    expect((await readMessages(root, 'general')).messages).toHaveLength(2);

    await replyIn(manager, rootMsg.id, { text: 'the coworking one', answersAskId: 'ask-1' });
    await settle();
  });

  it('says so when an ordinary reply was taken as the answer', async () => {
    const manager = mkAskingManager();
    const { rootMsg } = await parkOnQuestion(manager);
    await replyIn(manager, rootMsg.id, { text: 'brb' });
    await settle();

    const messages = (await readMessages(root, 'general')).messages;
    const receipt = messages.find((m) => m.kind === 'system' && m.answersAsk === 'ask-1');
    expect(receipt, 'the fallback has to admit it happened').toBeTruthy();
    expect(receipt!.text).toContain('brb');
    expect(receipt!.threadId).toBe(rootMsg.id);
    // The receipt explains the answer, so it must come before it.
    expect(messages.indexOf(receipt!)).toBeLessThan(messages.length - 1);
    expect(messages[messages.length - 1]!.text).toBe('building in brb');
  });

  it('stamps the reply that answered a question with which question it answered', async () => {
    const manager = mkAskingManager();
    const { rootMsg } = await parkOnQuestion(manager);
    const res = await replyIn(manager, rootMsg.id, { text: 'the coworking one' });
    await settle();
    expect(res.json().message.answersAsk).toBe('ask-1');
  });

  it('does not lecture a client that named the question it was answering', async () => {
    const manager = mkAskingManager();
    const { rootMsg } = await parkOnQuestion(manager);
    const res = await replyIn(manager, rootMsg.id, {
      text: 'the coworking one',
      answersAskId: 'ask-1',
    });
    await settle();

    expect(res.statusCode).toBe(201);
    expect(res.json().message.answersAsk).toBe('ask-1');
    const messages = (await readMessages(root, 'general')).messages;
    expect(
      messages.filter((m) => m.kind === 'system'),
      'it already knew — telling it is noise',
    ).toHaveLength(0);
    expect(messages[messages.length - 1]!.text).toBe('building in the coworking one');
  });

  it('stops holding the thread for a question nobody answers', async () => {
    // An open ask holds the thread's session lock, so every later message in it
    // queues behind a question nobody is going to answer. The TURN is not killed
    // — it resumes, is told nobody answered, and finishes normally.
    process.env['LMTHING_TEAM_ASK_TIMEOUT_MS'] = '25';
    try {
      const manager = mkAskingManager();
      const { rootMsg } = await parkOnQuestion(manager);
      expect(hasPendingAsk('general', rootMsg.id)).toBe(true);

      let messages: ChannelMessage[] = [];
      for (let i = 0; i < 400; i++) {
        messages = (await readMessages(root, 'general')).messages;
        if (messages.some((m) => m.kind === 'system' && m.answersAsk === 'ask-1')) break;
        await new Promise((r) => setTimeout(r, 5));
      }
      const note = messages.find((m) => m.kind === 'system' && m.answersAsk === 'ask-1');
      expect(note, 'the thread has to say why it stopped waiting').toBeTruthy();
      expect(note!.text).toContain('Nobody answered');
      expect(hasPendingAsk('general', rootMsg.id)).toBe(false);

      await settle();
      // The turn carried on rather than being cancelled.
      const final = (await readMessages(root, 'general')).messages;
      expect(final[final.length - 1]!.text).toContain('building in');
    } finally {
      delete process.env['LMTHING_TEAM_ASK_TIMEOUT_MS'];
    }
  });
});

// ─── Joining a channel while a turn is running ───────────────────────────────

describe('a member who arrives mid-turn', () => {
  it('is told a turn is running, and what it is doing', async () => {
    // `thing_status` is a socket frame and nothing else, so a member who opens
    // the channel a minute into a seventeen-minute build received none of them
    // and saw a thread that looked finished and empty.
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => (release = r));
    const manager = {
      runHeadlessThreaded: vi.fn(async (opts: any) => {
        opts.onActivity?.('writing the schema');
        await gate;
        return { ok: true, displays: ['done'], result: '', sessionId: 's1' };
      }),
    } as any;

    const opened = mkRes();
    await handlePostMessage(manager, root)(
      mkReq('POST', '/api/team/channels/general/messages', { text: '@thing build me an app' }),
      opened, { channelId: 'general' }, {} as any,
    );
    const rootMsg = opened.json().message as ChannelMessage;

    let body: any;
    for (let i = 0; i < 400; i++) {
      const res = mkRes();
      await handleListMessages(root)(
        mkReq('GET', '/api/team/channels/general/messages'),
        res, { channelId: 'general' }, {} as any,
      );
      body = res.json();
      if (body.turns?.[0]?.activity) break;
      await new Promise((r) => setTimeout(r, 5));
    }

    expect(body.turns).toHaveLength(1);
    expect(body.turns[0]).toMatchObject({
      channelId: 'general',
      threadId: rootMsg.id,
      status: 'running',
      activity: 'writing the schema',
    });
    expect(Date.parse(body.turns[0].startedAt)).toBeLessThanOrEqual(Date.now());

    release();
    await settle();

    const after = mkRes();
    await handleListMessages(root)(
      mkReq('GET', '/api/team/channels/general/messages'),
      after, { channelId: 'general' }, {} as any,
    );
    expect(after.json().turns, 'a finished turn is not a running one').toEqual([]);
    expect(runningTurns('general')).toEqual([]);
  });

  it('can time the turn, because the frames say when it started', async () => {
    const seen = watchEvents();
    const { manager } = mkManager('42');
    await handlePostMessage(manager, root)(
      mkReq('POST', '/api/team/channels/general/messages', { text: '@thing go' }),
      mkRes(), { channelId: 'general' }, {} as any,
    );
    await settle();

    const running = seen.find((e: any) => e.type === 'thing_status' && e.status === 'running');
    expect(running.startedAt, 'a client could only time from the frame it happened to get').toBeTruthy();
    expect(Date.parse(running.startedAt)).toBeLessThanOrEqual(Date.now());
  });
});

describe('THING answering with JSX — content that survives an unwrap', () => {
  it('keeps a stray string as a Paragraph so blocks stay a list of components', async () => {
    // Unwrapping an unrecognised component can leave a bare string where a node
    // was; a channel client renders blocks inside a container, and a bare string
    // in a container is nothing at all on React Native.
    const reply = await askThing(
      mkJsxManager([{ type: 'Marquee', props: {}, children: ['just some words'] }]),
    );
    expect(reply.blocks).toEqual([{ type: 'Paragraph', props: {}, children: ['just some words'] }]);
    expect(reply.text).toBe('just some words');
  });
});
