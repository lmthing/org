import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { readBody, sendJson } from './utils.js';
import type { RouteHandler } from '../router.js';

/**
 * Parse KEY=VALUE lines from a .env-style string and apply them to process.env.
 * Exported so serve.ts can call it at startup to restore the persisted env.
 */
export function applyEnvContent(content: string): void {
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1);
    if (key) process.env[key] = value;
  }
}

export const handleEnvGet: RouteHandler = async (
  _req: IncomingMessage,
  res: ServerResponse,
): Promise<void> => {
  const envFilePath = resolve(process.cwd(), '.env');
  let content = '';
  try {
    content = readFileSync(envFilePath, 'utf8');
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
  }
  sendJson(res, 200, { content });
};

export const handleEnvPut: RouteHandler = async (
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> => {
  const envFilePath = resolve(process.cwd(), '.env');
  let parsed: { content?: unknown };
  try {
    parsed = JSON.parse((await readBody(req)) || '{}') as { content?: unknown };
  } catch {
    sendJson(res, 400, { error: 'invalid JSON body' });
    return;
  }
  const content = typeof parsed.content === 'string' ? parsed.content : '';
  writeFileSync(envFilePath, content, 'utf8');
  applyEnvContent(content);
  sendJson(res, 200, { ok: true });
};
