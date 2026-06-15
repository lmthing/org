import { createServer } from 'node:http';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { readFileSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { createRequire } from 'node:module';
import { WebSocketServer, WebSocket } from 'ws';
import { build } from 'esbuild';
import { loadSpace } from '@lmthing/core';
import type { Space } from '@lmthing/core';
import { TraceHub } from '../rpc/trace-hub.js';
import { handleAgentApi, agentApiContextFromEntry } from '../web/agent-api.js';
import type { ServerEvent, ClientMessage, UiControlAction } from '../rpc/events.js';
import type { SessionManager, SessionEntry } from './session-manager.js';

export interface SessionServerOpts {
  port: number;
  manager: SessionManager;
  /** dist/web/app.tsx anchor — used to resolve react/@lmthing/agent-ui from the CLI root. */
  appTsxPath: string;
  /** Default space dir used when POST /api/sessions omits one (also for bundling the app). */
  defaultSpaceDir?: string;
}

// ─── esbuild app bundling (mirrors web/serve.ts) ──────────────────────────────

function resolveUiAssets(appTsxPath: string): { aliases: Record<string, string>; appEntry: string; cssPath: string; resolveDir: string } {
  const cliRoot = join(appTsxPath, '..', '..', '..'); // packages/cli/
  const req = createRequire(join(cliRoot, 'package.json'));
  const aliases: Record<string, string> = {};
  for (const pkg of ['react', 'react-dom', 'react/jsx-runtime', 'react-dom/client']) {
    try { aliases[pkg] = req.resolve(pkg); } catch { /* skip */ }
  }
  const uiPkgJson = req.resolve('@lmthing/agent-ui/package.json');
  const uiRoot = dirname(uiPkgJson);
  const appEntry = join(uiRoot, 'src', 'app', 'main.tsx');
  const cssPath = join(uiRoot, 'dist-web', 'app.css');
  aliases['ink'] = join(uiRoot, 'src', 'compat', 'ink.tsx');
  aliases['ink-text-input'] = join(uiRoot, 'src', 'compat', 'inputs.tsx');
  aliases['ink-select-input'] = join(uiRoot, 'src', 'compat', 'inputs.tsx');
  return { aliases, appEntry, cssPath, resolveDir: cliRoot };
}

function readThemeCss(spaceDir: string): string {
  try {
    const raw = JSON.parse(readFileSync(join(spaceDir, 'theme.json'), 'utf8')) as Record<string, string>;
    const vars = Object.entries(raw)
      .map(([k, v]) => {
        const name = k.startsWith('--') ? k : `--lm-${k}`;
        return `${name}:${v};${name.replace('--lm-', '--color-lm-')}:${v};`;
      })
      .join('');
    return `:root{${vars}}`;
  } catch {
    return '';
  }
}

async function buildBundle(space: Space, wsBase: string, appTsxPath: string): Promise<string> {
  // Bundle every form component across the default space's agents so the served
  // app can render space components for whatever session is attached.
  const { aliases, appEntry, resolveDir } = resolveUiAssets(appTsxPath);

  const importLines: string[] = [];
  const compEntries: string[] = [];
  const seen = new Set<string>();
  for (const name of Object.keys(space.components.form)) {
    if (seen.has(name)) continue;
    seen.add(name);
    const webPath = resolve(space.dir, 'components', 'form', name, 'web.tsx');
    importLines.push(`import __Comp_${name}__ from ${JSON.stringify(webPath)};`);
    compEntries.push(`  ${JSON.stringify(name)}: __Comp_${name}__,`);
  }

  // The bundle does NOT hardcode the WS URL — the inline bootstrap in the HTML
  // reads sessionId from the query string and sets window.__WS_URL__ first.
  const entry = [
    `import React from 'react';`,
    `import { mountApp } from ${JSON.stringify(appEntry)};`,
    ...importLines,
    `window.__SPACE_COMPONENTS__ = {`,
    ...compEntries,
    `};`,
    `window.__LMTHING_REACT__ = React;`,
    `mountApp();`,
  ].join('\n');

  const result = await build({
    stdin: { contents: entry, loader: 'tsx', resolveDir, sourcefile: 'virtual-entry.tsx' },
    bundle: true,
    write: false,
    format: 'iife',
    jsx: 'automatic',
    define: { 'process.env.NODE_ENV': '"production"' },
    platform: 'browser',
    logLevel: 'error',
    alias: aliases,
  });
  void wsBase;
  return result.outputFiles[0]!.text;
}

function readCss(appTsxPath: string): string {
  try {
    const { cssPath } = resolveUiAssets(appTsxPath);
    return readFileSync(cssPath, 'utf8');
  } catch {
    return '';
  }
}

function buildHtml(js: string, css: string, port: number, themeCss = ''): string {
  // Bootstrap reads sessionId from the page query string and points the app's WS
  // at /api/ws?sessionId=<id> for that session before the app bundle mounts.
  const bootstrap = `(function(){
    var p = new URLSearchParams(location.search);
    var sid = p.get('sessionId') || '';
    var proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    window.__WS_URL__ = proto + '//' + location.host + '/api/ws' + (sid ? '?sessionId=' + encodeURIComponent(sid) : '');
  })();`;
  return `<!DOCTYPE html>
<html lang="en" data-theme="dark">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>LMThing</title>
  <style>*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }</style>
  <style>${css}</style>
  ${themeCss ? `<style>${themeCss}</style>` : ''}
</head>
<body>
  <div id="root"></div>
  <script>${bootstrap}</script>
  <script>${js}</script>
</body>
</html>`;
}

// ─── HTTP helpers ─────────────────────────────────────────────────────────────

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  return Buffer.concat(chunks).toString('utf8');
}

