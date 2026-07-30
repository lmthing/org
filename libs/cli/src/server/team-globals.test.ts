/**
 * The HOST half of THING's team globals — the half that decides what an agent
 * turn may actually see and do, and the only place the CALLER's identity lives.
 *
 * Two properties are load-bearing and are each tested in BOTH directions:
 *
 *  - **Viewer escalation.** `team-guard.ts` keeps a viewer out of the mutating
 *    REST surface. If a viewer could say "THING, announce this in #general" and
 *    have it happen, the agent would be a way around the guard. So both writers
 *    refuse a viewer and both work for an editor.
 *
 *  - **DM visibility.** A direct message is visible only to its participants
 *    (`isVisibleTo`). THING answers for whoever asked, so a member must not be
 *    able to read — or post into — a DM they are not in, and MUST be able to read
 *    the one they are.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { handlePostMessage, settleChannelWork } from './routes/team-channels.js';
import {
  appendMessage,
  createChannel,
  dmChannelId,
  ensureDefaultChannel,
  ensureDmChannel,
  readMessages,
  type Channel,
  type ChannelMessage,
} from './team-channels.js';
import { setProfile, touchMember } from './team-members.js';
import { createTeamResolver } from './team-globals.js';
import type { TeamCaller } from './team-guard.js';

let root: string;

const ANA: TeamCaller = { userId: 'u-ana', email: 'ana@x.test', teamId: 't1', role: 'editor' };
const BO: TeamCaller = { userId: 'u-bo', email: 'bo@x.test', teamId: 't1', role: 'editor' };
const VIC: TeamCaller = { userId: 'u-vic', email: 'vic@x.test', teamId: 't1', role: 'viewer' };

/** The resolver for one turn, plus everything it broadcast. */
function resolverFor(caller: TeamCaller, channel: Channel, threadId?: string) {
  const posted: ChannelMessage[] = [];
  const changed: Channel[] = [];
  const team = createTeamResolver(
    root,
    { caller, channel, ...(threadId ? { threadId } : {}) },
    { onPost: (m) => posted.push(m), onChannelChanged: (c) => changed.push(c) },
  );
  return { team, posted, changed };
}

async function channelNamed(name: string): Promise<Channel> {
  const { channel } = await createChannel(root, name, 'u-ana');
  return channel;
}

let savedTeamMode: string | undefined;

beforeEach(async () => {
  savedTeamMode = process.env['LMTHING_TEAM_MODE'];
  process.env['LMTHING_TEAM_MODE'] = '1';
  root = await mkdtemp(join(tmpdir(), 'lm-team-globals-'));
  await ensureDefaultChannel(root);
  for (const c of [ANA, BO, VIC]) await touchMember(root, c.userId, c.email);
  await setProfile(root, ANA.userId, { handle: 'ana', displayName: 'Ana K' });
  await setProfile(root, BO.userId, { handle: 'bo' });
});

afterEach(async () => {
  if (savedTeamMode === undefined) delete process.env['LMTHING_TEAM_MODE'];
  else process.env['LMTHING_TEAM_MODE'] = savedTeamMode;
  await rm(root, { recursive: true, force: true });
});

describe('teamContext — who asked, where', () => {
  it('reports the CALLER, the channel and the thread', async () => {
    const general = (await ensureDefaultChannel(root))[0]!;
    const { team } = resolverFor(ANA, general, 'thr-1');
    const ctx = await team.context();
    expect(ctx).toMatchObject({
      teamId: 't1',
      channelId: 'general',
      channelKind: 'channel',
      threadId: 'thr-1',
      caller: { userId: 'u-ana', role: 'editor', handle: 'ana', displayName: 'Ana K' },
    });
  });

  it('reports a VIEWER as a viewer, so the agent can say why it refused', async () => {
    const general = (await ensureDefaultChannel(root))[0]!;
    const { team } = resolverFor(VIC, general);
    expect((await team.context()).caller.role).toBe('viewer');
  });
});

