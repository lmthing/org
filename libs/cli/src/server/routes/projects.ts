import type { IncomingMessage, ServerResponse } from 'node:http';
import { readBody, sendJson } from './utils.js';
import { isSafeRelPath, safeProjectId } from '../projects.js';
import type { RouteHandler } from '../router.js';

export const handleListProjects: RouteHandler = async (
  _req: IncomingMessage,
  res: ServerResponse,
  _params: Record<string, string>,
  ctx,
): Promise<void> => {
  try {
    const projects = await ctx.manager.listProjects();
    sendJson(res, 200, { projects });
  } catch (err) {
    sendJson(res, 503, { error: err instanceof Error ? err.message : String(err) });
  }
};

export const handleCreateProject: RouteHandler = async (
  req: IncomingMessage,
  res: ServerResponse,
  _params: Record<string, string>,
  ctx,
): Promise<void> => {
  let parsed: { name?: unknown };
  try {
    parsed = JSON.parse((await readBody(req)) || '{}') as { name?: unknown };
  } catch {
    sendJson(res, 400, { error: 'invalid JSON body' }); return;
  }
  if (typeof parsed.name !== 'string' || parsed.name.trim().length === 0) {
    sendJson(res, 400, { error: 'name must be a non-empty string' }); return;
  }
  try {
    const meta = await ctx.manager.createProject(parsed.name.trim());
    sendJson(res, 201, { id: meta.id });
  } catch (err) {
    sendJson(res, 400, { error: err instanceof Error ? err.message : String(err) });
  }
};

export const handleDeleteProject: RouteHandler = async (
  _req: IncomingMessage,
  res: ServerResponse,
  params: Record<string, string>,
  ctx,
): Promise<void> => {
  const rawId = params['projectId']!;
  if (rawId === 'user') {
    sendJson(res, 400, { error: 'cannot delete the default project' }); return;
  }
  try {
    await ctx.manager.deleteProject(rawId);
    res.writeHead(204); res.end();
  } catch (err) {
    sendJson(res, 400, { error: err instanceof Error ? err.message : String(err) });
  }
};

export const handleGetProjectInstructions: RouteHandler = async (
  _req: IncomingMessage,
  res: ServerResponse,
  params: Record<string, string>,
  ctx,
): Promise<void> => {
  const rawId = params['projectId']!;
  try {
    const content = await ctx.manager.getInstructions(rawId);
    sendJson(res, 200, { content });
  } catch (err) {
    sendJson(res, 400, { error: err instanceof Error ? err.message : String(err) });
  }
};

export const handlePutProjectInstructions: RouteHandler = async (
  req: IncomingMessage,
  res: ServerResponse,
  params: Record<string, string>,
  ctx,
): Promise<void> => {
  const rawId = params['projectId']!;
  let parsed: { content?: unknown };
  try {
    parsed = JSON.parse((await readBody(req)) || '{}') as { content?: unknown };
  } catch {
    sendJson(res, 400, { error: 'invalid JSON body' }); return;
  }
  const content = typeof parsed.content === 'string' ? parsed.content : '';
  try {
    await ctx.manager.setInstructions(rawId, content);
    sendJson(res, 200, { ok: true });
  } catch (err) {
    sendJson(res, 400, { error: err instanceof Error ? err.message : String(err) });
  }
};

export const handleListDocuments: RouteHandler = async (
  _req: IncomingMessage,
  res: ServerResponse,
  params: Record<string, string>,
  ctx,
): Promise<void> => {
  const rawId = params['projectId']!;
  try {
    const documents = await ctx.manager.listDocuments(rawId);
    sendJson(res, 200, { documents });
  } catch (err) {
    sendJson(res, 400, { error: err instanceof Error ? err.message : String(err) });
  }
};

