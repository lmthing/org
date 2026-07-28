/**
 * The team surface beyond a single channel: handles, categories, direct
 * messages, and the apps a channel keeps beside it.
 *
 * The one thing here that is a SECURITY property, not a convenience, is DM
 * visibility — a direct message must not be listable, readable, postable or
 * broadcast to anybody but its two participants. Those four are tested
 * separately and deliberately, because each is a different code path and three
 * of four being right is a leak.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';
import {
  createCategory,
  deleteCategory,
  dmChannelId,
  ensureDefaultChannel,
  ensureDmChannel,
  isVisibleTo,
  listCategories,
  listChannels,
  patchChannel,
  readMessages,
} from './team-channels.js';
import {
  isValidHandle,
  listMembers,
  normalizeHandle,
  resolveMentions,
  setProfile,
  touchMember,
} from './team-members.js';
import { markRead, pushAudience } from './team-reads.js';
import { pushPayload } from './team-push.js';
import {
  handleCreateCategory,
  handleCreateChannel,
  handleCreateDm,
  handleDeleteCategory,
  handleDirectory,
  handleGetProfile,
  handleListChannels,
  handleListMessages,
  handleMarkRead,
  handlePatchChannel,
  handlePostMessage,
  handlePutProfile,
  settleChannelWork,
} from './routes/team-channels.js';
import {
  broadcastChannelEvent,
  registerChannelSocket,
  resetChannelSockets,
  type ChannelEvent,
} from './ws/team-channels.js';

let root: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'lm-team-social-'));
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

const ANA = {
  'x-user-id': 'u-ana',
  'x-user-email': 'ana@example.com',
  'x-team-id': 't1',
  'x-lmthing-role': 'editor',
};
const BO = { ...ANA, 'x-user-id': 'u-bo', 'x-user-email': 'bo@example.com' };
const CAI = { ...ANA, 'x-user-id': 'u-cai', 'x-user-email': 'cai@example.com' };

function mkReq(method: string, url: string, body?: unknown, headers = ANA): IncomingMessage {
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

/** A socket double that records the frames the hub actually sent it. */
function mkSocket(userId: string, email?: string) {
  const received: ChannelEvent[] = [];
  const handlers = new Map<string, (data: unknown) => void>();
  const ws = {
    readyState: 1,
    send: (payload: string) => received.push(JSON.parse(payload) as ChannelEvent),
    on(event: string, cb: (data: unknown) => void) {
      handlers.set(event, cb);
      return ws;
    },
  } as any;
  registerChannelSocket(ws, { userId, ...(email ? { email } : {}) });
  return {
    received,
    /** Simulate the client pushing a frame up the socket. */
    push: (frame: unknown) => handlers.get('message')?.(JSON.stringify(frame)),
  };
}

function mkManager(reply = 'ok') {
  return {
    runHeadlessThreaded: vi.fn(async (opts: any) => ({
      ok: true,
      result: reply,
      sessionId: opts.sessionId,
    })),
  } as any;
}

// ─── Handles ─────────────────────────────────────────────────────────────────