describe('teamMembers / teamChannels', () => {
  it('names members by their chosen label and flags the caller', async () => {
    const general = (await ensureDefaultChannel(root))[0]!;
    const { team } = resolverFor(BO, general);
    const members = await team.members();
    expect(members.find((m) => m.userId === 'u-ana')?.label).toBe('Ana K');
    expect(members.find((m) => m.userId === 'u-bo')?.label).toBe('@bo');
    expect(members.find((m) => m.userId === 'u-bo')?.isCaller).toBe(true);
    expect(members.find((m) => m.userId === 'u-ana')?.isCaller).toBe(false);
  });

  it('lists a DM only to the members who are IN it', async () => {
    const general = (await ensureDefaultChannel(root))[0]!;
    const { channel: dm } = await ensureDmChannel(root, [ANA.userId, BO.userId], ANA.userId);

    const ana = await resolverFor(ANA, general).team.channels();
    expect(ana.map((c) => c.id)).toContain(dm.id);

    // Vic is not a participant: the conversation is not merely unreadable, it is
    // not there at all.
    const vic = await resolverFor(VIC, general).team.channels();
    expect(vic.map((c) => c.id)).not.toContain(dm.id);
    expect(vic.map((c) => c.id)).toContain('general');
  });
});

describe('teamHistory — reading a channel back', () => {
  it('returns the log newest-last with authors resolved', async () => {
    const general = (await ensureDefaultChannel(root))[0]!;
    await appendMessage(root, { channelId: 'general', kind: 'user', text: 'we picked postgres', userId: ANA.userId, email: ANA.email });
    await appendMessage(root, { channelId: 'general', kind: 'thing', text: 'noted' });

    const { team } = resolverFor(BO, general);
    const page = await team.history('general');
    expect(page.messages.map((m) => m.text)).toEqual(['we picked postgres', 'noted']);
    expect(page.messages[0]!.author).toBe('Ana K');
    expect(page.messages[1]!.author).toBe('THING');
  });

  it('REFUSES a DM the caller is not in — and says nothing about it existing', async () => {
    const general = (await ensureDefaultChannel(root))[0]!;
    const { channel: dm } = await ensureDmChannel(root, [ANA.userId, BO.userId], ANA.userId);
    await appendMessage(root, { channelId: dm.id, kind: 'user', text: 'between us', userId: ANA.userId });

    const { team } = resolverFor(VIC, general);
    await expect(team.history(dm.id)).rejects.toThrow(`no such channel: ${dm.id}`);
    // The refusal is WORD-FOR-WORD the one an id that was never created gets, so
    // the error itself cannot be used to probe for private conversations.
    await expect(team.history(dmChannelId(['nobody-a', 'nobody-b']))).rejects.toThrow(/^no such channel: /);
  });

  it('ALLOWS the DM the caller IS in', async () => {
    const general = (await ensureDefaultChannel(root))[0]!;
    const { channel: dm } = await ensureDmChannel(root, [ANA.userId, BO.userId], ANA.userId);
    await appendMessage(root, { channelId: dm.id, kind: 'user', text: 'between us', userId: ANA.userId });

    const { team } = resolverFor(BO, general);
    expect((await team.history(dm.id)).messages.map((m) => m.text)).toEqual(['between us']);
  });

  it('refuses a channel that does not exist', async () => {
    const general = (await ensureDefaultChannel(root))[0]!;
    const { team } = resolverFor(ANA, general);
    await expect(team.history('ghost')).rejects.toThrow('no such channel: ghost');
  });

  /**
   * `readMessages` allows 200. An agent budget has to be well under that — 200
   * messages is most of a turn's context spent on a channel — and the cut has to
   * be VISIBLE, or the turn cannot say what it read.
   */
  it('caps the page well below readMessages\' own ceiling, and reports the cap', async () => {
    const general = (await ensureDefaultChannel(root))[0]!;
    for (let i = 0; i < 140; i++) {
      await appendMessage(root, { channelId: 'general', kind: 'user', text: `m${i}`, userId: ANA.userId });
    }
    const { team } = resolverFor(ANA, general);

    const asked = await team.history('general', { limit: 200 });
    expect(asked.limit).toBe(100);
    expect(asked.returned).toBe(100);
    expect(asked.messages).toHaveLength(100);
    expect(asked.hasMore).toBe(true);

    const dflt = await team.history('general');
    expect(dflt.limit).toBe(30);
    expect(dflt.returned).toBe(30);
  });

  it('names what it read, so the turn can say so', async () => {
    const general = (await ensureDefaultChannel(root))[0]!;
    const design = await channelNamed('Product Design');
    await appendMessage(root, { channelId: design.id, kind: 'user', text: 'hi', userId: ANA.userId });
    const { team } = resolverFor(ANA, general);
    const page = await team.history(design.id);
    expect(page.channelId).toBe('product-design');
    expect(page.channelName).toBe('Product Design');
    expect(page.returned).toBe(1);
  });
});

