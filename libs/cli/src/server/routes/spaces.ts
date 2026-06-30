import { mkdir, writeFile, rm } from 'node:fs/promises';
import { resolve, join, dirname, sep } from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { readBody, sendJson } from './utils.js';
import { isSafeRelPath } from '../projects.js';
import type { RouteHandler } from '../router.js';

/** A space name must be a single safe path segment (no separators, no traversal). */
function safeSpaceName(name: unknown): string | null {
  if (typeof name !== 'string' || name.length === 0 || name.length > 200) return null;
  if (name.includes('/') || name.includes('\\') || name.includes('\0')) return null;
  if (name === '.' || name === '..') return null;
  return name;
}

/**
 * POST /api/spaces — write an edited space to disk so a session can load it.
 * Body: { name: string, files: Record<relativePath, content> }. The target
 * dir is wiped first so deletions in the editor are reflected. Returns the
 * absolute spaceDir to pass as POST /api/sessions { spaceDir }.
 */
export const handleCreateSpace: RouteHandler = async (
  req: IncomingMessage,
  res: ServerResponse,
  _params: Record<string, string>,
  ctx,
): Promise<void> => {
  let parsed: { name?: unknown; files?: unknown };
  try {
    parsed = JSON.parse((await readBody(req)) || '{}') as { name?: unknown; files?: unknown };
  } catch {
    sendJson(res, 400, { error: 'invalid JSON body' });
    return;
  }
  const name = safeSpaceName(parsed.name);
  if (!name) { sendJson(res, 400, { error: 'invalid or missing space name' }); return; }
  const files = (parsed.files ?? {}) as Record<string, unknown>;
  if (typeof files !== 'object' || files === null) { sendJson(res, 400, { error: 'files must be an object' }); return; }
  for (const rel of Object.keys(files)) {
    if (!isSafeRelPath(rel)) { sendJson(res, 400, { error: `unsafe file path: ${rel}` }); return; }
  }

  const target = resolve(ctx.spacesRoot, name);
  if (target !== join(ctx.spacesRoot, name)) { sendJson(res, 400, { error: 'invalid space name' }); return; }

  await rm(target, { recursive: true, force: true });
  await mkdir(target, { recursive: true });
  for (const [rel, content] of Object.entries(files)) {
    const dest = resolve(target, rel);
    if (dest !== target && !dest.startsWith(target + sep)) { sendJson(res, 400, { error: `unsafe file path: ${rel}` }); return; }
    await mkdir(dirname(dest), { recursive: true });
    await writeFile(dest, typeof content === 'string' ? content : String(content ?? ''), 'utf8');
  }
  sendJson(res, 201, { spaceDir: target });
};
