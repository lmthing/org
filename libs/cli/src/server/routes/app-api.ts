import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { createApiRuntime, type ApiRuntime } from '../../app/api/runtime.js';
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
 * built lazily per project and cached — a project with no `api/` dir simply 404s every
 * endpoint. `spawn` is wired to a Phase-3 seam (a runId placeholder); the real headless
 * agent runner arrives in Phase 6.
 *
 * Mounted BELOW the reserved top-level `/api/*` (which 404s before the static fallback),
 * and outside it, so there is no collision with the management API.
 */
export function createAppApiHandler(
  manager: SessionManager,
  lmthingRoot: string | undefined,
): (req: IncomingMessage, res: ServerResponse, params: Record<string, string>) => Promise<void> {
  const runtimes = new Map<string, ApiRuntime | null>();

  async function getRuntime(projectId: string): Promise<ApiRuntime | null> {
    let rt = runtimes.get(projectId);
    if (rt !== undefined) return rt;
    rt = null;
    if (lmthingRoot) {
      const projectDb = await manager.getProjectDb(lmthingRoot, projectId);
      if (projectDb) {
        rt = createApiRuntime({
          projectRoot: join(lmthingRoot, projectId),
          db: projectDb.async,
          // Phase-3 seam: return a runId placeholder. The real fire-and-forget agent
          // runner (SessionManager.runHeadless) is Phase 6; until then a spawned run
          // does not execute, so we do NOT fire onError (nothing failed — it deferred).
          spawnRunner: (ref: string) => {
            console.warn(`[app-api] spawn("${ref}") deferred — agent runner arrives in Phase 6`);
            return { runId: randomUUID() };
          },
        });
      }
    }
    runtimes.set(projectId, rt);
    return rt;
  }

  return async (req, res, params) => {
    const projectId = params['projectId']!;
    const rest = params['rest'] ?? ''; // the api sub-path, e.g. "feed-list" or "items/123"
    const method = (req.method ?? 'GET').toUpperCase();

    const runtime = await getRuntime(projectId);
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