describe('teamPost — the viewer escalation gate', () => {
  it('an EDITOR can post into another channel, as THING', async () => {
    const general = (await ensureDefaultChannel(root))[0]!;
    const design = await channelNamed('design');
    const { team, posted } = resolverFor(ANA, general);

    const r = await team.post(design.id, 'the schema is agreed');
    expect(r.ok).toBe(true);
    // Two messages: the post itself, and the receipt back in this thread.
    expect(posted.map((m) => m.channelId)).toEqual(['design', 'general']);
    // Attributable: a `thing` message with NO userId — an agent post can never be
    // read as something a member said.
    expect(posted[0]!.kind).toBe('thing');
    expect(posted[0]!.userId).toBeUndefined();
  });

  it('a VIEWER cannot — the agent is not a way around the REST guard', async () => {
    const general = (await ensureDefaultChannel(root))[0]!;
    const design = await channelNamed('design');
    const { team, posted } = resolverFor(VIC, general);

    await expect(team.post(design.id, 'announce this')).rejects.toThrow(/viewer/);
    // And it must not have half-happened.
    expect(posted).toHaveLength(0);
  });

  it('a viewer keeps every READER — the split is read vs write, not agent vs no agent', async () => {
    const general = (await ensureDefaultChannel(root))[0]!;
    await appendMessage(root, { channelId: 'general', kind: 'user', text: 'hello', userId: ANA.userId });
    const { team } = resolverFor(VIC, general);
    expect((await team.members()).length).toBe(3);
    expect((await team.history('general')).messages).toHaveLength(1);
  });

  it('refuses a post into a DM the caller is not in, before the role even matters', async () => {
    const general = (await ensureDefaultChannel(root))[0]!;
    const { channel: dm } = await ensureDmChannel(root, [ANA.userId, BO.userId], ANA.userId);
    const { team, posted } = resolverFor(
      { ...VIC, role: 'editor' },
      general,
    );
    await expect(team.post(dm.id, 'butting in')).rejects.toThrow(`no such channel: ${dm.id}`);
    expect(posted).toHaveLength(0);
  });

  it('resolves @handles it writes, so the person named actually gets a badge', async () => {
    const general = (await ensureDefaultChannel(root))[0]!;
    const { team, posted } = resolverFor(ANA, general);
    await team.post('general', 'over to @bo', { threadId: 'thr-9' });
    expect(posted[0]!.mentions).toEqual(['u-bo']);
    expect(posted[0]!.threadId).toBe('thr-9');
  });

  it('refuses an empty message rather than posting a blank line', async () => {
    const general = (await ensureDefaultChannel(root))[0]!;
    const { team } = resolverFor(ANA, general);
    await expect(team.post('general', '   ')).rejects.toThrow(/needs some text/);
  });
});

