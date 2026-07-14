import { describe, it, expect, afterAll } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { Session } from '../session/session.js';
import { createMockStreamFn, mockMatch } from './mock-provider.js';
import type { StreamOpts } from '../eval/stream-types.js';
import type { RenderHost } from '../session/types.js';
import type { DocumentResolver } from '../globals/read-document.js';

/** The real system-files space (dispatch/reader/sheet), for the delegation test. */
const SYSTEM_FILES_DIR = fileURLToPath(new URL('../../system-spaces/system-files', import.meta.url));

const tmpDirs: string[] = [];
afterAll(async () => {
  await Promise.all(tmpDirs.map((d) => rm(d, { recursive: true, force: true })));
});

async function makeSpace(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'lmthing-attach-core-'));
  tmpDirs.push(dir);
  const file = join(dir, 'agents', 'main', 'instruct.md');
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, 'You are a test agent.\n', 'utf8');
  return dir;
}

describe('Session multimodal input threading', () => {
  it('exposes an image to a text agent as a delegatable note (NOT raw parts)', async () => {
    const captured: StreamOpts[] = [];
    const streamFn = createMockStreamFn((opts: StreamOpts) => {
      captured.push(opts);
      return ''; // no statements → turn ends
    });
    const host: RenderHost = { display: () => {}, ask: async () => undefined, log: () => {} };
    const session = new Session(
      { spaceDir: await makeSpace(), agentSlug: 'default', modelAlias: 'mock', renderHost: host, systemSpaceDirs: [] },
      { streamFn },
    );

    await session.start({
      text: 'what is in this picture?',
      attachments: [
        { id: 'up1', kind: 'image', mediaType: 'image/png', filename: 'p.png', part: { type: 'image', image: 'data:image/png;base64,AAAA', mediaType: 'image/png' } },
      ],
    });

    expect(captured.length).toBeGreaterThan(0);
    const userMsg = [...captured[0]!.messages].reverse().find((m) => m.role === 'user');
    expect(userMsg).toBeTruthy();
    // The user's text is framed as usual…
    expect(userMsg!.content).toContain('what is in this picture?');
    // …the attachment is surfaced as a note (id + kind) so a text model can delegate…
    expect(userMsg!.content).toContain('up1');
    expect(userMsg!.content).toMatch(/image/i);
    expect(userMsg!.content).toContain('system-vision');
    // …and the raw image bytes are NOT sent to the (text) THING model.
    expect(userMsg!.attachments).toBeUndefined();

    await session.dispose();
  });

  it('a plain string message carries no attachments', async () => {
    const captured: StreamOpts[] = [];
    const streamFn = createMockStreamFn((opts: StreamOpts) => {
      captured.push(opts);
      return '';
    });
    const host: RenderHost = { display: () => {}, ask: async () => undefined, log: () => {} };
    const session = new Session(
      { spaceDir: await makeSpace(), agentSlug: 'default', modelAlias: 'mock', renderHost: host, systemSpaceDirs: [] },
      { streamFn },
    );

    await session.start('just text');
    const userMsg = [...captured[0]!.messages].reverse().find((m) => m.role === 'user');
    expect(userMsg!.attachments).toBeUndefined();

    await session.dispose();
  });

  it('hands a delegated files agent an id-anchored readDocument note (no bytes/text)', async () => {
    // Drive the full session→delegate path: the top-level agent delegates the file
    // to system-files/reader; the session resolves the attachment id into an
    // id-anchored note telling the specialist to call readDocument(id). No bytes or
    // inlined text ever ride on the message — the whole point of the new design.
    let topLevelMsg = '';
    let readerMsg = '';
    let delegated = false;
    const streamFn = mockMatch(
      [
        // The reader delegate's turn (its charter "document reader" is in the system
        // block): capture its first user message, then resolve.
        {
          when: /document reader/,
          respond: (opts: StreamOpts) => {
            const u = [...opts.messages].reverse().find((m) => m.role === 'user');
            readerMsg = u?.content ?? '';
            return 'currentTask.resolve("done");';
          },
        },
      ],
      // Fallback = the top-level agent's turn: delegate the file once, then stop.
      (opts: StreamOpts) => {
        const u = [...opts.messages].reverse().find((m) => m.role === 'user');
        topLevelMsg = u?.content ?? '';
        if (delegated) return '';
        delegated = true;
        return `await delegate('system-files', 'reader', { query: 'summarize', attachmentIds: ['up1'] });`;
      },
    );

    // A document resolver need not be exercised here (the reader is mocked), but the
    // session threads it — assert it is not required to build the note.
    const documentResolver: DocumentResolver = async (id) => ({ ok: true, attachmentId: id, mediaType: 'application/pdf', kind: 'text', text: 'x' });

    const host: RenderHost = { display: () => {}, ask: async () => undefined, log: () => {} };
    const session = new Session(
      {
        spaceDir: await makeSpace(),
        agentSlug: 'default',
        modelAlias: 'mock',
        renderHost: host,
        systemSpaceDirs: [SYSTEM_FILES_DIR],
        documentResolver,
      },
      { streamFn },
    );

    await session.start({
      text: 'summarize this file',
      attachments: [
        // A FILE attachment: no image part, no inlined text — id + metadata only.
        { id: 'up1', kind: 'file', mediaType: 'application/pdf', filename: 'doc.pdf' },
      ],
    });

    // The top-level note routes files to system-files (by id), NOT raw bytes.
    expect(topLevelMsg).toContain('up1');
    expect(topLevelMsg).toContain('system-files');
    // The delegated reader is told to fetch the file itself via readDocument(id).
    expect(readerMsg).toContain('readDocument');
    expect(readerMsg).toContain('up1');
    expect(readerMsg).toContain('doc.pdf');

    await session.dispose();
  });

  it('resolves a PRIOR turn\'s attachment id when a LATER turn delegates it (propose→consent→build)', async () => {
    // THING's flow: turn 1 the user dumps a file and THING only OFFERS (no build);
    // turn 2 a bare "yes please" and THING delegates the SAME file to the automator to
    // seed the app. The attachment arrived in turn 1 but is delegated in turn 2. If
    // `pendingAttachments` is cleared each turn, turn 2's delegate can't resolve the
    // turn-1 id → the automator reads nothing → empty tables. This asserts the id still
    // resolves across turns (the reader gets an id-anchored readDocument note).
    let readerMsg = '';
    let sawSecondTurn = false;
    let delegated = false;
    const streamFn = mockMatch(
      [
        {
          when: /document reader/,
          respond: (opts: StreamOpts) => {
            const u = [...opts.messages].reverse().find((m) => m.role === 'user');
            readerMsg = u?.content ?? '';
            return 'currentTask.resolve("done");';
          },
        },
      ],
      // Top-level agent: turn 1 just "offers" (no statements); turn 2 delegates the
      // turn-1 attachment id ONCE, then stops.
      (opts: StreamOpts) => {
        const u = [...opts.messages].reverse().find((m) => m.role === 'user');
        if (/yes please/.test(u?.content ?? '')) sawSecondTurn = true;
        if (!sawSecondTurn || delegated) return ''; // turn 1: offer only; post-delegate: stop
        delegated = true;
        return `await delegate('system-files', 'reader', { query: 'seed the app', attachmentIds: ['up1'] });`;
      },
    );
    const documentResolver: DocumentResolver = async (id) => ({ ok: true, attachmentId: id, mediaType: 'application/pdf', kind: 'text', text: 'x' });
    const host: RenderHost = { display: () => {}, ask: async () => undefined, log: () => {} };
    const session = new Session(
      { spaceDir: await makeSpace(), agentSlug: 'default', modelAlias: 'mock', renderHost: host, systemSpaceDirs: [SYSTEM_FILES_DIR], documentResolver },
      { streamFn },
    );

    // Turn 1: the file arrives; THING only offers.
    await session.start({
      text: 'here is my budget spreadsheet, I keep losing track',
      attachments: [{ id: 'up1', kind: 'file', mediaType: 'application/pdf', filename: 'budget.pdf' }],
    });
    expect(readerMsg).toBe(''); // nothing delegated yet

    // Turn 2: a bare "yes please" — THING delegates the SAME (turn-1) attachment.
    await session.continue('yes please, build it');
    expect(readerMsg).toContain('readDocument');
    expect(readerMsg).toContain('up1');
    expect(readerMsg).toContain('budget.pdf');

    await session.dispose();
  });
});
