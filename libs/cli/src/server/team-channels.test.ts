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
import { join } from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';
import {
  appendMessage,
  channelIdFromName,
  createChannel,
  ensureDefaultChannel,
  isValidChannelId,
  listChannels,
  mentionsThing,
  promptFor,
  readMessages,
  stripMention,
  teamDir,
  threadRootOf,
  type ChannelMessage,
} from './team-channels.js';
import {
  handleCreateChannel,
  handleListChannels,
  handleListMessages,
  handlePostMessage,
  settleChannelWork,
} from './routes/team-channels.js';
import { resetChannelSockets } from './ws/team-channels.js';

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
    expect(messages[1]!.text).toContain('budget exhausted');
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