describe('reaching one person — no DM writer exists', () => {
  /**
   * THING has no user id: a `thing` message carries none, and `dmChannelId`
   * hashes a set of USER ids. So there is no honest THING participant in a direct
   * message, and the surface deliberately has no `dm` method — an agent that
   * "DM'd" somebody would either be impersonating the asker or using an invented
   * identity. Reaching one person is a mention.
   */
  it('the resolver exposes no dm method at all', async () => {
    const general = (await ensureDefaultChannel(root))[0]!;
    const { team } = resolverFor(ANA, general);
    expect((team as unknown as Record<string, unknown>)['dm']).toBeUndefined();
  });

  it('an @mention in a post reaches the person through the existing badge path', async () => {
    const general = (await ensureDefaultChannel(root))[0]!;
    const { team, posted } = resolverFor(ANA, general);
    await team.post('general', '@bo the build is done');
    // The mention is what raises Bo's badge and sends the push — no new identity,
    // no new delivery path.
    expect(posted[0]!.mentions).toEqual(['u-bo']);
  });
});

describe('attribution and receipts for a write somewhere else', () => {
  it('stamps onBehalfOf so a post in another channel names whose request it was', async () => {
    const general = (await ensureDefaultChannel(root))[0]!;
    const design = await channelNamed('design');
    const { team, posted } = resolverFor(ANA, general);

    await team.post(design.id, 'the schema is agreed');
    const inDesign = posted.find((m) => m.channelId === 'design')!;
    expect(inDesign.kind).toBe('thing');
    expect(inDesign.userId).toBeUndefined();
    expect(inDesign.onBehalfOf).toEqual({ userId: 'u-ana', label: 'Ana K' });
  });

  it('leaves a receipt in the ORIGINATING thread, carrying where it went', async () => {
    const general = (await ensureDefaultChannel(root))[0]!;
    const design = await channelNamed('design');
    const { team, posted } = resolverFor(ANA, general, 'thr-7');

    const r = await team.post(design.id, 'the schema is agreed');
    expect(r.receipt).toBe(true);

    const receipt = posted.find((m) => m.channelId === 'general')!;
    expect(receipt.kind).toBe('system');
    expect(receipt.threadId).toBe('thr-7');
    expect(receipt.text).toContain('#design');
    // The typed field, exactly like the app card — a client renders an affordance
    // rather than parsing the sentence.
    expect(receipt.postedTo).toEqual({
      channelId: 'design',
      channelName: 'design',
      messageId: r.messageId,
    });
    // And it is on disk, so scrolling back through the thread still shows it.
    const log = await readMessages(root, 'general');
    expect(log.messages.some((m) => m.postedTo?.channelId === 'design')).toBe(true);
  });

  it('does NOT leave a receipt for a post into the thread it is already answering in', async () => {
    const general = (await ensureDefaultChannel(root))[0]!;
    const { team, posted } = resolverFor(ANA, general, 'thr-7');
    const r = await team.post('general', 'still here');
    expect(r.receipt).toBeUndefined();
    expect(posted).toHaveLength(1);
  });

  it('hands the receipt to the hook with the ORIGINATING channel, so it fans out there', async () => {
    const general = (await ensureDefaultChannel(root))[0]!;
    const design = await channelNamed('design');
    const seen: Array<[string, string]> = [];
    const team = createTeamResolver(
      root,
      { caller: ANA, channel: general },
      { onPost: (m, into) => seen.push([m.channelId, into.id]) },
    );
    await team.post(design.id, 'over there');
    // Each message is announced with the channel it LANDED in — which is what the
    // route turns into `audienceFor(channel)`. Announcing both against one channel
    // is how a DM would leak to everyone connected.
    expect(seen).toEqual([
      ['design', 'design'],
      ['general', 'general'],
    ]);
  });
});

// ─── The wiring ──────────────────────────────────────────────────────────────
//
// Everything above tests a resolver a TEST constructed. None of it would notice
// if the channel route never built one — the classic gap where a global is
// registered, unit-tested and simply not reachable in the running pod. These two
// drive the real `handlePostMessage` and assert on what the SessionManager was
// actually handed.