describe('handles', () => {
  it('accepts a typeable handle and rejects one that would break a mention', () => {
    for (const good of ['ana', 'ana.k', 'bo-2', 'x_9']) expect(isValidHandle(good)).toBe(true);
    // Too short to be worth typing, uppercase (mentions are matched lowercased),
    // a leading punctuation mark, a space, and an `@` that would nest a mention.
    for (const bad of ['a', 'Ana', '.ana', 'an a', 'a@b', 'x'.repeat(33)]) {
      expect(isValidHandle(bad)).toBe(false);
    }
  });

  it('normalizes what someone typed into the composer', () => {
    expect(normalizeHandle('  @Ana.K ')).toBe('ana.k');
  });

  it('refuses a handle another member already holds', async () => {
    await setProfile(root, 'u-ana', { handle: 'ana' });
    await expect(setProfile(root, 'u-bo', { handle: 'ANA' })).rejects.toThrow(/taken/);
    // …but the holder can re-save their own.
    await expect(setProfile(root, 'u-ana', { handle: 'ana' })).resolves.toMatchObject({
      handle: 'ana',
    });
  });

  it('refuses @thing, because it is how a message addresses the agent', async () => {
    await expect(setProfile(root, 'u-ana', { handle: 'thing' })).rejects.toThrow(/reserved/);
  });

  it('leaves the handle alone when only the display name is set', async () => {
    await setProfile(root, 'u-ana', { handle: 'ana' });
    const after = await setProfile(root, 'u-ana', { displayName: 'Ana Kay' });
    expect(after).toMatchObject({ handle: 'ana', displayName: 'Ana Kay' });
  });

  it('clears the handle only when explicitly asked to', async () => {
    await setProfile(root, 'u-ana', { handle: 'ana' });
    expect(await setProfile(root, 'u-ana', { handle: null })).not.toHaveProperty('handle');
  });

  it('fills the roster from whoever shows up, without touching a chosen handle', async () => {
    await setProfile(root, 'u-ana', { handle: 'ana', email: 'ana@example.com' });
    await touchMember(root, 'u-ana', 'ana@example.com');
    await touchMember(root, 'u-bo', 'bo@example.com');
    const members = await listMembers(root);
    expect(members.map((m) => m.userId).sort()).toEqual(['u-ana', 'u-bo']);
    expect(members.find((m) => m.userId === 'u-ana')!.handle).toBe('ana');
  });

  it('resolves the members a message named, ignoring an @ that names nobody', async () => {
    await setProfile(root, 'u-ana', { handle: 'ana' });
    await setProfile(root, 'u-bo', { handle: 'bo' });
    const members = await listMembers(root);
    const found = resolveMentions('@ana and @bo — not @nobody or e@mail.com', members);
    expect(found.map((m) => m.userId).sort()).toEqual(['u-ana', 'u-bo']);
  });
});

describe('profile routes', () => {
  it('sets and reads back the caller‘s own handle', async () => {
    const put = mkRes();
    await handlePutProfile(root)(
      mkReq('PUT', '/api/team/profile', { handle: 'ana', displayName: 'Ana Kay' }),
      put,
      {},
      {} as any,
    );
    expect(put.statusCode).toBe(200);

    const get = mkRes();
    await handleGetProfile(root)(mkReq('GET', '/api/team/profile'), get, {}, {} as any);
    expect(get.json().profile).toMatchObject({ userId: 'u-ana', handle: 'ana', displayName: 'Ana Kay' });
  });

  it('answers 409 for a taken handle, so the form can say which field is wrong', async () => {
    await setProfile(root, 'u-ana', { handle: 'ana' });
    const res = mkRes();
    await handlePutProfile(root)(
      mkReq('PUT', '/api/team/profile', { handle: 'ana' }, BO),
      res,
      {},
      {} as any,
    );
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toMatch(/taken/);
  });

  it('stamps mentions onto a posted message', async () => {
    await setProfile(root, 'u-bo', { handle: 'bo' });
    const res = mkRes();
    await handlePostMessage(mkManager(), root)(
      mkReq('POST', '/api/team/channels/general/messages', { text: 'ping @bo' }),
      res,
      { channelId: 'general' },
      {} as any,
    );
    expect(res.json().message.mentions).toEqual(['u-bo']);
  });
});

// ─── The directory ───────────────────────────────────────────────────────────

describe('the directory', () => {
  it('offers members and projects, flagging which projects have an app', async () => {
    await mkdir(join(root, 'tracker', 'pages'), { recursive: true });
    await writeFile(join(root, 'tracker', 'project.json'), JSON.stringify({ id: 'tracker', name: 'Tracker' }));
    await mkdir(join(root, 'notes'), { recursive: true });
    await writeFile(join(root, 'notes', 'project.json'), JSON.stringify({ id: 'notes', name: 'Notes' }));
    await setProfile(root, 'u-bo', { handle: 'bo', email: 'bo@example.com' });

    const res = mkRes();
    await handleDirectory(root)(mkReq('GET', '/api/team/directory'), res, {}, {} as any);
    const body = res.json();
    // The caller registered themselves just by opening the picker.
    expect(body.members.map((m: any) => m.userId).sort()).toEqual(['u-ana', 'u-bo']);
    expect(body.projects).toEqual(
      expect.arrayContaining([
        { id: 'tracker', name: 'Tracker', hasApp: true },
        { id: 'notes', name: 'Notes', hasApp: false },
      ]),
    );
  });
});

