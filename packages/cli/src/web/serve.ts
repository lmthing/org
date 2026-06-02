import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { createRequire } from 'node:module';
import { WebSocketServer } from 'ws';
import { build } from 'esbuild';
import { WebRenderHost } from '../rpc/server.js';
import type { Session, Space } from '@repl/core';

export interface WebServerOpts {
  port: number;
  session: Session;
  renderHost: WebRenderHost;
  space: Space;
  agentSlug: string;
  /** Absolute path to dist/web/app.tsx — passed by bin.ts which knows its own __dirname */
  appTsxPath: string;
}

/** Resolve react/react-dom from the CLI package so space components can import them. */
function buildReactAliases(appTsxPath: string): Record<string, string> {
  const cliRoot = join(appTsxPath, '..', '..', '..'); // packages/cli/
  const req = createRequire(join(cliRoot, 'package.json'));
  const aliases: Record<string, string> = {};
  for (const pkg of ['react', 'react-dom', 'react/jsx-runtime', 'react-dom/client']) {
    try { aliases[pkg] = req.resolve(pkg); } catch { /* skip */ }
  }
  return aliases;
}

/**
 * Build a browser bundle that includes the shell app plus all of the agent's
 * form components (web.tsx) so custom components like <ConfirmDish />,
 * <SaltinessSlider />, etc. render with their real implementations.
 */
async function buildBundle(space: Space, agentSlug: string, wsUrl: string, appTsxPath: string): Promise<string> {
  const agentKeys = Object.keys(space.agents);
  const resolvedSlug = agentSlug === 'default' && !space.agents['default']
    ? (agentKeys[0] ?? agentSlug)
    : agentSlug;
  const agent = space.agents[resolvedSlug];
  const componentNames = agent?.config.components ?? [];

  const importLines: string[] = [];
  const compEntries: string[] = [];

  for (const name of componentNames) {
    if (space.components.form[name]) {
      const webPath = resolve(space.dir, 'components', 'form', name, 'web.tsx');
      importLines.push(`import __Comp_${name}__ from ${JSON.stringify(webPath)};`);
      compEntries.push(`  ${JSON.stringify(name)}: __Comp_${name}__ as React.ComponentType<Record<string, unknown>>,`);
    }
  }

  const appSrc = readFileSync(appTsxPath, 'utf8');

  // Build a virtual entry that declares __SPACE_COMPONENTS__ then runs the app.
  // The app.tsx source references __SPACE_COMPONENTS__ as a declared const — here
  // we provide the real binding before its code runs (same module scope).
  const entry = [
    `import React from 'react';`,
    ...importLines,
    `const __SPACE_COMPONENTS__: Record<string, React.ComponentType<Record<string, unknown>>> = {`,
    ...compEntries,
    `};`,
    `(window as unknown as Record<string, unknown>)['__WS_URL__'] = ${JSON.stringify(wsUrl)};`,
    // Inline the app source verbatim — it references __SPACE_COMPONENTS__ and window.__WS_URL__
    appSrc,
  ].join('\n');

  const result = await build({
    stdin: {
      contents: entry,
      loader: 'tsx',
      // Resolve @repl/ui, react, react-dom etc. from the CLI package root (two dirs up from dist/web/app.tsx)
      resolveDir: join(appTsxPath, '..', '..', '..'),
      sourcefile: 'virtual-entry.tsx',
    },
    bundle: true,
    write: false,
    format: 'iife',
    jsx: 'transform',
    jsxFactory: 'React.createElement',
    jsxFragment: 'React.Fragment',
    define: { 'process.env.NODE_ENV': '"production"' },
    platform: 'browser',
    logLevel: 'error',
    // Resolve react/react-dom from the CLI package so space components
    // (which live outside node_modules) can import them.
    alias: buildReactAliases(appTsxPath),
  });

  return result.outputFiles[0]!.text;
}

function buildHtml(js: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>LMThing</title>
  <style>*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }</style>
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
  const html = buildHtml(js);

  const renderHost = opts.renderHost;

  const httpServer = createServer((_req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(html);
  });

  const wss = new WebSocketServer({ server: httpServer });

  wss.on('connection', (ws) => {
    renderHost.addClient(ws);

    ws.on('message', (data: Buffer) => {
      let msg: { type: string; content?: string; id?: string; value?: unknown };
      try {
        msg = JSON.parse(data.toString()) as typeof msg;
      } catch {
        return;
      }

      switch (msg.type) {
        case 'sendMessage':
          opts.session
            .start(msg.content ?? '')
            .then(() => renderHost.emit({ type: 'done' }))
            .catch((err: unknown) => {
              renderHost.emit({
                type: 'error',
                message: err instanceof Error ? err.message : String(err),
              });
            });
          break;
        case 'submitForm':
          renderHost.submitForm(msg.id!, msg.value);
          break;
        case 'cancelAsk':
          renderHost.cancelAsk(msg.id!);
          break;
      }
    });
  });

  await new Promise<void>((resolve) => httpServer.listen(opts.port, resolve));

  const url = `http://localhost:${opts.port}`;
  console.log(`Web UI ready: ${url}`);
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
