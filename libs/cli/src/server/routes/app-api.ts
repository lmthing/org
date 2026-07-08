import type { IncomingMessage, ServerResponse } from 'node:http';
import type { SessionManager } from '../session-manager.js';
import { readBody, sendJson } from './utils.js';

const QUERY_METHODS = new Set(['GET', 'DELETE']);

/**
 * Mount the project-app API runtime at `/app/<project>/api/*` (Phase 3).
 *
 * This is the browser-facing surface of a project's `api/` handlers — dual-addressed
 * with the agent's `apiCall` (which enters the SAME runtime by endpoint `name`). Each
 * handler runs Node, WORKER-ISOLATED (a crash boundary, see app/api/runtime.ts); its
 * `ctx.db` executes against the project's main-process db (Phase 2). The runtime is
 * built lazily per project and cached (owned by {@link SessionManager.getApiRuntime}) —
 * a project with no `api/` dir simply 404s every endpoint. The SAME runtime backs the
 * agent-facing `apiCall` global; its `spawn` seam runs a real fire-and-forget headless
 * agent (`SessionManager.runHeadless`).
 *
 * Mounted BELOW the reserved top-level `/api/*` (which 404s before the static fallback),
 * and outside it, so there is no collision with the management API.
 */
export function createAppApiHandler(
  manager: SessionManager,
  lmthingRoot: string | undefined,
): (req: IncomingMessage, res: ServerResponse, params: Record<string, string>) => Promise<void> {
  return async (req, res, params) => {
    const projectId = params['projectId']!;
    const rest = params['rest'] ?? ''; // the api sub-path, e.g. "feed-list" or "items/123"
    const method = (req.method ?? 'GET').toUpperCase();

    const runtime = lmthingRoot ? await manager.getApiRuntime(lmthingRoot, projectId) : null;
    if (!runtime) {
      sendJson(res, 404, { error: { status: 404, message: `project "${projectId}" has no app api` } });
      return;
    }

    // Method-aware payload: GET/DELETE carry input in the query string; the rest in the
    // JSON body. The runtime does the path ∪ query/body assembly + validation internally.
    let input: unknown;
    if (QUERY_METHODS.has(method)) {
      const url = new URL(req.url ?? '/', 'http://localhost');
      input = Object.fromEntries(url.searchParams);
    } else {
      const raw = await readBody(req);
      try {
        input = raw ? JSON.parse(raw) : {};
      } catch {
        sendJson(res, 400, { error: { status: 400, message: 'invalid JSON body' } });
        return;
      }
    }

    const result = await runtime.handle(method, '/' + rest, input);
    sendJson(res, result.status, result.body);
  };
}
