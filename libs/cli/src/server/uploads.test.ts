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
  extractDocumentText,
} from './uploads.js';

/** A tiny reportlab-generated PDF whose only text is "MASCOT_IS_PICO". */
const TINY_PDF_B64 =
  'JVBERi0xLjMKJZOMi54gUmVwb3J0TGFiIEdlbmVyYXRlZCBQREYgZG9jdW1lbnQgaHR0cDovL3d3dy5yZXBvcnRsYWIuY29tCjEgMCBvYmoKPDwKL0YxIDIgMCBSCj4+CmVuZG9iagoyIDAgb2JqCjw8Ci9CYXNlRm9udCAvSGVsdmV0aWNhIC9FbmNvZGluZyAvV2luQW5zaUVuY29kaW5nIC9OYW1lIC9GMSAvU3VidHlwZSAvVHlwZTEgL1R5cGUgL0ZvbnQKPj4KZW5kb2JqCjMgMCBvYmoKPDwKL0NvbnRlbnRzIDcgMCBSIC9NZWRpYUJveCBbIDAgMCA1OTUuMjc1NiA4NDEuODg5OCBdIC9QYXJlbnQgNiAwIFIgL1Jlc291cmNlcyA8PAovRm9udCAxIDAgUiAvUHJvY1NldCBbIC9QREYgL1RleHQgL0ltYWdlQiAvSW1hZ2VDIC9JbWFnZUkgXQo+PiAvUm90YXRlIDAgL1RyYW5zIDw8Cgo+PiAKICAvVHlwZSAvUGFnZQo+PgplbmRvYmoKNCAwIG9iago8PAovUGFnZU1vZGUgL1VzZU5vbmUgL1BhZ2VzIDYgMCBSIC9UeXBlIC9DYXRhbG9nCj4+CmVuZG9iago1IDAgb2JqCjw8Ci9BdXRob3IgKGFub255bW91cykgL0NyZWF0aW9uRGF0ZSAoRDoyMDI2MDcwOTA5MzMxNCswMCcwMCcpIC9DcmVhdG9yIChSZXBvcnRMYWIgUERGIExpYnJhcnkgLSB3d3cucmVwb3J0bGFiLmNvbSkgL0tleXdvcmRzICgpIC9Nb2REYXRlIChEOjIwMjYwNzA5MDkzMzE0KzAwJzAwJykgL1Byb2R1Y2VyIChSZXBvcnRMYWIgUERGIExpYnJhcnkgLSB3d3cucmVwb3J0bGFiLmNvbSkgCiAgL1N1YmplY3QgKHVuc3BlY2lmaWVkKSAvVGl0bGUgKHVudGl0bGVkKSAvVHJhcHBlZCAvRmFsc2UKPj4KZW5kb2JqCjYgMCBvYmoKPDwKL0NvdW50IDEgL0tpZHMgWyAzIDAgUiBdIC9UeXBlIC9QYWdlcwo+PgplbmRvYmoKNyAwIG9iago8PAovRmlsdGVyIFsgL0FTQ0lJODVEZWNvZGUgL0ZsYXRlRGVjb2RlIF0gL0xlbmd0aCAxMDYKPj4Kc3RyZWFtCkdhcFFoMEU9RiwwVVxIM1RccE5ZVF5RS2s/dGM+SVAsO1cjVTFeMjNpaFBFTV8/Q1c0S0lTaTkwTWpHLmlmSUNLJTpALmBCRSsnPGNmIlF1Ok01L09Lb2RqPiYxcnVpIllLZEkzPjVafj5lbmRzdHJlYW0KZW5kb2JqCnhyZWYKMCA4CjAwMDAwMDAwMDAgNjU1MzUgZiAKMDAwMDAwMDA3MyAwMDAwMCBuIAowMDAwMDAwMTA0IDAwMDAwIG4gCjAwMDAwMDAyMTEgMDAwMDAgbiAKMDAwMDAwMDQxNCAwMDAwMCBuIAowMDAwMDAwNDgyIDAwMDAwIG4gCjAwMDAwMDA3NzggMDAwMDAgbiAKMDAwMDAwMDgzNyAwMDAwMCBuIAp0cmFpbGVyCjw8Ci9JRCAKWzxjOTI2ZTQwZTdiZTAwNmUwNzYxYjY0MTY1NzY2ZWQyMT48YzkyNmU0MGU3YmUwMDZlMDc2MWI2NDE2NTc2NmVkMjE+XQolIFJlcG9ydExhYiBnZW5lcmF0ZWQgUERGIGRvY3VtZW50IC0tIGRpZ2VzdCAoaHR0cDovL3d3dy5yZXBvcnRsYWIuY29tKQoKL0luZm8gNSAwIFIKL1Jvb3QgNCAwIFIKL1NpemUgOAo+PgpzdGFydHhyZWYKMTAzMwolJUVPRgo=';

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

  it('extractDocumentText pulls text out of a PDF', async () => {
    const bytes = new Uint8Array(Buffer.from(TINY_PDF_B64, 'base64'));
    const text = await extractDocumentText('application/pdf', bytes);
    expect(text).toContain('MASCOT_IS_PICO');
  });

  it('extractDocumentText returns undefined for non-pdf and for garbage bytes', async () => {
    expect(await extractDocumentText('application/octet-stream', new Uint8Array([1, 2, 3]))).toBeUndefined();
    expect(await extractDocumentText('application/pdf', new Uint8Array([1, 2, 3]))).toBeUndefined();
  });

  it('returns null for an unsafe or missing id', async () => {
    const dir = await makeDir();
    expect(await readUploadMeta(dir, '../secrets')).toBeNull();
    expect(await readUploadBytes(dir, '../secrets')).toBeNull();
    expect(await readUploadMeta(dir, '123e4567-e89b-12d3-a456-426614174000')).toBeNull();
  });
});
