import { readBody, sendJson } from './utils.js';
import type { RouteHandler } from '../router.js';

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
  const ref = await ctx.manager.saveUpload({ bytes, mediaType, ...(filename ? { filename } : {}) });
  sendJson(res, 201, ref);
};

/** GET /api/uploads/:id — serve a stored upload's raw bytes for `<img>`/`<audio>`. */
export const handleServeUpload: RouteHandler = async (_req, res, params, ctx) => {
  const id = params['id']!;
  const found = await ctx.manager.readUpload(id);
  if (!found) {
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
