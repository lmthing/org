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

  it('threads document reading through a task-fork delegate into its action tasklist', async () => {
    const childDir = await mkdtemp(join(tmpdir(), 'lmthing-nested-document-child-'));
    tmpDirs.push(childDir);
    const childAgent = join(childDir, 'agents', 'reader', 'instruct.md');
    const childTask = join(childDir, 'tasklists', 'read_upload', '01-read.md');
    await mkdir(dirname(childAgent), { recursive: true });
    await mkdir(dirname(childTask), { recursive: true });
    await writeFile(childAgent, `---
title: Reader
actions:
  - id: read
    label: Read
    description: Read the supplied upload
    tasklist: read_upload
---

Read uploads.\n`, 'utf8');
    await writeFile(join(dirname(childTask), 'index.md'), `---
input:
  query: string
  attachmentIds: array
---

Read an upload.\n`, 'utf8');
    await writeFile(childTask, `---
id: read
goal: true
role: general
output:
  content: string
prelude: |
  const documents = await Promise.all((attachmentIds as string[]).map((id) => readDocument(id)));
---

READ_UPLOAD_TASK\n`, 'utf8');

    const parentDir = await mkdtemp(join(tmpdir(), 'lmthing-nested-document-parent-'));
    tmpDirs.push(parentDir);
    const parentAgent = join(parentDir, 'agents', 'main', 'instruct.md');
    const parentTask = join(parentDir, 'tasklists', 'outer', '01-delegate.md');
    await mkdir(dirname(parentAgent), { recursive: true });
    await mkdir(dirname(parentTask), { recursive: true });
    await writeFile(parentAgent, `---
canDelegateTo:
  - ${JSON.stringify(`${childDir}/reader#read`)}
---

Delegate the work.\n`, 'utf8');
    await writeFile(parentTask, `---
id: delegate
goal: true
role: general
output:
  content: string
canDelegateTo:
  - ${JSON.stringify(`${childDir}/reader#read`)}
---

OUTER_TASK\n`, 'utf8');

    const lastUser = (opts: StreamOpts) => [...opts.messages].reverse().find((message) => message.role === 'user')?.content ?? '';
    const allText = (opts: StreamOpts) => opts.messages.map((m) => String(m.content)).join('\n');
    const streamFn = createMockStreamFn((opts: StreamOpts) => {
      const user = lastUser(opts);
      // The nested action tasklist's node: read the upload via the injected readDocument and
      // resolve its text. Its own turn shows the host PRELUDE results, so the node-body token
      // lives in the system block, not the last user message — match across all messages.
      // This resolves to real content ONLY when the fork leaf received a documentResolver down
      // the delegate chain (the fix under test); without it the prelude readDocument throws.
      if (allText(opts).includes('READ_UPLOAD_TASK')) {
        return `currentTask.resolve({ content: String(documents[0]?.text ?? '') });`;
      }
      // The child agent's action: run its tasklist and RETURN its envelope (mirrors the
      // real automator's `currentTask.resolve(await tasklist('build_live_project', { query, ...context }))`).
      if (user.includes('Run action: read')) {
        return `currentTask.resolve(await tasklist('read_upload', { query, ...context }));`;
      }
      // The parent tasklist node: delegate to the child action, forwarding the upload id
      // through `context` (the channel delegate seeds into the action node, delegate.ts).
      // Issuing the delegate FROM a tasklist fork is what routes it through
      // Session.runDelegateForFork — the leg that used to drop documentResolver.
      if (user.includes('OUTER_TASK')) {
        return `currentTask.resolve({ content: String((await delegate(${JSON.stringify(childDir)}, 'reader', 'read', { query: 'read the upload', context: { attachmentIds: ['up1'] } }) as { data: { content: string } }).data.content) });`;
      }
      if (user.includes('User request:')) {
        return `display('content=' + String((await tasklist('outer') as { data: { content: string } }).data.content));`;
      }
      return '';
    });

    const displays: unknown[] = [];
    const session = new Session(
      {
        spaceDir: parentDir,
        agentSlug: 'default',
        modelAlias: 'mock',
        renderHost: { display: (value) => displays.push(value), ask: async () => undefined, log: () => {} },
        systemSpaceDirs: [childDir],
        documentResolver: async (id) => ({ ok: true, attachmentId: id, mediaType: 'text/plain', kind: 'text', text: id === 'up1' ? 'nested source content' : '' }),
      },
      { streamFn },
    );

    await session.start('build from the upload');
    expect(displays).toContain('content=nested source content');
    await session.dispose();
  });

  it('a MISMATCHED attachment id throws a named, actionable error instead of silently dropping it', async () => {
    // If the delegating agent mistypes even one character of a long id it had to
    // retype by hand from the attachment note, the old behavior silently dropped the
    // attachment — the specialist got zero attachment info, indistinguishable from
    // "nothing was ever attached", and the model had no signal to self-correct. The
    // fix throws a named error listing the real id(s) so a retry can fix it.
    const displays: unknown[] = [];
    let delegated = false;
    const streamFn = createMockStreamFn(() => {
      if (delegated) return '';
      delegated = true;
      // 'up1x' stands in for a mistyped id — one character off from the real 'up1'.
      return `
        try {
          await delegate('system-files', 'reader', { query: 'summarize', attachmentIds: ['up1x'] });
        } catch (e) {
          // The host bridges a rejection as a plain string (host-bridge.ts
          // marshalToQuickJS), not an Error instance — e IS the message here.
          display(String(e));
        }
      `;
    });
    const documentResolver: DocumentResolver = async (id) => ({ ok: true, attachmentId: id, mediaType: 'application/pdf', kind: 'text', text: 'x' });
    const host: RenderHost = {
      display: (value) => displays.push(value),
      ask: async () => undefined,
      log: () => {},
    };
    const session = new Session(
      { spaceDir: await makeSpace(), agentSlug: 'default', modelAlias: 'mock', renderHost: host, systemSpaceDirs: [SYSTEM_FILES_DIR], documentResolver },
      { streamFn },
    );

    await session.start({
      text: 'summarize this file',
      attachments: [{ id: 'up1', kind: 'file', mediaType: 'application/pdf', filename: 'doc.pdf' }],
    });

    expect(displays.length).toBe(1);
    const message = String(displays[0]);
    // Names the mismatched id it was passed...
    expect(message).toContain('up1x');
    // ...and the real known attachment (id + filename) so a retry can self-correct.
    expect(message).toContain('up1');
    expect(message).toContain('doc.pdf');

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
