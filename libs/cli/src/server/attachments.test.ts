/**
 * Attachment pipeline (keyless). Two layers:
 *   - assembleParts: the pure transform from stored uploads → model parts +
 *     trace metadata + transcript blocks (the heart of the vision/audio/file
 *     feature), tested exhaustively without any session or disk.
 *   - SessionManager.saveUpload/readUpload: the disk round-trip an HTTP upload
 *     and the serving route rely on.
 */
import { describe, it, expect, afterAll } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createMockStreamFn } from '@lmthing/core';
import type { StreamOpts } from '@lmthing/core';
import { SessionManager } from './session-manager.js';
import { assembleParts, type UploadMeta } from './uploads.js';

const tmpDirs: string[] = [];
afterAll(async () => {
  await Promise.all(tmpDirs.map((d) => rm(d, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })));
});

const meta = (m: Partial<UploadMeta> & Pick<UploadMeta, 'id' | 'kind' | 'mediaType'>): UploadMeta => m;

describe('assembleParts', () => {
  it('maps an image to a delegatable attachment carrying its id + image part', () => {
    const r = assembleParts([
      { meta: meta({ id: 'i1', kind: 'image', mediaType: 'image/png', filename: 'a.png' }), bytes: new Uint8Array([1, 2, 3]) },
    ]);
    expect(r.attachments).toEqual([
      { id: 'i1', kind: 'image', mediaType: 'image/png', filename: 'a.png', part: { type: 'image', image: `data:image/png;base64,${Buffer.from([1, 2, 3]).toString('base64')}`, mediaType: 'image/png' } },
    ]);
    expect(r.traceAttachments).toEqual([
      { kind: 'image', url: '/api/uploads/i1', mediaType: 'image/png', filename: 'a.png' },
    ]);
    expect(r.transcripts).toEqual([]);
  });

  it('carries a binary doc (PDF) as an id-only attachment — no text, no part (read on demand)', () => {
    const r = assembleParts([
      { meta: meta({ id: 'f1', kind: 'file', mediaType: 'application/pdf', filename: 'doc.pdf', text: 'the mascot is Pico' }), bytes: new Uint8Array([9]) },
    ]);
    // The delegated files agent fetches content itself via readDocument(id): the
    // attachment carries ONLY its id + metadata, never inlined text or a file part.
    expect(r.attachments).toEqual([
      { id: 'f1', kind: 'file', mediaType: 'application/pdf', filename: 'doc.pdf' },
    ]);
    expect(r.attachments[0]!.part).toBeUndefined(); // NEVER a file part — no chat model reads one
    expect(r.attachments[0]!.text).toBeUndefined(); // NEVER inlined — read via readDocument(id)
  });

  it('carries a text file as an id-only attachment too (uniform readDocument path)', () => {
    const r = assembleParts([
      { meta: meta({ id: 't1', kind: 'file', mediaType: 'text/plain', filename: 'notes.txt' }), bytes: new TextEncoder().encode('the code is BANANA42') },
    ]);
    expect(r.attachments).toEqual([
      { id: 't1', kind: 'file', mediaType: 'text/plain', filename: 'notes.txt' },
    ]);
    expect(r.attachments[0]!.part).toBeUndefined();
    expect(r.attachments[0]!.text).toBeUndefined(); // text files ALSO go through readDocument now
    expect(r.transcripts).toEqual([]);
    expect(r.traceAttachments[0]).toMatchObject({ kind: 'file', mediaType: 'text/plain' });
  });

  it('turns audio into a transcript block (no attachment, no bytes to the model)', () => {
    const r = assembleParts([
      { meta: meta({ id: 'a1', kind: 'audio', mediaType: 'audio/mpeg', filename: 'clip.mp3', transcript: 'hello there' }), bytes: null },
    ]);
    expect(r.attachments).toEqual([]); // audio → text, handled by the text model directly
    expect(r.transcripts).toEqual(['[Transcript of clip.mp3]:\nhello there']);
    expect(r.traceAttachments[0]).toMatchObject({ kind: 'audio', url: '/api/uploads/a1', transcript: 'hello there' });
  });

  it('skips missing metadata and image bytes that failed to read', () => {
    const r = assembleParts([
      { meta: null, bytes: null },
      { meta: meta({ id: 'i2', kind: 'image', mediaType: 'image/png' }), bytes: null },
    ]);
    expect(r.attachments).toEqual([]);
    expect(r.traceAttachments).toHaveLength(1); // the image's metadata still surfaces to the UI
  });

  it('handles a mixed batch (image + pdf + audio) preserving order', () => {
    const r = assembleParts([
      { meta: meta({ id: 'i', kind: 'image', mediaType: 'image/jpeg' }), bytes: new Uint8Array([1]) },
      { meta: meta({ id: 'f', kind: 'file', mediaType: 'application/pdf' }), bytes: new Uint8Array([2]) },
      { meta: meta({ id: 'a', kind: 'audio', mediaType: 'audio/wav', transcript: 'spoken' }), bytes: null },
    ]);
    expect(r.attachments.map((a) => a.kind)).toEqual(['image', 'file']);
    // image → image part; pdf → an id-only attachment (read on demand), never a part/text
    expect(r.attachments[0]!.part?.type).toBe('image');
    expect(r.attachments[1]!.part).toBeUndefined();
    expect(r.attachments[1]!.text).toBeUndefined();
    expect(r.transcripts).toEqual(['[Transcript of audio]:\nspoken']);
    expect(r.traceAttachments.map((t) => t.kind)).toEqual(['image', 'file', 'audio']);
  });
});

describe('SessionManager upload storage', () => {
  async function makeManager(): Promise<SessionManager> {
    const root = await mkdtemp(join(tmpdir(), 'lmthing-attach-root-'));
    tmpDirs.push(root);
    return new SessionManager({
      streamFn: createMockStreamFn((_o: StreamOpts) => ''),
      lmthingRoot: root,
      snapshotsDir: join(root, 'snaps'),
    });
  }

  it('stores an upload and serves it back with its media type', async () => {
    const manager = await makeManager();
    const ref = await manager.saveUpload({
      bytes: Buffer.from([0x89, 0x50, 0x4e, 0x47]),
      mediaType: 'image/png',
      filename: 'shot.png',
    });
    expect(ref.kind).toBe('image');
    expect(ref.url).toBe(`/api/uploads/${ref.id}`);

    const served = await manager.readUpload(ref.id);
    expect(served?.mediaType).toBe('image/png');
    expect(Array.from(served!.bytes)).toEqual([0x89, 0x50, 0x4e, 0x47]);
  });

  it('returns null when serving an unknown id', async () => {
    const manager = await makeManager();
    expect(await manager.readUpload('123e4567-e89b-12d3-a456-426614174000')).toBeNull();
  });
});