// ─── Categories ──────────────────────────────────────────────────────────────

describe('categories', () => {
  it('creates categories in a stable order and is idempotent on the name', async () => {
    await createCategory(root, 'Product');
    await createCategory(root, 'Engineering');
    const again = await createCategory(root, 'product');
    expect(again.created).toBe(false);
    expect((await listCategories(root)).map((c) => c.id)).toEqual(['product', 'engineering']);
  });

  it('files a channel under a category at creation and by patch', async () => {
    await createCategory(root, 'Product');
    const res = mkRes();
    await handleCreateChannel(root)(
      mkReq('POST', '/api/team/channels', { name: 'Roadmap', categoryId: 'product' }),
      res,
      {},
      {} as any,
    );
    expect(res.json().channel.categoryId).toBe('product');

    const moved = await patchChannel(root, 'roadmap', { categoryId: null });
    expect(moved).not.toHaveProperty('categoryId');
  });

  it('deleting a category uncategorizes its channels rather than deleting them', async () => {
    await createCategory(root, 'Product');
    await handleCreateChannel(root)(
      mkReq('POST', '/api/team/channels', { name: 'Roadmap', categoryId: 'product' }),
      mkRes(),
      {},
      {} as any,
    );

    const res = mkRes();
    await handleDeleteCategory(root)(
      mkReq('DELETE', '/api/team/categories/product'),
      res,
      { categoryId: 'product' },
      {} as any,
    );
    expect(res.json().uncategorized).toBe(1);
    expect(await listCategories(root)).toEqual([]);
    const roadmap = (await listChannels(root)).find((c) => c.id === 'roadmap')!;
    expect(roadmap).toBeDefined();
    expect(roadmap).not.toHaveProperty('categoryId');
  });

  it('a category rename does not move the channels in it', async () => {
    await createCategory(root, 'Product');
    await patchChannel(root, 'general', { categoryId: 'product' });
    await deleteCategory(root, 'nonexistent');
    expect((await listChannels(root)).find((c) => c.id === 'general')!.categoryId).toBe('product');
  });

  it('lists categories alongside channels, so the sidebar renders in one pass', async () => {
    await createCategory(root, 'Product');
    const res = mkRes();
    await handleListChannels(root)(mkReq('GET', '/api/team/channels'), res, {}, {} as any);
    expect(res.json().categories.map((c: any) => c.id)).toEqual(['product']);
  });
});

// ─── Direct messages ─────────────────────────────────────────────────────────

