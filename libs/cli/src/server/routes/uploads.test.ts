import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { handleServeUpload } from './uploads.js';
import { saveUpload, recordUploadChannel } from '../uploads.js';
import { createChannel, ensureDmChannel } from '../team-channels.js';

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
    effectiveLmthingRoot: dir,
    manager: {
      async readUpload(id: string) {
        const { readUploadMeta, readUploadBytes } = await import('../uploads.js');
        const meta = await readUploadMeta(dir, id);
        if (!meta) return null;
        const bytes = await readUploadBytes(dir, id);
        if (!bytes) return null;
        return {
          bytes,
          mediaType: meta.mediaType,
          ...(meta.ownerUserId ? { ownerUserId: meta.ownerUserId } : {}),
          ...(meta.channelIds?.length ? { channelIds: meta.channelIds } : {}),
        };
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

  it('REFUSES an ownerless upload on a team pod, even to a member', async () => {
    // Stored before the owner field existed. Serving these to any member was the
    // earlier decision, on the grounds that the set is closed and shrinking — but
    // that leaves files whose only protection is an id being hard to guess, which
    // is exactly the "safe by accident" state the authorization issue existed to
    // end. Attachments put ids in front of people. Breaking these is the owner's
    // deliberate call, so a stale image in an old message is the accepted cost.
    const meta = await saveUpload(root, { bytes: new Uint8Array([9]), mediaType: 'image/png' });
    const res = mkRes();
    await handleServeUpload(mkReq(BO), res, { id: meta.id }, ctxFor(root));
    expect(res.statusCode, 'indistinguishable from "no such upload"').toBe(404);
  });

  it('still serves an ownerless upload that was POSTED to a channel the caller can see', async () => {
    // The audience rule does not care who uploaded it, only who may read where it
    // was posted — so an old file attached to a channel message stays readable by
    // that channel, which is the case worth keeping working.
    const { channel } = await createChannel(root, 'general-legacy', 'u-ana');
    const meta = await saveUpload(root, { bytes: new Uint8Array([9, 9]), mediaType: 'image/png' });
    await recordUploadChannel(root, meta.id, channel.id);
    const res = mkRes();
    await handleServeUpload(mkReq(BO), res, { id: meta.id }, ctxFor(root));
    expect(res.bytes().length, 'visible via the channel it was posted into').toBe(2);
  });

  it('is inert on a personal pod — one principal, nothing to check', async () => {
    delete process.env['LMTHING_TEAM_MODE'];
    const meta = await saveUpload(root, { bytes: new Uint8Array([7, 7]), mediaType: 'image/png', ownerUserId: 'u-ana' });
    const res = mkRes();
    // No identity headers at all, as on a personal pod.
    await handleServeUpload(mkReq({}), res, { id: meta.id }, ctxFor(root));
    expect(res.bytes().length, 'a personal pod must behave exactly as before').toBe(2);
  });

  it('serves a non-owner who is in the audience of a channel the upload was posted to', async () => {
    const { channel } = await createChannel(root, 'general', 'u-ana');
    const meta = await saveUpload(root, { bytes: new Uint8Array([4, 4, 4]), mediaType: 'image/png', ownerUserId: 'u-ana' });
    await recordUploadChannel(root, meta.id, channel.id);

    const res = mkRes();
    // Bo owns nothing here, but #general is visible to every member.
    await handleServeUpload(mkReq(BO), res, { id: meta.id }, ctxFor(root));
    expect(res.statusCode).toBe(200);
    expect(res.bytes().length).toBe(3);
  });

  it("refuses a non-member — including a viewer — an upload posted to a DM they are not in", async () => {
    const { channel: dm } = await ensureDmChannel(root, ['u-ana', 'u-carol'], 'u-ana');
    const meta = await saveUpload(root, { bytes: new Uint8Array([5]), mediaType: 'image/png', ownerUserId: 'u-ana' });
    await recordUploadChannel(root, meta.id, dm.id);

    // Bo is a real member of the TEAM (a viewer) but not of this DM.
    const res = mkRes();
    await handleServeUpload(mkReq(BO), res, { id: meta.id }, ctxFor(root));
    expect(res.statusCode).toBe(404);
    expect(res.json().error).toBe('upload not found');
    expect(res.bytes().length).toBe(0);
  });

  it('serves the OTHER member of the DM the upload was posted to', async () => {
    const { channel: dm } = await ensureDmChannel(root, ['u-ana', 'u-carol'], 'u-ana');
    const meta = await saveUpload(root, { bytes: new Uint8Array([6, 6]), mediaType: 'image/png', ownerUserId: 'u-ana' });
    await recordUploadChannel(root, meta.id, dm.id);

    const CAROL = { ...ANA, 'x-user-id': 'u-carol', 'x-user-email': 'carol@x.test', 'x-lmthing-role': 'viewer' };
    const res = mkRes();
    await handleServeUpload(mkReq(CAROL), res, { id: meta.id }, ctxFor(root));
    expect(res.statusCode).toBe(200);
    expect(res.bytes().length).toBe(2);
  });
});
