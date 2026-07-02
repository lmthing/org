import { createRequire } from 'node:module';
import { join } from 'node:path';
import type { Server, IncomingMessage, ServerResponse } from 'node:http';

export interface DevWeb {
  /** Handle a non-/api request through Vite (transformed modules, HMR, SPA fallback). */
  handle(req: IncomingMessage, res: ServerResponse): void;
  close(): Promise<void>;
}

/**
 * Dev only: run the web app via an IN-PROCESS Vite dev server (middleware mode),
 * so the CLI serves it — with full HMR — on its OWN port. There is no second
 * dev-server port: Vite's HMR websocket is attached to the CLI's httpServer, so
 * the browser only ever talks to the CLI origin (e.g. http://localhost:8080).
 *
 * Enabled by `LM_DEV_WEB=<abs path to apps/web>` (set by `pnpm thing`). Unset in
 * production, where the built dist is served statically by `createStaticApps`.
 *
 * `vite-plus` is required at runtime (never bundled into / needed by prod).
 */
export async function createDevWeb(appDir: string, httpServer: Server): Promise<DevWeb> {
  // Require Vite (CJS) from the web app's own node_modules (it's a devDep there,
  // not of @lmthing/cli). `createRequire` keeps it out of the CLI bundle.
  const req = createRequire(join(appDir, 'package.json'));
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { createServer } = req('vite-plus') as { createServer: (opts: any) => Promise<any> };
  const vite = await createServer({
    root: appDir,
    appType: 'spa', // Vite serves index.html + SPA fallback + HMR client injection.
    server: {
      middlewareMode: true,
      // Attach HMR to the CLI's HTTP server → HMR ws rides the same origin/port.
      hmr: { server: httpServer },
    },
  });
  return {
    handle(req: IncomingMessage, res: ServerResponse): void {
      vite.middlewares(req, res, () => {
        if (!res.headersSent) res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('not found');
      });
    },
    close: () => vite.close() as Promise<void>,
  };
}