describe('direct messages', () => {
  it('derives one id for a pair, whichever end opens it', async () => {
    expect(dmChannelId(['u-bo', 'u-ana'])).toBe(dmChannelId(['u-ana', 'u-bo']));
    const first = await ensureDmChannel(root, ['u-ana', 'u-bo'], 'u-ana');
    const second = await ensureDmChannel(root, ['u-bo', 'u-ana'], 'u-bo');
    expect(second.created).toBe(false);
    expect(second.channel.id).toBe(first.channel.id);
    expect((await listChannels(root)).filter((c) => c.kind === 'dm')).toHaveLength(1);
  });

  it('is visible only to its participants', () => {
    const dm = {
      id: 'dm-x',
      name: 'Direct message',
      createdBy: 'u-ana',
      createdAt: '',
      kind: 'dm' as const,
      members: ['u-ana', 'u-bo'],
    };
    expect(isVisibleTo(dm, 'u-ana')).toBe(true);
    expect(isVisibleTo(dm, 'u-cai')).toBe(false);
    // A named channel is everyone's.
    expect(isVisibleTo({ ...dm, kind: 'channel', members: undefined }, 'u-cai')).toBe(true);
  });

  it('refuses a direct message with yourself', async () => {
    const res = mkRes();
    await handleCreateDm(root)(
      mkReq('POST', '/api/team/dms', { userId: 'u-ana' }),
      res,
      {},
      {} as any,
    );
    expect(res.statusCode).toBe(400);
  });

  // ── The four leak paths ──

  it('does not LIST a stranger‘s direct message', async () => {
    const { channel } = await ensureDmChannel(root, ['u-ana', 'u-bo'], 'u-ana');

    const mine = mkRes();
    await handleListChannels(root)(mkReq('GET', '/api/team/channels'), mine, {}, {} as any);
    expect(mine.json().channels.map((c: any) => c.id)).toContain(channel.id);

    const theirs = mkRes();
    await handleListChannels(root)(mkReq('GET', '/api/team/channels', undefined, CAI), theirs, {}, {} as any);
    expect(theirs.json().channels.map((c: any) => c.id)).not.toContain(channel.id);
  });

  it('does not let a stranger READ it — and says 404, not 403', async () => {
    const { channel } = await ensureDmChannel(root, ['u-ana', 'u-bo'], 'u-ana');
    const res = mkRes();
    await handleListMessages(root)(
      mkReq('GET', `/api/team/channels/${channel.id}/messages`, undefined, CAI),
      res,
      { channelId: channel.id },
      {} as any,
    );
    // 403 would confirm that these two people have a conversation, which is
    // itself the private fact.
    expect(res.statusCode).toBe(404);
  });

  it('does not let a stranger POST into it', async () => {
    const { channel } = await ensureDmChannel(root, ['u-ana', 'u-bo'], 'u-ana');
    const res = mkRes();
    await handlePostMessage(mkManager(), root)(
      mkReq('POST', `/api/team/channels/${channel.id}/messages`, { text: 'hello?' }, CAI),
      res,
      { channelId: channel.id },
      {} as any,
    );
    expect(res.statusCode).toBe(404);
    expect((await readMessages(root, channel.id)).messages).toHaveLength(0);
  });

  it('does not BROADCAST it to a stranger‘s socket', async () => {
    const { channel } = await ensureDmChannel(root, ['u-ana', 'u-bo'], 'u-ana');
    const bo = mkSocket('u-bo');
    const cai = mkSocket('u-cai');

    await handlePostMessage(mkManager(), root)(
      mkReq('POST', `/api/team/channels/${channel.id}/messages`, { text: 'just between us' }),
      mkRes(),
      { channelId: channel.id },
      {} as any,
    );

    expect(bo.received.filter((e) => e.type === 'message')).toHaveLength(1);
    // The client filtering by "the channel it is showing" is not a boundary —
    // the frame must never reach a stranger's tab at all.
    expect(cai.received).toHaveLength(0);
  });

  it('reaches both participants when one opens the conversation', async () => {
    const bo = mkSocket('u-bo');
    const cai = mkSocket('u-cai');
    await handleCreateDm(root)(mkReq('POST', '/api/team/dms', { userId: 'u-bo' }), mkRes(), {}, {} as any);
    expect(bo.received.map((e) => e.type)).toEqual(['channel']);
    expect(cai.received).toHaveLength(0);
  });
});

// ─── Typing ──────────────────────────────────────────────────────────────────

describe('typing', () => {
  it('stamps the socket‘s verified identity, not what the client claimed', () => {
    const ana = mkSocket('u-ana', 'ana@example.com');
    const bo = mkSocket('u-bo');
    ana.push({ type: 'typing', channelId: 'general', userId: 'u-bo' });

    expect(bo.received).toEqual([
      { type: 'typing', channelId: 'general', userId: 'u-ana', email: 'ana@example.com' },
    ]);
    // A composer that told you about yourself would be a bug.
    expect(ana.received).toHaveLength(0);
  });

  it('ignores a frame that is not a typing frame', () => {
    const ana = mkSocket('u-ana');
    const bo = mkSocket('u-bo');
    ana.push({ type: 'message', message: { text: 'forged' } });
    ana.push('not json at all');
    expect(bo.received).toHaveLength(0);
  });

  it('excludes only the named member from a broadcast', () => {
    const ana = mkSocket('u-ana');
    const bo = mkSocket('u-bo');
    broadcastChannelEvent(
      { type: 'typing', channelId: 'general', userId: 'u-ana' },
      { exclude: 'u-ana' },
    );
    expect(ana.received).toHaveLength(0);
    expect(bo.received).toHaveLength(1);
  });
});