function sendJson(res: ServerResponse, status: number, obj: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(obj));
}

/** SESSION_RE matches /api/sessions/<id>[/<rest>] capturing id + rest. */
const SESSION_RE = /^\/api\/sessions\/([^/]+)(\/.*)?$/;

/**
 * Multi-session HTTP + WS server. One server hosts many independent agent
 * sessions; each has its OWN renderHost + hub (in the SessionManager), so events
 * never cross sessions. The served app reads sessionId from the query string.
 */
export async function startSessionServer(opts: SessionServerOpts): Promise<void> {
  const { manager, port } = opts;
  const wsBase = `ws://localhost:${port}`;

  // Bundle the app against the default space (for its form components + CSS).
  const defaultSpaceDir = opts.defaultSpaceDir;
  let html = '';
  if (defaultSpaceDir) {
    console.log('Bundling web app…');
    const space = await loadSpace(defaultSpaceDir);
    const js = await buildBundle(space, wsBase, opts.appTsxPath);
    const css = readCss(opts.appTsxPath);
    html = buildHtml(js, css, port, readThemeCss(space.dir));
  }

  const broadcastUiControl = (entry: SessionEntry): ((action: UiControlAction) => void) =>
    (action) => entry.renderHost.emit({ type: 'ui_control', action });

  const httpServer = createServer((req, res) => {
    void handleHttp(req, res).catch((err) => {
      try { sendJson(res, 500, { error: err instanceof Error ? err.message : String(err) }); } catch { /* already sent */ }
    });
  });

  async function handleHttp(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const reqUrl = req.url ?? '/';
    const url = new URL(reqUrl, 'http://localhost');
    const path = url.pathname;
    const method = req.method ?? 'GET';

    // ─── Session lifecycle (collection-level) ───
    if (path === '/api/sessions' && method === 'POST') {
      const body = await readBody(req);
      const parsed = JSON.parse(body || '{}') as {
        spaceDir?: string; agentSlug?: string; model?: string;
        budget?: { maxEpisodes?: number; maxToolCalls?: number; maxForkDepth?: number; maxWallClockMs?: number };
      };
      try {
        const { sessionId } = manager.createSession({
          spaceDir: parsed.spaceDir,
          agentSlug: parsed.agentSlug,
          model: parsed.model,
          budget: parsed.budget,
        });
        sendJson(res, 201, { sessionId });
      } catch (err) {
        sendJson(res, 400, { error: err instanceof Error ? err.message : String(err) });
      }
      return;
    }
    if (path === '/api/sessions' && method === 'GET') {
      sendJson(res, 200, { sessions: manager.listSessions() });
      return;
    }

    // ─── Per-session routes: /api/sessions/:id[/rest] ───
    const m = SESSION_RE.exec(path);
    if (m) {
      const id = decodeURIComponent(m[1]!);
      const rest = m[2] ?? ''; // '' | '/state' | '/node/x' | '/events' | '/asks' | '/message' | '/ask/y'
      const entry = manager.getSession(id);

      if (rest === '' && method === 'DELETE') {
        if (!entry) { sendJson(res, 404, { error: `unknown session "${id}"` }); return; }
        await manager.disposeSession(id);
        sendJson(res, 200, { ok: true });
        return;
      }

      if (!entry) { sendJson(res, 404, { error: `unknown session "${id}"` }); return; }

      // Map the per-session sub-path onto the canonical /api/<rest> route so the
      // existing agent-api handlers are reused unchanged.
      const pathOverride = `/api${rest}`;
      const ctx = agentApiContextFromEntry(entry, {
        sendMessage: (content) => manager.sendMessage(id, content),
        broadcastUiControl: broadcastUiControl(entry),
      });
      const handled = await handleAgentApi(req, res, ctx, { pathOverride });
      if (!handled) sendJson(res, 404, { error: `unknown API route ${method} ${path}` });
      return;
    }

    // ─── Unknown /api/* ───
    if (path.startsWith('/api/')) {
      sendJson(res, 404, { error: `unknown API route ${method} ${path}` });
      return;
    }

    // ─── Static app ───
    if (!html) {
      res.writeHead(503, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('no default space configured — pass --space to serve the UI');
      return;
    }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(html);
  }

  // ─── WebSocket: /api/ws?sessionId=<id> ───
  const wss = new WebSocketServer({ noServer: true });
  httpServer.on('upgrade', (req, socket, head) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    if (url.pathname !== '/api/ws') { socket.destroy(); return; }
    const id = url.searchParams.get('sessionId') ?? '';
    const entry = manager.getSession(id);
    if (!entry) {
      // Unknown session — refuse the upgrade with 404.
      socket.write('HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n');
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      registerSocket(ws, entry);
    });
  });

  function registerSocket(ws: WebSocket, entry: SessionEntry): void {
    entry.renderHost.addClient(ws);

    // Attach this entry's hub to the socket; detach on close.
    const sink = {
      send: (msg: string) => { if (ws.readyState === WebSocket.OPEN) ws.send(msg); },
      get bufferedAmount() { return ws.bufferedAmount; },
      isOpen: () => ws.readyState === WebSocket.OPEN,
    };
    entry.hub.attach(sink);
    ws.on('close', () => entry.hub.detach(sink));

    const send = (e: ServerEvent) => { if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(e)); };
    send({
      type: 'hello',
      protocolVersion: 1,
      sessionId: entry.sessionId,
      spaceName: entry.spaceDir,
      agentSlug: entry.agentSlug,
      traceAvailable: false,
    });
    const snap = entry.hub.snapshot();
    send({ type: 'trace_snapshot', events: snap.events, lastSeq: snap.lastSeq, truncatedBefore: snap.truncatedBefore });
    const asks = entry.renderHost.pendingAsks();
    if (asks.length > 0) send({ type: 'ask_pending', asks });

    ws.on('message', (data: Buffer) => {
      let msg: ClientMessage;
      try { msg = JSON.parse(data.toString()) as ClientMessage; } catch { return; }
      switch (msg.type) {
        case 'sendMessage':
          manager.sendMessage(entry.sessionId, msg.content ?? '');
          break;
        case 'submitForm':
          entry.renderHost.submitForm(msg.id, msg.value);
          break;
        case 'cancelAsk':
          entry.renderHost.cancelAsk(msg.id);
          break;
        case 'subscribeTrace': {
          const since = entry.hub.snapshotSince(msg.sinceSeq ?? 0);
          send({ type: 'trace_snapshot', events: since.events, lastSeq: since.lastSeq, truncatedBefore: since.truncatedBefore });
          break;
        }
      }
    });
  }

  await new Promise<void>((res) => httpServer.listen(port, res));
  const httpBase = `http://localhost:${port}`;
  console.log(`Multi-session server ready: ${httpBase}`);
  console.log(`Create a session:  POST ${httpBase}/api/sessions`);
}
