import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { createRequire } from 'node:module';
import { WebSocketServer, WebSocket } from 'ws';
import { build } from 'esbuild';
import { WebRenderHost } from '../rpc/server.js';
import { TraceHub } from '../rpc/trace-hub.js';
import { handleAgentApi } from './agent-api.js';
import type { ServerEvent, ClientMessage, UiControlAction } from '../rpc/events.js';
import type { Session, Space } from '@repl/core';

export interface WebServerOpts {
  port: number;
  session: Session;
  renderHost: WebRenderHost;
  space: Space;
  agentSlug: string;
  /** Path anchor used to resolve the CLI package root (and from it, @repl/ui). */
  appTsxPath: string;
  /** Optional --trace file path; when set, served at /trace.jsonl for ?trace= replay. */
  traceFile?: string;
}

/** Resolve react/react-dom + the @repl/ui app entry & prebuilt CSS, all from the
 *  CLI package root so a single React instance is shared across the app and the
 *  runtime-bundled space components (no second copy → hooks work). */
function resolveUiAssets(appTsxPath: string): { aliases: Record<string, string>; appEntry: string; cssPath: string; resolveDir: string } {
  const cliRoot = join(appTsxPath, '..', '..', '..'); // packages/cli/
  const req = createRequire(join(cliRoot, 'package.json'));
  const aliases: Record<string, string> = {};
  for (const pkg of ['react', 'react-dom', 'react/jsx-runtime', 'react-dom/client']) {
    try { aliases[pkg] = req.resolve(pkg); } catch { /* skip */ }
  }
  // @repl/ui app entry (TSX source — bundled fresh) + prebuilt CSS.
  const uiPkgJson = req.resolve('@repl/ui/package.json');
  const uiRoot = dirname(uiPkgJson);
  const appEntry = join(uiRoot, 'src', 'app', 'main.tsx');
  const cssPath = join(uiRoot, 'dist-web', 'app.css');
  // Map Ink imports onto the web compat layer so single-source (Ink-flavored)
  // space components render in the browser unchanged.
  aliases['ink'] = join(uiRoot, 'src', 'compat', 'ink.tsx');
  aliases['ink-text-input'] = join(uiRoot, 'src', 'compat', 'inputs.tsx');
  aliases['ink-select-input'] = join(uiRoot, 'src', 'compat', 'inputs.tsx');
  return { aliases, appEntry, cssPath, resolveDir: cliRoot };
}

/** Optional per-space theming: `<spaceDir>/theme.json` → `:root { --lm-*: … }`. */
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

/**
 * Build a browser bundle: the @repl/ui app (main.tsx) plus all of the agent's
 * form components (web.tsx), so custom components like <ConfirmDish /> render
 * with their real implementations. Everything resolves to ONE React instance.
 */