export const handleCreateDocument: RouteHandler = async (
  req: IncomingMessage,
  res: ServerResponse,
  params: Record<string, string>,
  ctx,
): Promise<void> => {
  const rawId = params['projectId']!;
  let parsed: { name?: unknown; content?: unknown };
  try {
    parsed = JSON.parse((await readBody(req)) || '{}') as { name?: unknown; content?: unknown };
  } catch {
    sendJson(res, 400, { error: 'invalid JSON body' }); return;
  }
  if (typeof parsed.name !== 'string' || parsed.name.trim().length === 0) {
    sendJson(res, 400, { error: 'name must be a non-empty string' }); return;
  }
  const content = typeof parsed.content === 'string' ? parsed.content : '';
  try {
    await ctx.manager.addDocument(rawId, parsed.name.trim(), content);
    sendJson(res, 201, { ok: true });
  } catch (err) {
    sendJson(res, 400, { error: err instanceof Error ? err.message : String(err) });
  }
};

export const handleListProjectSessions: RouteHandler = async (
  _req: IncomingMessage,
  res: ServerResponse,
  params: Record<string, string>,
  ctx,
): Promise<void> => {
  const rawId = params['projectId']!;
  try {
    const sessions = await ctx.manager.listProjectSessions(rawId);
    sendJson(res, 200, { sessions });
  } catch (err) {
    sendJson(res, 400, { error: err instanceof Error ? err.message : String(err) });
  }
};

export const handleListSpaceSessions: RouteHandler = async (
  _req: IncomingMessage,
  res: ServerResponse,
  params: Record<string, string>,
  ctx,
): Promise<void> => {
  const rawId = params['projectId']!;
  const spaceId = params['spaceId']!;
  if (!safeProjectId(spaceId)) {
    sendJson(res, 400, { error: `invalid space id: ${spaceId}` }); return;
  }
  try {
    const sessions = await ctx.manager.listSpaceSessions(rawId, spaceId);
    sendJson(res, 200, { sessions });
  } catch (err) {
    sendJson(res, 400, { error: err instanceof Error ? err.message : String(err) });
  }
};

export const handleGetProjectSpaceFiles: RouteHandler = async (
  _req: IncomingMessage,
  res: ServerResponse,
  params: Record<string, string>,
  ctx,
): Promise<void> => {
  const rawId = params['projectId']!;
  const spaceId = params['spaceId']!;
  if (!safeProjectId(spaceId)) {
    sendJson(res, 400, { error: `invalid space id: ${spaceId}` }); return;
  }
  try {
    const files = await ctx.manager.readProjectSpaceFiles(rawId, spaceId);
    sendJson(res, 200, { files });
  } catch (err) {
    sendJson(res, 400, { error: err instanceof Error ? err.message : String(err) });
  }
};

export const handlePutProjectSpaceFiles: RouteHandler = async (
  req: IncomingMessage,
  res: ServerResponse,
  params: Record<string, string>,
  ctx,
): Promise<void> => {
  const rawId = params['projectId']!;
  const spaceId = params['spaceId']!;
  if (!safeProjectId(spaceId)) {
    sendJson(res, 400, { error: `invalid space id: ${spaceId}` }); return;
  }
  let parsed: { files?: unknown };
  try {
    parsed = JSON.parse((await readBody(req)) || '{}') as { files?: unknown };
  } catch {
    sendJson(res, 400, { error: 'invalid JSON body' }); return;
  }
  const files = (parsed.files ?? {}) as Record<string, unknown>;
  if (typeof files !== 'object' || files === null || Array.isArray(files)) {
    sendJson(res, 400, { error: 'files must be an object' }); return;
  }
  for (const rel of Object.keys(files)) {
    if (!isSafeRelPath(rel)) { sendJson(res, 400, { error: `unsafe file path: ${rel}` }); return; }
  }
  const normalized: Record<string, string> = {};
  for (const [rel, content] of Object.entries(files)) {
    normalized[rel] = typeof content === 'string' ? content : String(content ?? '');
  }
  try {
    await ctx.manager.writeProjectSpaceFiles(rawId, spaceId, normalized);
    sendJson(res, 200, { ok: true });
  } catch (err) {
    sendJson(res, 400, { error: err instanceof Error ? err.message : String(err) });
  }
};