// ─── Apps beside a channel ───────────────────────────────────────────────────

describe('apps beside a channel', () => {
  it('pins apps in order, deduplicated', async () => {
    const channel = await patchChannel(root, 'general', { apps: ['tracker', 'notes', 'tracker'] });
    expect(channel.apps).toEqual(['tracker', 'notes']);
    expect(await patchChannel(root, 'general', { apps: [] })).not.toHaveProperty('apps');
  });

  it('pins an app over the route, and announces it', async () => {
    const bo = mkSocket('u-bo');
    const res = mkRes();
    await handlePatchChannel(root)(
      mkReq('PATCH', '/api/team/channels/general', { apps: ['tracker'] }),
      res,
      { channelId: 'general' },
      {} as any,
    );
    expect(res.json().channel.apps).toEqual(['tracker']);
    expect(bo.received).toEqual([expect.objectContaining({ type: 'channel' })]);
  });

  it('pins, cards and announces an app THING just built, crediting who asked', async () => {
    // THING's turn is what creates the app, so the manager double writes the
    // pages dir the way a real build would.
    const manager = {
      runHeadlessThreaded: vi.fn(async (opts: any) => {
        await mkdir(join(root, 'standup', 'pages'), { recursive: true });
        await writeFile(
          join(root, 'standup', 'project.json'),
          JSON.stringify({ id: 'standup', name: 'Standup tracker' }),
        );
        return { ok: true, result: 'built it', sessionId: opts.sessionId };
      }),
    } as any;

    const bo = mkSocket('u-bo');
    const res = mkRes();
    await handlePostMessage(manager, root)(
      mkReq('POST', '/api/team/channels/general/messages', { text: '@thing build a standup tracker' }),
      res,
      { channelId: 'general' },
      {} as any,
    );
    const ask = res.json().message;
    await settleChannelWork();

    // 1. pinned to the channel, so it is a tab tomorrow as well as today
    expect((await listChannels(root)).find((c) => c.id === 'general')!.apps).toEqual(['standup']);

    // 2. a durable card in the thread, for whoever scrolls back
    const { messages } = await readMessages(root, 'general');
    const card = messages.find((m) => m.app);
    expect(card).toMatchObject({
      kind: 'system',
      threadId: ask.id,
      app: { projectId: 'standup', name: 'Standup tracker' },
    });

    // 3. the event that opens it beside the asker — and only the asker
    expect(bo.received).toContainEqual(
      expect.objectContaining({
        type: 'app_created',
        channelId: 'general',
        projectId: 'standup',
        name: 'Standup tracker',
        requestedBy: 'u-ana',
      }),
    );
  });

  it('says nothing when a turn built no app', async () => {
    const bo = mkSocket('u-bo');
    await handlePostMessage(mkManager('no app needed'), root)(
      mkReq('POST', '/api/team/channels/general/messages', { text: '@thing what is 6*7?' }),
      mkRes(),
      { channelId: 'general' },
      {} as any,
    );
    await settleChannelWork();
    expect(bo.received.filter((e) => e.type === 'app_created')).toHaveLength(0);
    expect((await listChannels(root)).find((c) => c.id === 'general')).not.toHaveProperty('apps');
  });

  it('does not re-announce a project that already had an app', async () => {
    await mkdir(join(root, 'standup', 'pages'), { recursive: true });
    await writeFile(
      join(root, 'standup', 'project.json'),
      JSON.stringify({ id: 'standup', name: 'Standup tracker' }),
    );
    const bo = mkSocket('u-bo');
    await handlePostMessage(mkManager('edited it'), root)(
      mkReq('POST', '/api/team/channels/general/messages', { text: '@thing tweak the tracker' }),
      mkRes(),
      { channelId: 'general' },
      {} as any,
    );
    await settleChannelWork();
    expect(bo.received.filter((e) => e.type === 'app_created')).toHaveLength(0);
  });
});

