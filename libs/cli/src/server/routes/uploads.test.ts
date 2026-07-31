import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { handleServeUpload } from './uploads.js';
import { saveUpload } from '../uploads.js';

/**
 * `GET /api/uploads/:id` is a per-resource authorization point on a team pod, and
 * it had none: the request was discarded so the caller was never read, and the
 * team guard passes every read-only method before a per-resource rule could
 * apply. `UploadMeta` had no owner field, so no check was even possible.
 *
 * It was not exploitable — ids are randomUUID and nothing published one to anyone
 * but its uploader — but a channel attachment puts an id into a message body
 * every member reads, which ends that on the day the feature ships.
 */
const ANA = { 'x-user-id': 'u-ana', 'x-user-email': 'ana@x.test', 'x-team-id': 't1', 'x-lmthing-role': 'editor' };
const BO = { ...ANA, 'x-user-id': 'u-bo', 'x-user-email': 'bo@x.test', 'x-lmthing-role': 'viewer' };

function mkReq(headers: Record<string, string>): IncomingMessage {
  return { method: 'GET', url: '/api/uploads/x', headers } as unknown as IncomingMessage;
}
function mkRes() {
  let status = 0;
  let payload = '';
  const chunks: Buffer[] = [];
  const res = {
    setHeader() {},
    writeHead(s: number) { status = s; return res; },
    end(body?: string | Buffer) {
      if (typeof body === 'string') payload = body;
      else if (body) chunks.push(body);
    },
    get statusCode() { return status || (chunks.length ? 200 : 0); },
    json: () => JSON.parse(payload || '{}'),
    bytes: () => Buffer.concat(chunks),
  } as unknown as ServerResponse & { statusCode: number; json: () => any; bytes: () => Buffer };
  return res;
}

let root: string;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'lm-uploads-'));
  process.env['LMTHING_TEAM_MODE'] = '1';
});
afterEach(async () => {
  delete process.env['LMTHING_TEAM_MODE'];
  await rm(root, { recursive: true, force: true });
});

function ctxFor(dir: string) {
  return {
    manager: {
      async readUpload(id: string) {
        const { readUploadMeta, readUploadBytes } = await import('../uploads.js');
        const meta = await readUploadMeta(dir, id);
        if (!meta) return null;
        const bytes = await readUploadBytes(dir, id);
        if (!bytes) return null;
        return { bytes, mediaType: meta.mediaType, ...(meta.ownerUserId ? { ownerUserId: meta.ownerUserId } : {}) };
      },
    },
  } as any;
}

describe('serving an upload on a team pod', () => {
  it("refuses another member's upload — and says 404, not 403", async () => {
    const meta = await saveUpload(root, { bytes: new Uint8Array([1, 2, 3]), mediaType: 'image/png', ownerUserId: 'u-ana' });

    const mine = mkRes();
    await handleServeUpload(mkReq(ANA), mine, { id: meta.id }, ctxFor(root));
    expect(mine.bytes().length, 'the owner still gets their own file').toBe(3);

    const theirs = mkRes();
    await handleServeUpload(mkReq(BO), theirs, { id: meta.id }, ctxFor(root));
    expect(theirs.statusCode).toBe(404);
    // 404 and not 403 on purpose: "you may not read this" and "there is no such
    // thing" must be indistinguishable, or the error is a way to test which ids
    // exist. Same choice the DM routes make.
    expect(theirs.json().error).toBe('upload not found');
    expect(theirs.bytes().length).toBe(0);
  });

  it('serves an ownerless upload to any member — the documented legacy decision', async () => {
    // Stored before the field existed. Refusing these would break already-rendered
    // images in already-sent messages; the set is closed and shrinks to nothing.
    const meta = await saveUpload(root, { bytes: new Uint8Array([9]), mediaType: 'image/png' });
    const res = mkRes();
    await handleServeUpload(mkReq(BO), res, { id: meta.id }, ctxFor(root));
    expect(res.bytes().length).toBe(1);
  });

  it('is inert on a personal pod — one principal, nothing to check', async () => {
    delete process.env['LMTHING_TEAM_MODE'];
    const meta = await saveUpload(root, { bytes: new Uint8Array([7, 7]), mediaType: 'image/png', ownerUserId: 'u-ana' });
    const res = mkRes();
    // No identity headers at all, as on a personal pod.
    await handleServeUpload(mkReq({}), res, { id: meta.id }, ctxFor(root));
    expect(res.bytes().length, 'a personal pod must behave exactly as before').toBe(2);
  });
});