export const handlePostProjectSpaceFile: RouteHandler = async (
  req: IncomingMessage,
  res: ServerResponse,
  params: Record<string, string>,
  ctx,
): Promise<void> => {
  const rawId = params['projectId']!;
  const spaceId = params['spaceId']!;
  if (!safeProjectId(spaceId)) {
    sendJson(res, 400, { error: `invalid space id: ${spaceId}` }); return;
  }
  let parsed: { path?: unknown; content?: unknown };
  try {
    parsed = JSON.parse((await readBody(req)) || '{}') as { path?: unknown; content?: unknown };
  } catch {
    sendJson(res, 400, { error: 'invalid JSON body' }); return;
  }
  if (typeof parsed.path !== 'string' || parsed.path.length === 0) {
    sendJson(res, 400, { error: 'path must be a non-empty string' }); return;
  }
  const content = typeof parsed.content === 'string' ? parsed.content : String(parsed.content ?? '');
  try {
    await ctx.manager.writeProjectSpaceFile(rawId, spaceId, parsed.path, content);
    sendJson(res, 201, { ok: true });
  } catch (err) {
    sendJson(res, 400, { error: err instanceof Error ? err.message : String(err) });
  }
};

export const handlePutProjectSpaceFile: RouteHandler = async (
  req: IncomingMessage,
  res: ServerResponse,
  params: Record<string, string>,
  ctx,
): Promise<void> => {
  const rawId = params['projectId']!;
  const spaceId = params['spaceId']!;
  const relPath = params['rest']!;
  if (!safeProjectId(spaceId)) {
    sendJson(res, 400, { error: `invalid space id: ${spaceId}` }); return;
  }
  const raw = await readBody(req);
  let content: string;
  try {
    const parsed = JSON.parse(raw || '{}') as { content?: unknown };
    content = typeof parsed.content === 'string' ? parsed.content : raw;
  } catch {
    // Not JSON — treat the body itself as the raw file content.
    content = raw;
  }
  try {
    await ctx.manager.writeProjectSpaceFile(rawId, spaceId, relPath, content);
    sendJson(res, 200, { ok: true });
  } catch (err) {
    sendJson(res, 400, { error: err instanceof Error ? err.message : String(err) });
  }
};

export const handleDeleteProjectSpaceFile: RouteHandler = async (
  _req: IncomingMessage,
  res: ServerResponse,
  params: Record<string, string>,
  ctx,
): Promise<void> => {
  const rawId = params['projectId']!;
  const spaceId = params['spaceId']!;
  const relPath = params['rest']!;
  if (!safeProjectId(spaceId)) {
    sendJson(res, 400, { error: `invalid space id: ${spaceId}` }); return;
  }
  try {
    await ctx.manager.deleteProjectSpaceFile(rawId, spaceId, relPath);
    res.writeHead(204); res.end();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const code = (err as { code?: string } | undefined)?.code;
    if (code === 'ENOENT') {
      sendJson(res, 404, { error: `file not found: ${relPath}` });
    } else {
      sendJson(res, 400, { error: message });
    }
  }
};

export const handleListProjectSpaces: RouteHandler = async (
  _req: IncomingMessage,
  res: ServerResponse,
  params: Record<string, string>,
  ctx,
): Promise<void> => {
  const rawId = params['projectId']!;
  try {
    const spaces = await ctx.manager.listProjectSpaces(rawId);
    sendJson(res, 200, { spaces });
  } catch (err) {
    sendJson(res, 400, { error: err instanceof Error ? err.message : String(err) });
  }
};

export const handleGetProjectCompletions: RouteHandler = async (
  _req: IncomingMessage,
  res: ServerResponse,
  params: Record<string, string>,
  ctx,
): Promise<void> => {
  const rawId = params['projectId']!;
  try {
    const completions = await ctx.manager.getAutocompleteWords(rawId);
    sendJson(res, 200, { completions });
  } catch (err) {
    sendJson(res, 400, { error: err instanceof Error ? err.message : String(err) });
  }
};