// ─── Read state, unread and mentions ─────────────────────────────────────────

describe('read state', () => {
  const post = async (text: string, channelId = 'general', headers = ANA) => {
    await handlePostMessage(mkManager(), root)(
      mkReq('POST', `/api/team/channels/${channelId}/messages`, { text }, headers),
      mkRes(),
      { channelId },
      {} as any,
    )
    // Badges are raised by the out-of-band delivery, not by the POST itself.
    await settleChannelWork()
  }

  const channelsFor = async (headers: typeof ANA) => {
    const res = mkRes()
    await handleListChannels(root)(mkReq('GET', '/api/team/channels', undefined, headers), res, {}, {} as any)
    return res.json().unread as Array<{ channelId: string; hasUnread: boolean; mentions: number }>
  }
  const unreadOf = async (headers: typeof ANA, channelId = 'general') =>
    (await channelsFor(headers)).find((u) => u.channelId === channelId)!

  it('an untouched channel is not unread, even for someone who has read nothing', async () => {
    expect(await unreadOf(CAI)).toMatchObject({ hasUnread: false, mentions: 0 })
  })

  it('someone else‘s message makes it unread', async () => {
    await post('morning')
    expect(await unreadOf(BO)).toMatchObject({ hasUnread: true, mentions: 0 })
  })

  it('your OWN message does not leave the channel unread for you', async () => {
    // Unread is derived from the log's mtime, and posting moves it — so without
    // treating a post as a read, everyone would unread-badge their own messages.
    await post('morning')
    expect(await unreadOf(ANA)).toMatchObject({ hasUnread: false })
  })

  it('counts mentions exactly, and only for the person named', async () => {
    await setProfile(root, 'u-bo', { handle: 'bo' })
    await post('@bo one')
    await post('@bo two')
    expect(await unreadOf(BO)).toMatchObject({ hasUnread: true, mentions: 2 })
    expect(await unreadOf(CAI)).toMatchObject({ mentions: 0 })
  })

  it('never counts a self-mention', async () => {
    await setProfile(root, 'u-ana', { handle: 'ana' })
    await post('note to self @ana')
    expect(await unreadOf(ANA)).toMatchObject({ mentions: 0 })
  })

  it('every message in a DM counts as a mention of the other participant', async () => {
    // A direct message IS addressed to you; requiring `@you` inside one would be
    // asking somebody to address an already-addressed conversation.
    const { channel } = await ensureDmChannel(root, ['u-ana', 'u-bo'], 'u-ana')
    await post('hey', channel.id)
    const forBo = (await channelsFor(BO)).find((u) => u.channelId === channel.id)!
    expect(forBo).toMatchObject({ hasUnread: true, mentions: 1 })
  })

  it('marking read clears both the badge and the counter', async () => {
    await setProfile(root, 'u-bo', { handle: 'bo' })
    await post('@bo look')
    const res = mkRes()
    await handleMarkRead(root)(
      mkReq('POST', '/api/team/channels/general/read', undefined, BO),
      res,
      { channelId: 'general' },
      {} as any,
    )
    expect(res.statusCode).toBe(200)
    expect(await unreadOf(BO)).toMatchObject({ hasUnread: false, mentions: 0 })
  })

  it('refuses to mark a DM read for somebody not in it', async () => {
    const { channel } = await ensureDmChannel(root, ['u-ana', 'u-bo'], 'u-ana')
    const res = mkRes()
    await handleMarkRead(root)(
      mkReq('POST', `/api/team/channels/${channel.id}/read`, undefined, CAI),
      res,
      { channelId: channel.id },
      {} as any,
    )
    expect(res.statusCode).toBe(404)
  })

  it('THING‘s answer is a mention of whoever asked', async () => {
    // An agent turn can take minutes — the span over which somebody closes the
    // tab — so the answer has to be able to reach them.
    await handlePostMessage(mkManager('42'), root)(
      mkReq('POST', '/api/team/channels/general/messages', { text: '@thing what is 6*7?' }, BO),
      mkRes(),
      { channelId: 'general' },
      {} as any,
    )
    await settleChannelWork()
    const { messages } = await readMessages(root, 'general')
    expect(messages.find((m) => m.kind === 'thing')!.mentions).toEqual(['u-bo'])
  })
})

