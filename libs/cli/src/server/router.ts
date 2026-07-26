import type { IncomingMessage, ServerResponse } from 'node:http';
import type { SessionManager, SessionEntry } from './session-manager.js';
import type { UiControlAction } from '../rpc/events.js';

/** Shared state threaded through every HTTP route handler. */
export interface ServerContext {
  manager: SessionManager;
  spacesRoot: string;
  effectiveLmthingRoot: string | undefined;
  broadcastUiControl: (entry: SessionEntry) => (action: UiControlAction) => void;
}

export type RouteHandler = (
  req: IncomingMessage,
  res: ServerResponse,
  params: Record<string, string>,
  ctx: ServerContext,
) => Promise<void>;

interface Route {
  method: string; // uppercase HTTP verb or '*'
  keys: string[];
  re: RegExp;
  handler: RouteHandler;
}

/**
 * Compile a route pattern into a RegExp + key list.
 * - `:param` matches one non-slash segment → captured as `param`
 * - trailing `/*` optionally captures the rest of the path (including slashes)
 *   as the key `rest`
 */
function compilePattern(pattern: string): { keys: string[]; re: RegExp } {
  const keys: string[] = [];
  let src: string;

  if (pattern.endsWith('/*')) {
    const base = pattern.slice(0, -2);
    src = base.replace(/:([a-zA-Z_]\w*)/g, (_, k) => { keys.push(k); return '([^/]+)'; });
    keys.push('rest');
    src += '(?:/(.*))?';
  } else {
    src = pattern.replace(/:([a-zA-Z_]\w*)/g, (_, k) => { keys.push(k); return '([^/]+)'; });
  }

  return { keys, re: new RegExp('^' + src + '$') };
}

export class Router {
  private routes: Route[] = [];

  add(method: string, pattern: string, handler: RouteHandler): void {
    const { keys, re } = compilePattern(pattern);
    this.routes.push({ method: method.toUpperCase(), keys, re, handler });
  }

  /**
   * Try to match `req` against registered routes. Returns `true` if matched
   * (handler is called asynchronously), `false` to signal fall-through.
   */
  dispatch(req: IncomingMessage, res: ServerResponse, ctx: ServerContext): boolean {
    const path = new URL(req.url ?? '/', 'http://localhost').pathname;
    const method = (req.method ?? 'GET').toUpperCase();

    for (const route of this.routes) {
      if (route.method !== '*' && route.method !== method) continue;
      const m = route.re.exec(path);
      if (!m) continue;
      const params: Record<string, string> = {};
      for (let i = 0; i < route.keys.length; i++) {
        params[route.keys[i]!] = decodeURIComponent(m[i + 1] ?? '');
      }
      // Promise.resolve() so a handler that is synchronous — or that throws
      // before its first await — is a 500, not an unhandled TypeError that
      // takes the whole single-process pod down with it.
      void Promise.resolve()
        .then(() => route.handler(req, res, params, ctx))
        .catch((err) => {
        try {
          res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }));
        } catch { /* already sent */ }
      });
      return true;
    }
    return false;
  }
}
