import { mkdir, writeFile, readFile, readdir } from 'node:fs/promises';
import { resolve, join, dirname, sep } from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { readBody, sendJson } from './utils.js';
import { isSafeRelPath } from '../projects.js';
import type { RouteHandler } from '../router.js';

export const handleFsTree: RouteHandler = async (
  _req: IncomingMessage,
  res: ServerResponse,
  _params: Record<string, string>,
  ctx,
): Promise<void> => {
  const fsRoot = resolve(ctx.effectiveLmthingRoot ?? process.cwd());
  const files: string[] = [];
  const EXCLUDED_DIRS = new Set(['.git', 'node_modules', '.cache']);

  async function walkFs(dir: string, rel: string): Promise<void> {
    let entries;
    try { entries = await readdir(dir, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      const name = entry.name;
      if (entry.isDirectory()) {
        if (EXCLUDED_DIRS.has(name)) continue;
        await walkFs(join(dir, name), rel ? `${rel}/${name}` : name);
      } else if (entry.isFile()) {
        files.push(rel ? `${rel}/${name}` : name);
      }
    }
  }

  await walkFs(fsRoot, '');
  sendJson(res, 200, { files });
};

export const handleFsRead: RouteHandler = async (
  req: IncomingMessage,
  res: ServerResponse,
  _params: Record<string, string>,
  ctx,
): Promise<void> => {
  const fsRoot = resolve(ctx.effectiveLmthingRoot ?? process.cwd());
  const url = new URL(req.url ?? '/', 'http://localhost');
  const filePath = url.searchParams.get('path') ?? '';
  if (!isSafeRelPath(filePath)) { sendJson(res, 400, { error: 'invalid path' }); return; }
  const abs = resolve(fsRoot, filePath);
  if (abs !== fsRoot && !abs.startsWith(fsRoot + sep)) { sendJson(res, 400, { error: 'path traversal' }); return; }
  let content = '';
  try { content = await readFile(abs, 'utf8'); } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') { sendJson(res, 404, { error: 'file not found' }); return; }
    sendJson(res, 400, { error: 'cannot read file (binary or unreadable)' }); return;
  }
  sendJson(res, 200, { content });
};

export const handleFsWrite: RouteHandler = async (
  req: IncomingMessage,
  res: ServerResponse,
  _params: Record<string, string>,
  ctx,
): Promise<void> => {
  const fsRoot = resolve(ctx.effectiveLmthingRoot ?? process.cwd());
  let parsed: { path?: unknown; content?: unknown };
  try { parsed = JSON.parse((await readBody(req)) || '{}') as { path?: unknown; content?: unknown }; }
  catch { sendJson(res, 400, { error: 'invalid JSON body' }); return; }
  const filePath = typeof parsed.path === 'string' ? parsed.path : '';
  const content = typeof parsed.content === 'string' ? parsed.content : '';
  if (!isSafeRelPath(filePath)) { sendJson(res, 400, { error: 'invalid path' }); return; }
  const abs = resolve(fsRoot, filePath);
  if (abs !== fsRoot && !abs.startsWith(fsRoot + sep)) { sendJson(res, 400, { error: 'path traversal' }); return; }
  try {
    await mkdir(dirname(abs), { recursive: true });
    await writeFile(abs, content, 'utf8');
  } catch (err) {
    sendJson(res, 500, { error: err instanceof Error ? err.message : String(err) }); return;
  }
  sendJson(res, 200, { ok: true });
};