function mkReq(body: unknown, headers: Record<string, string>): IncomingMessage {
  const chunks = [Buffer.from(JSON.stringify(body))];
  const req = {
    method: 'POST',
    url: '/api/team/channels/general/messages',
    headers,
    async *[Symbol.asyncIterator]() {
      for (const c of chunks) yield c;
    },
    on(event: string, cb: (arg?: unknown) => void) {
      if (event === 'data') chunks.forEach((c) => cb(c));
      if (event === 'end') cb();
      return req;
    },
    setEncoding: () => req,
  } as unknown as IncomingMessage;
  return req;
}

function mkRes(): ServerResponse {
  const res = {
    setHeader() {},
    writeHead() {
      return res;
    },
    end() {},
  } as unknown as ServerResponse;
  return res;
}

function headersFor(caller: TeamCaller): Record<string, string> {
  return {
    'x-user-id': caller.userId,
    'x-user-email': caller.email,
    'x-team-id': caller.teamId,
    'x-lmthing-role': caller.role,
  };
}

/** Records the options every threaded THING turn was started with. */
function mkManager() {
  const runs: any[] = [];
  return {
    runs,
    manager: {
      runHeadlessThreaded: vi.fn(async (opts: any) => {
        runs.push(opts);
        return { ok: true, result: 'ok', sessionId: opts.sessionId };
      }),
    } as any,
  };
}

describe('the channel route actually WIRES the team surface into the turn', () => {
  it('hands runHeadlessThreaded a resolver bound to the requesting member', async () => {
    const { manager, runs } = mkManager();
    await handlePostMessage(manager, root)(
      mkReq({ text: '@thing who is in this team?' }, headersFor(ANA)),
      mkRes(),
      { channelId: 'general' },
      {} as any,
    );
    await settleChannelWork();

    expect(runs).toHaveLength(1);
    const team = runs[0].team;
    expect(team).toBeDefined();
    // Bound to the CALLER from the request's Envoy headers, and to the channel the
    // message landed in — not to anything the agent could name.
    const ctx = await team.context();
    expect(ctx.caller.userId).toBe(ANA.userId);
    expect(ctx.caller.role).toBe('editor');
    expect(ctx.channelId).toBe('general');
    expect(ctx.teamId).toBe('t1');
  });

  it('carries the VIEWER role through, so the refusal reaches the running turn', async () => {
    const { manager, runs } = mkManager();
    await handlePostMessage(manager, root)(
      mkReq({ text: '@thing announce this everywhere' }, headersFor(VIC)),
      mkRes(),
      { channelId: 'general' },
      {} as any,
    );
    await settleChannelWork();

    const team = runs[0].team;
    expect((await team.context()).caller.role).toBe('viewer');
    await expect(team.post('general', 'announcement')).rejects.toThrow(/viewer/);
  });
});

describe('teamPinApp', () => {
  it('an EDITOR pins a REAL project and the channel record changes', async () => {
    const general = (await ensureDefaultChannel(root))[0]!;
    await mkdir(join(root, 'blog'), { recursive: true });
    await writeFile(join(root, 'blog', 'project.json'), JSON.stringify({ id: 'blog' }), 'utf8');

    const { team, changed } = resolverFor(ANA, general);
    const r = await team.pinApp('general', 'blog');
    expect(r.apps).toEqual(['blog']);
    expect(changed[0]?.apps).toEqual(['blog']);

    // Pinning twice is idempotent — the sidebar must not render it twice.
    expect((await team.pinApp('general', 'blog')).apps).toEqual(['blog']);
  });

  it('refuses a project that does not exist — no dead tiles', async () => {
    const general = (await ensureDefaultChannel(root))[0]!;
    const { team } = resolverFor(ANA, general);
    await expect(team.pinApp('general', 'ghost')).rejects.toThrow('no such project: ghost');
  });

  it('a VIEWER cannot pin', async () => {
    const general = (await ensureDefaultChannel(root))[0]!;
    await mkdir(join(root, 'blog'), { recursive: true });
    await writeFile(join(root, 'blog', 'project.json'), JSON.stringify({ id: 'blog' }), 'utf8');
    const { team, changed } = resolverFor(VIC, general);
    await expect(team.pinApp('general', 'blog')).rejects.toThrow(/viewer/);
    expect(changed).toHaveLength(0);
  });
});
