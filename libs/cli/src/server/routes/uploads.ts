import { readBody, sendJson } from './utils.js';
import type { RouteHandler } from '../router.js';
import { readCaller } from '../team-guard.js';
import { ensureDefaultChannel, isVisibleTo } from '../team-channels.js';

/** Cap a single upload to keep base64 payloads (read fully into memory) bounded. */
const MAX_UPLOAD_BYTES = 25 * 1024 * 1024; // 25 MB

/** Strip a `data:<mime>;base64,` prefix if the client sent a data URL. */
function decodeBase64(data: string): Buffer {
  const comma = data.startsWith('data:') ? data.indexOf(',') : -1;
  return Buffer.from(comma >= 0 ? data.slice(comma + 1) : data, 'base64');
}

/** POST /api/uploads — accept a base64-encoded file, store it (transcribing
 *  audio on the way in), and return an {@link AttachmentRef} the chat client
 *  sends back with the next message. */
export const handleUpload: RouteHandler = async (req, res, _params, ctx) => {
  const body = await readBody(req);
  let parsed: { filename?: string; mediaType?: string; data?: string };
  try {
    parsed = JSON.parse(body || '{}');
  } catch {
    sendJson(res, 400, { error: 'invalid JSON body' });
    return;
  }
  const { filename, mediaType, data } = parsed;
  if (typeof mediaType !== 'string' || !mediaType) {
    sendJson(res, 400, { error: 'mediaType is required' });
    return;
  }
  if (typeof data !== 'string' || !data) {
    sendJson(res, 400, { error: 'data (base64) is required' });
    return;
  }
  const bytes = decodeBase64(data);
  if (bytes.length === 0) {
    sendJson(res, 400, { error: 'empty upload' });
    return;
  }
  if (bytes.length > MAX_UPLOAD_BYTES) {
    sendJson(res, 413, { error: `upload exceeds ${MAX_UPLOAD_BYTES} bytes` });
    return;
  }
  // On a team pod, remember WHO uploaded this. `readCaller` is null on a personal
  // pod (single-tenant, one principal), so nothing changes there.
  const owner = readCaller(req)?.userId;
  const ref = await ctx.manager.saveUpload({
    bytes, mediaType,
    ...(filename ? { filename } : {}),
    ...(owner ? { ownerUserId: owner } : {}),
  });
  sendJson(res, 201, ref);
};

/**
 * GET /api/uploads/:id — serve a stored upload's raw bytes for `<img>`/`<audio>`.
 *
 * On a TEAM pod this is a per-resource authorization point, and it had none: the
 * request was discarded (`_req`), so the caller was never read, and the team guard
 * lets every read-only method through before any per-resource rule could apply —
 * correctly, since it gates route SHAPES, not resources.
 *
 * Nothing published an id to anyone but its uploader and ids are `randomUUID`, so
 * this was not exploitable; the protection was that a member could not learn
 * another member's id. A channel attachment puts an id into a message body every
 * member reads, which is exactly what closes that gap: a non-owner is now let
 * through when the upload has been posted (`recordUploadChannel`) into a
 * channel THEY can also see — the same `isVisibleTo` predicate a message read
 * already uses, not a weaker one, so a DM's audience stays its two members.
 *
 * A **404, not a 403**, for an upload the caller may not see — the same choice
 * the DM routes make. "You may not read this" and "there is no such thing" must
 * be indistinguishable, or the error itself becomes a way to test which ids
 * exist.
 */
export const handleServeUpload: RouteHandler = async (req, res, params, ctx) => {
  const id = params['id']!;
  const found = await ctx.manager.readUpload(id);
  if (!found) {
    sendJson(res, 404, { error: 'upload not found' });
    return;
  }
  const caller = readCaller(req);
  // An upload with NO owner is refused on a team pod, unless it has been posted
  // into a channel the caller can see.
  //
  // This DOES break pre-existing ownerless uploads — deliberately, on the owner's
  // call. The alternative was serving them to any member on the grounds that they
  // predate the field, which is precisely the "safe by accident" reasoning the
  // authorization issue was written to end: it leaves a set of files whose only
  // protection is that their id is hard to guess, and attachments exist to put
  // ids in front of people. A closed, shrinking exception is still an exception,
  // and this one would have been indistinguishable from the bug it replaced.
  //
  // `found.ownerUserId` being undefined can never equal a `userId`, so the
  // ownerless case simply falls through to the audience check and fails closed
  // there — no separate branch to keep in step with the owned one.
  if (caller && found.ownerUserId !== caller.userId) {
    const inAudience = await isVisibleInAnyChannel(
      ctx.effectiveLmthingRoot,
      found.channelIds,
      caller.userId,
    );
    if (!inAudience) {
      sendJson(res, 404, { error: 'upload not found' });
      return;
    }
  }
  res.writeHead(200, {
    'Content-Type': found.mediaType,
    'Content-Length': String(found.bytes.length),
    // Uploads are immutable (content-addressed by random id).
    'Cache-Control': 'private, max-age=31536000, immutable',
  });
  res.end(Buffer.from(found.bytes));
};

/**
 * Whether `userId` may see at least one of the channels an upload has been
 * posted into — the audience half of {@link handleServeUpload}'s check.
 *
 * `root` is only absent off a misconfigured team pod (team mode requires
 * project-mode); `channelIds` is only absent for an upload never attached to a
 * message. Either way there is nothing to grant against, so this fails closed.
 */
async function isVisibleInAnyChannel(
  root: string | undefined,
  channelIds: string[] | undefined,
  userId: string,
): Promise<boolean> {
  if (!root || !channelIds?.length) return false;
  const channels = await ensureDefaultChannel(root);
  return channelIds.some((channelId) => {
    const channel = channels.find((c) => c.id === channelId);
    return channel ? isVisibleTo(channel, userId) : false;
  });
}
