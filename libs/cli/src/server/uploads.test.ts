import { describe, it, expect, afterAll } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  classifyKind,
  isSafeUploadId,
  uploadUrl,
  resolveUploadsDir,
  saveUpload,
  readUploadMeta,
  readUploadBytes,
} from './uploads.js';

const tmpDirs: string[] = [];
afterAll(async () => {
  await Promise.all(tmpDirs.map((d) => rm(d, { recursive: true, force: true })));
});

async function makeDir(): Promise<string> {
  const d = await mkdtemp(join(tmpdir(), 'lmthing-uploads-'));
  tmpDirs.push(d);
  return d;
}

describe('uploads', () => {
  it('classifies media kinds by IANA type', () => {
    expect(classifyKind('image/png')).toBe('image');
    expect(classifyKind('image/jpeg')).toBe('image');
    expect(classifyKind('audio/mpeg')).toBe('audio');
    expect(classifyKind('audio/wav')).toBe('audio');
    expect(classifyKind('application/pdf')).toBe('file');
    expect(classifyKind('text/plain')).toBe('file');
  });

  it('only accepts randomUUID-shaped ids (path-traversal guard)', () => {
    expect(isSafeUploadId('123e4567-e89b-12d3-a456-426614174000')).toBe(true);
    expect(isSafeUploadId('../etc/passwd')).toBe(false);
    expect(isSafeUploadId('foo/bar')).toBe(false);
    expect(isSafeUploadId('')).toBe(false);
    expect(isSafeUploadId('123e4567-e89b-12d3-a456-426614174000.json')).toBe(false);
  });

  it('builds the serving url from an id', () => {
    expect(uploadUrl('abc')).toBe('/api/uploads/abc');
  });

  it('resolves the uploads dir under the runtime root', () => {
    expect(resolveUploadsDir('/data/.lmthing')).toBe('/data/.lmthing/uploads');
  });

  it('round-trips bytes + metadata through disk', async () => {
    const dir = await makeDir();
    const bytes = new Uint8Array([1, 2, 3, 4, 5]);
    const meta = await saveUpload(dir, { bytes, mediaType: 'image/png', filename: 'pic.png' });
    expect(meta.kind).toBe('image');
    expect(meta.mediaType).toBe('image/png');
    expect(meta.filename).toBe('pic.png');
    expect(isSafeUploadId(meta.id)).toBe(true);

    const readMeta = await readUploadMeta(dir, meta.id);
    expect(readMeta).toEqual(meta);
    const readBytes = await readUploadBytes(dir, meta.id);
    expect(readBytes).not.toBeNull();
    expect(Array.from(readBytes!)).toEqual([1, 2, 3, 4, 5]);
  });

  it('persists a transcript for audio uploads', async () => {
    const dir = await makeDir();
    const meta = await saveUpload(dir, {
      bytes: new Uint8Array([9]),
      mediaType: 'audio/mpeg',
      filename: 'clip.mp3',
      transcript: 'hello world',
    });
    expect(meta.kind).toBe('audio');
    const readMeta = await readUploadMeta(dir, meta.id);
    expect(readMeta?.transcript).toBe('hello world');
  });

  it('returns null for an unsafe or missing id', async () => {
    const dir = await makeDir();
    expect(await readUploadMeta(dir, '../secrets')).toBeNull();
    expect(await readUploadBytes(dir, '../secrets')).toBeNull();
    expect(await readUploadMeta(dir, '123e4567-e89b-12d3-a456-426614174000')).toBeNull();
  });
});
