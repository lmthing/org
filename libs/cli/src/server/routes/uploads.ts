import { readBody, sendJson } from './utils.js';
import type { RouteHandler } from '../router.js';
import { readCaller } from '../team-guard.js';

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
 * member reads, which ends that the moment the feature ships.
 *
 * A **404, not a 403**, for someone else's upload — the same choice the DM routes
 * make. "You may not read this" and "there is no such thing" must be
 * indistinguishable, or the error itself becomes a way to test which ids exist.
 */
export const handleServeUpload: RouteHandler = async (req, res, params, ctx) => {
  const id = params['id']!;
  const found = await ctx.manager.readUpload(id);
  if (!found) {
    sendJson(res, 404, { error: 'upload not found' });
    return;
  }
  const caller = readCaller(req);
  // An upload with NO owner is served to any member, deliberately. Those are
  // pre-existing files from before the field existed, and on a team pod they can
  // only have come from a member of that same team's workspace — refusing them
  // would break already-rendered images in already-sent messages to close a hole
  // that the unguessable id is still covering for them. New uploads all carry an
  // owner, so the ownerless set is closed and shrinks to nothing.
  if (caller && found.ownerUserId && found.ownerUserId !== caller.userId) {
    sendJson(res, 404, { error: 'upload not found' });
    return;
  }
  res.writeHead(200, {
    'Content-Type': found.mediaType,
    'Content-Length': String(found.bytes.length),
    // Uploads are immutable (content-addressed by random id).
    'Cache-Control': 'private, max-age=31536000, immutable',
  });
  res.end(Buffer.from(found.bytes));
};