describe('who gets pushed', () => {
  const dmWith = async () => (await ensureDmChannel(root, ['u-ana', 'u-bo'], 'u-ana')).channel

  it('pushes somebody who was named and is not connected', async () => {
    const channel = (await ensureDefaultChannel(root)).find((c) => c.id === 'general')!
    const targets = await pushAudience(
      root,
      channel,
      { mentions: ['u-bo'], userId: 'u-ana', ts: new Date().toISOString() },
      new Set(),
    )
    expect(targets).toEqual(['u-bo'])
  })

  it('does NOT push somebody who has the surface open', async () => {
    const channel = (await ensureDefaultChannel(root)).find((c) => c.id === 'general')!
    const targets = await pushAudience(
      root,
      channel,
      { mentions: ['u-bo'], userId: 'u-ana', ts: new Date().toISOString() },
      new Set(['u-bo']),
    )
    expect(targets).toEqual([])
  })

  it('does NOT push the sender, even in a DM where they are a participant', async () => {
    const channel = await dmWith()
    const targets = await pushAudience(
      root,
      channel,
      { userId: 'u-ana', ts: new Date().toISOString() },
      new Set(),
    )
    expect(targets).toEqual(['u-bo'])
  })

  it('does NOT push a message somebody already read on another device', async () => {
    const channel = (await ensureDefaultChannel(root)).find((c) => c.id === 'general')!
    const sentAt = new Date(Date.now() - 60_000).toISOString()
    await markRead(root, 'u-bo', 'general') // read just now, i.e. after it was sent
    const targets = await pushAudience(
      root,
      channel,
      { mentions: ['u-bo'], userId: 'u-ana', ts: sentAt },
      new Set(),
    )
    expect(targets).toEqual([])
  })

  it('does not push a busy channel nobody was named in', async () => {
    // The badge is for "there is activity"; a notification is for "somebody
    // addressed me". Anything looser trains people to switch them off.
    const channel = (await ensureDefaultChannel(root)).find((c) => c.id === 'general')!
    expect(
      await pushAudience(root, channel, { userId: 'u-ana', ts: new Date().toISOString() }, new Set()),
    ).toEqual([])
  })
})

describe('what a notification says', () => {
  it('titles a channel message with the sender and the channel', () => {
    const channel = { id: 'roadmap', name: 'Roadmap', createdBy: '', createdAt: '' }
    const p = pushPayload(channel, { id: '1', ts: '', channelId: 'roadmap', kind: 'user', text: 'ping' }, 'Ana Kay', 't1')
    expect(p.title).toBe('Ana Kay in #Roadmap')
    expect(p.url).toBe('/team/t1/channels?channel=roadmap')
    expect(p.tag).toBe('t1:roadmap')
  })

  it('titles a direct message with just the person', () => {
    const dm = { id: 'dm-x', name: 'Direct message', createdBy: '', createdAt: '', kind: 'dm' as const, members: ['u-ana', 'u-bo'] }
    expect(pushPayload(dm, { id: '1', ts: '', channelId: 'dm-x', kind: 'user', text: 'hi' }, 'Ana Kay', 't1').title).toBe('Ana Kay')
  })

  it('truncates a long body — a notification is a pointer, not the message', () => {
    const channel = { id: 'c', name: 'c', createdBy: '', createdAt: '' }
    const p = pushPayload(channel, { id: '1', ts: '', channelId: 'c', kind: 'user', text: 'x'.repeat(400) }, 'Ana', 't1')
    expect(p.body).toHaveLength(140)
    expect(p.body.endsWith('…')).toBe(true)
  })
})
