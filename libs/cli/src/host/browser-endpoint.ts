import { createServer, type Server } from 'node:http';
import type { HostBridge } from '../rpc/host-bridge.js';

/**
 * A loopback MCP endpoint that forwards to the attached desktop's browser.
 *
 * ## Why this is four dozen lines instead of a rewrite
 *
 * All 27 functions in `libs/core/system-spaces/system-browser/functions/` do exactly one thing:
 * POST a JSON-RPC `tools/call` body to the single URL in `process.env.LIGHTPANDA_MCP_URL`. Their
 * descriptions were migrated verbatim from Lightpanda's own catalog so the model sees what their
 * agent sees. So the cheapest correct way to give an agent the person's REAL browser — the one
 * logged into their accounts — is to become that URL and forward the body untouched.
 *
 * **Not one of those 27 files changes.** No new agent surface, no second tool catalog to keep in
 * sync, and no risk of the two drifting.
 *
 * Two facts make it work:
 * - `process.env` is snapshot-copied into each QuickJS VM at injection time
 *   (`libs/core/src/globals/host-tools.ts`), so setting the variable before a VM is created is
 *   enough — there is nothing to plumb.
 * - Their `fetch` is the sandbox yield, resolved host-side by real Node `fetch`
 *   (`libs/core/src/eval/fetch-yield.ts`), so a loopback address is reachable from inside the VM.
 *
 * ## Why loopback and NOT a route on the pod's router
 *
 * A `router.add(...)` route would pass through `guardRequest`, which 401s on a team pod, and would
 * expose a public surface for something that only ever talks to itself. Binding `127.0.0.1` on an
 * ephemeral port means the endpoint is unreachable from outside the pod at all.
 */
export interface BrowserEndpoint {
  /** The URL published to the VM as both browser endpoint variables. */
  url: string;
  close(): Promise<void>;
}

/**
 * The desktop browser's own variable, separate from `LIGHTPANDA_MCP_URL` on purpose.
 *
 * Both point at this same server, so why two? Because they answer different questions.
 * `LIGHTPANDA_MCP_URL` means "there is a browser somewhere" — a pod-side Lightpanda would set it
 * too, and the 27 wrappers are happy either way. `system-desktop-browser`'s functions need
 * something stronger: "the browser on the person's machine, the one they are watching". If they
 * read the Lightpanda variable, then on a pod with a headless browser and NO desktop attached they
 * would silently drive that instead — reporting tabs the person cannot see and clicks they cannot
 * watch, while every layer worked exactly as designed.
 *
 * With its own variable, the absence of a desktop is unambiguous, and the function says so.
 */
export const DESKTOP_BROWSER_ENV = 'LMTHING_DESKTOP_BROWSER_URL';

/** Long enough for a real page load over a WAN hop to somebody's laptop, plus the load itself. */
const BROWSER_TIMEOUT_MS = 60_000;

export async function startBrowserEndpoint(bridge: HostBridge): Promise<BrowserEndpoint> {
  const server: Server = createServer(async (req, res) => {
    if (req.method !== 'POST') {
      res.writeHead(405).end();
      return;
    }
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);

    let body: unknown;
    try {
      body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    } catch {
      res.writeHead(400, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'parse error' } }));
      return;
    }

    try {
      const value = await bridge.request({ type: 'browser.request', body }, { timeoutMs: BROWSER_TIMEOUT_MS });
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(value));
    } catch (err) {
      // Answered as a JSON-RPC ERROR rather than an HTTP failure: the wrappers read
      // `rpc.error.message` and surface it to the model, so "no desktop is connected" arrives as
      // something the agent can act on instead of as `HTTP 500`.
      const message = err instanceof Error ? err.message : String(err);
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(
        JSON.stringify({
          jsonrpc: '2.0',
          id: (body as { id?: unknown })?.id ?? 1,
          error: { code: -32000, message },
        }),
      );
    }
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const addr = server.address();
  const port = typeof addr === 'object' && addr ? addr.port : 0;
  const url = `http://127.0.0.1:${port}`;

  // Published for every VM created from now on. Deliberately NOT set when no desktop can ever
  // attach: `ensureLightpanda`'s own policy is that an explicit URL means "use that server, never
  // spawn", so setting it unconditionally would disable a pod-side Lightpanda if one is ever added.
  process.env['LIGHTPANDA_MCP_URL'] = url;
  process.env[DESKTOP_BROWSER_ENV] = url;

  return {
    url,
    close: () =>
      new Promise<void>((resolve) => {
        if (process.env['LIGHTPANDA_MCP_URL'] === url) delete process.env['LIGHTPANDA_MCP_URL'];
        // Unconditional, unlike the line above: nothing else ever sets this one, so a leftover
        // value could only ever point at a server that has closed.
        delete process.env[DESKTOP_BROWSER_ENV];
        server.close(() => resolve());
      }),
  };
}
