import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { sendJson } from './utils.js';
import type { RouteHandler } from '../router.js';

export const handlePricesAzure: RouteHandler = async (
  _req: IncomingMessage,
  res: ServerResponse,
): Promise<void> => {
  try {
    // Resolve relative to this file so it works regardless of cwd.
    // In the tsup bundle all chunks land in dist/, so '../prices/azure.json'
    // from dist/ correctly points to packages/cli/prices/azure.json.
    // tsup bundles all chunks flat into dist/, so one level up lands in packages/cli/
    const pricesPath = join(dirname(fileURLToPath(import.meta.url)), '../prices/azure.json');
    const raw = readFileSync(pricesPath, 'utf8');
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(raw);
  } catch {
    sendJson(res, 404, { error: 'prices not available' });
  }
};