async function buildBundle(space: Space, agentSlug: string, wsUrl: string, appTsxPath: string): Promise<string> {
  const agentKeys = Object.keys(space.agents);
  const resolvedSlug = agentSlug === 'default' && !space.agents['default']
    ? (agentKeys[0] ?? agentSlug)
    : agentSlug;
  const agent = space.agents[resolvedSlug];
  const componentNames = agent?.config.components ?? [];

  const { aliases, appEntry, resolveDir } = resolveUiAssets(appTsxPath);

  const importLines: string[] = [];
  const compEntries: string[] = [];
  for (const name of componentNames) {
    if (space.components.form[name]) {
      const webPath = resolve(space.dir, 'components', 'form', name, 'web.tsx');
      importLines.push(`import __Comp_${name}__ from ${JSON.stringify(webPath)};`);
      compEntries.push(`  ${JSON.stringify(name)}: __Comp_${name}__,`);
    }
  }

  // Virtual entry: import the app's mount fn, register space components on the
  // window, set the WS URL, then mount. Import statements hoist, but the body
  // runs after they resolve — so the window globals are set before mountApp().
  const entry = [
    `import React from 'react';`,
    `import { mountApp } from ${JSON.stringify(appEntry)};`,
    ...importLines,
    `window.__SPACE_COMPONENTS__ = {`,
    ...compEntries,
    `};`,
    `window.__WS_URL__ = ${JSON.stringify(wsUrl)};`,
    `window.__LMTHING_REACT__ = React;`,
    `mountApp();`,
  ].join('\n');

  const result = await build({
    stdin: {
      contents: entry,
      loader: 'tsx',
      resolveDir,
      sourcefile: 'virtual-entry.tsx',
    },
    bundle: true,
    write: false,
    format: 'iife',
    jsx: 'automatic',
    define: { 'process.env.NODE_ENV': '"production"' },
    platform: 'browser',
    logLevel: 'error',
    alias: aliases,
  });

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

function buildHtml(js: string, css: string, themeCss = ''): string {
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
  <script>${js}</script>
</body>
</html>`;
}

export async function startWebServer(opts: WebServerOpts): Promise<void> {
  const wsUrl = `ws://localhost:${opts.port}`;

  console.log('Bundling web app…');
  const js = await buildBundle(opts.space, opts.agentSlug, wsUrl, opts.appTsxPath);
  const css = readCss(opts.appTsxPath);
  const html = buildHtml(js, css, readThemeCss(opts.space.dir));

  const renderHost = opts.renderHost;

  // ─── Observability spine: subscribe a TraceHub to the session's tracer ───
  const hub = new TraceHub();
  const traceFileAvailable = opts.session.getTracer !== undefined;
  if (typeof opts.session.getTracer === 'function') {
    opts.session.getTracer().subscribe((e) => hub.push(e));
  }

  // sendMessage routing: first message → start(), subsequent → continue().
  let started = false;
  const sendMessage = (content: string): void => {
    const run = started
      ? opts.session.continue(content)
      : opts.session.start(content);
    started = true;
    run
      .then(() => renderHost.emit({ type: 'done' }))
      .catch((err: unknown) => {
        renderHost.emit({ type: 'error', message: err instanceof Error ? err.message : String(err) });
      });
  };

  const broadcastUiControl = (action: UiControlAction): void => {
    renderHost.emit({ type: 'ui_control', action });
  };

  const httpServer = createServer((req, res) => {
    const reqUrl = req.url ?? '/';
    // Serve the current --trace file for in-browser replay (?trace=/trace.jsonl).
    if (reqUrl.startsWith('/trace.jsonl')) {
      try {
        const body = opts.traceFile ? readFileSync(opts.traceFile, 'utf8') : '';
        res.writeHead(200, { 'Content-Type': 'application/x-ndjson; charset=utf-8' });
        res.end(body);
      } catch {
        res.writeHead(404); res.end('');
      }
      return;
    }
    // Agent HTTP API
    if (reqUrl.startsWith('/api/')) {
      void handleAgentApi(req, res, {
        hub,
        spaceName: opts.space.dir,
        agentSlug: opts.agentSlug,
        sendMessage,
        submitForm: (id, value) => renderHost.submitForm(id, value),
        cancelAsk: (id) => renderHost.cancelAsk(id),
        pendingAsks: () => renderHost.pendingAsks(),
        broadcastUiControl,
      });
      return;
    }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(html);
  });

  const wss = new WebSocketServer({ server: httpServer });

  wss.on('connection', (ws) => {
    renderHost.addClient(ws);

    // Attach a trace sink for this client; detach on close.
    const sink = {
      send: (m: string) => { if (ws.readyState === WebSocket.OPEN) ws.send(m); },
      get bufferedAmount() { return ws.bufferedAmount; },
      isOpen: () => ws.readyState === WebSocket.OPEN,
    };
    hub.attach(sink);
    ws.on('close', () => hub.detach(sink));

    // Connect-time catch-up: hello + full trace snapshot + open asks.
    const send = (e: ServerEvent) => { if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(e)); };
    const snap = hub.snapshot();
    send({
      type: 'hello',
      protocolVersion: 1,
      sessionId: '',
      spaceName: opts.space.dir,
      agentSlug: opts.agentSlug,
      traceAvailable: traceFileAvailable,
    });
    send({ type: 'trace_snapshot', events: snap.events, lastSeq: snap.lastSeq, truncatedBefore: snap.truncatedBefore });
    const asks = renderHost.pendingAsks();
    if (asks.length > 0) send({ type: 'ask_pending', asks });

    ws.on('message', (data: Buffer) => {
      let msg: ClientMessage;
      try {
        msg = JSON.parse(data.toString()) as ClientMessage;
      } catch {
        return;
      }

      switch (msg.type) {
        case 'sendMessage':
          sendMessage(msg.content ?? '');
          break;
        case 'submitForm':
          renderHost.submitForm(msg.id, msg.value);
          break;
        case 'cancelAsk':
          renderHost.cancelAsk(msg.id);
          break;
        case 'subscribeTrace': {
          const since = hub.snapshotSince(msg.sinceSeq ?? 0);
          send({ type: 'trace_snapshot', events: since.events, lastSeq: since.lastSeq, truncatedBefore: since.truncatedBefore });
          break;
        }
      }
    });
  });

  await new Promise<void>((res) => httpServer.listen(opts.port, res));

  const url = `http://localhost:${opts.port}`;
  console.log(`Web UI ready: ${url}`);
  console.log(`Agent API:    ${url}/api/help`);
  openBrowser(url);
}

function openBrowser(url: string): void {
  const cmds: Partial<Record<string, [string, ...string[]]>> = {
    linux: ['xdg-open', url],
    darwin: ['open', url],
    win32: ['cmd', '/c', 'start', '', url],
  };
  const entry = cmds[process.platform];
  if (!entry) return;
  const [cmd, ...args] = entry;
  spawn(cmd!, args, { detached: true, stdio: 'ignore' }).unref();
}
