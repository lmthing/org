import { describe, it, expect, afterAll } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { Session } from '../session/session.js';
import { createMockStreamFn } from './mock-provider.js';
import type { StreamOpts } from '../eval/stream-types.js';
import type { RenderHost } from '../session/types.js';

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
  it('carries image attachments from start() through to the streamFn', async () => {
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
      attachments: [{ type: 'image', image: 'data:image/png;base64,AAAA', mediaType: 'image/png' }],
    });

    expect(captured.length).toBeGreaterThan(0);
    const userMsg = [...captured[0]!.messages].reverse().find((m) => m.role === 'user');
    expect(userMsg).toBeTruthy();
    // Framed like a normal text turn…
    expect(userMsg!.content).toContain('what is in this picture?');
    // …and the image rides alongside as an attachment.
    expect(userMsg!.attachments).toEqual([
      { type: 'image', image: 'data:image/png;base64,AAAA', mediaType: 'image/png' },
    ]);

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
});
