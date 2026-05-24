import { createServer, type Server } from 'node:http';
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from 'node:fs';
import { join, extname } from 'node:path';
import { WebSocketServer, type WebSocket } from 'ws';
import { SpaceChatSession } from './chat-session.js';
import type { LanguageModel } from 'ai';

export interface SpaceChatServerOptions {
  port: number;
  spaceDir: string;
  agent?: string;
  flow?: string;
  modelAlias?: string;
  /** Inject a pre-built LanguageModel (skips resolveLLM; useful for testing). */
  model?: LanguageModel;
  baseDir?: string;
  staticDir?: string;
  /** In-memory web assets: relative path → base64-encoded content */
  webAssets?: Record<string, string>;
  conversationsDir?: string;
}

const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html',
  '.js': 'application/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};

const VALID_ID = /^[a-zA-Z0-9_-]+$/;

export function createSpaceChatServer(
  options: SpaceChatServerOptions,
): { server: Server; close: () => void; session: SpaceChatSession } {
  const { port, spaceDir, agent, flow, baseDir, staticDir, webAssets, conversationsDir } = options;

  // Create and init session once
  const session = new SpaceChatSession({
    spaceDir,
    agent,
    flow,
    modelAlias: options.modelAlias as never,
    model: options.model,
    baseDir,
  });

  // Initialise session in background (errors surfaced via 'event')
  session.init().catch((err: unknown) => {
    console.error('[server] session init error:', err);
  });

  const httpServer = createServer((req, res) => {
    // CORS preflight
    if (req.method === 'OPTIONS') {
      res.writeHead(204, {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
      });
      res.end();
      return;
    }

    // SSE stream: GET /events
    if (req.method === 'GET' && req.url?.split('?')[0] === '/events') {
      res.writeHead(200, {
        'Access-Control-Allow-Origin': '*',
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      });
      res.flushHeaders();

      const send = (event: Record<string, unknown>) => {
        if (!res.destroyed) res.write(`data: ${JSON.stringify(event)}\n\n`);
      };

      session.on('event', send);

      // Send initial snapshot
      const snap = session.snapshot();
      res.write(`data: ${JSON.stringify({ type: 'snapshot', data: snap })}\n\n`);

      req.on('close', () => session.off('event', send));
      return;
    }

    // Command dispatch: POST /send
    if (req.method === 'POST' && req.url?.split('?')[0] === '/send') {
      const chunks: Buffer[] = [];
      req.on('data', (chunk: Buffer) => chunks.push(chunk));
      req.on('end', async () => {
        const corsHeaders = { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' };
        try {
          const msg = JSON.parse(Buffer.concat(chunks).toString()) as Record<string, unknown>;
          if (msg['type'] === 'sendMessage') {
            session.handleUserMessage(msg['text'] as string).catch((err: unknown) =>
              console.error('[server] agent error:', err),
            );
          } else if (msg['type'] === 'pause') {
            session.pause();
          } else if (msg['type'] === 'resume') {
            session.resume();
          } else if (msg['type'] === 'intervene') {
            session.handleIntervention(msg['text'] as string);
          } else if (msg['type'] === 'switchAgent') {
            session.switchAgent(msg['agent'] as string);
          } else if (msg['type'] === 'submitKnowledge') {
            session.submitKnowledge(msg['id'] as string, msg['data'] as Record<string, string>);
          }
          res.writeHead(200, corsHeaders);
          res.end('{"ok":true}');
        } catch (err) {
          res.writeHead(400, corsHeaders);
          res.end(JSON.stringify({ error: err instanceof Error ? err.message : 'Unknown error' }));
        }
      });
      return;
    }

    // In-memory assets
    if (webAssets) {
      const urlPath = req.url === '/' ? 'index.html' : req.url!.split('?')[0].replace(/^\//, '');
      const b64 = webAssets[urlPath];
      if (b64) {
        const contentType = MIME_TYPES[extname(urlPath)] ?? 'application/octet-stream';
        res.writeHead(200, { 'Content-Type': contentType });
        res.end(Buffer.from(b64, 'base64'));
        return;
      }
      // SPA fallback
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(Buffer.from(webAssets['index.html'] ?? '', 'base64'));
      return;
    }

    if (!staticDir) {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end('<html><body><h1>@lmthing/llm-repl-cli</h1><p>WebSocket endpoint ready.</p></body></html>');
      return;
    }

    // Static files (dev mode)
    const urlPath = req.url === '/' ? '/index.html' : req.url!.split('?')[0];
    const filePath = join(staticDir, urlPath);

    if (!existsSync(filePath)) {
      const indexPath = join(staticDir, 'index.html');
      if (existsSync(indexPath)) {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(readFileSync(indexPath));
        return;
      }
      res.writeHead(404);
      res.end('Not found');
      return;
    }

    const ext = extname(filePath);
    const contentType = MIME_TYPES[ext] ?? 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': contentType });
    res.end(readFileSync(filePath));
  });

  const wss = new WebSocketServer({ server: httpServer });

  wss.on('connection', (ws: WebSocket) => {
    // Forward all session events to this client
    const listener = (event: Record<string, unknown>) => {
      if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(event));
    };
    session.on('event', listener);

    // Send current snapshot on connect
    const snap = session.snapshot();
    ws.send(JSON.stringify({ type: 'snapshot', data: snap }));

    // Replay space_info so the header block renders correctly
    ws.send(JSON.stringify({ type: 'space_info', agentSlug: snap.agentSlug, flowSlug: snap.flowSlug, spaceDir: snap.spaceDir }));

    // Send space metadata so client @ picker is always populated
    ws.send(JSON.stringify({ type: 'space_metadata', agents: session.agentInfos() }));

    // Send current agent's actions so / picker is populated
    const currentActions = session.currentActions();
    if (currentActions.length > 0) {
      ws.send(JSON.stringify({ type: 'actions', data: currentActions }));
    }

    ws.on('message', async (data: Buffer) => {
      try {
        const msg = JSON.parse(data.toString()) as Record<string, unknown>;
        switch (msg['type']) {
          case 'sendMessage':
            session.handleUserMessage(msg['text'] as string).catch((err: unknown) =>
              console.error('[server] agent error:', err),
            );
            break;
          case 'submitForm':
            session.submitForm(msg['formId'] as string, (msg['data'] ?? {}) as Record<string, unknown>);
            break;
          case 'cancelAsk':
            session.cancelAsk(msg['formId'] as string);
            break;
          case 'pause':
            session.pause();
            break;
          case 'resume':
            session.resume();
            break;
          case 'intervene':
            session.handleIntervention(msg['text'] as string);
            break;
          case 'switchAgent':
            session.switchAgent(msg['agent'] as string);
            break;
          case 'submitKnowledge':
            session.submitKnowledge(msg['id'] as string, (msg['data'] ?? {}) as Record<string, string>);
            break;

          case 'getSnapshot': {
            const snap = session.snapshot();
            ws.send(JSON.stringify({ type: 'snapshot', data: snap }));
            break;
          }
          case 'getConversationState':
            // Lightweight: return current snapshot as conversation state
            ws.send(JSON.stringify({ type: 'conversationState', data: session.snapshot() }));
            break;
          case 'saveConversation': {
            if (conversationsDir && msg['id'] && VALID_ID.test(msg['id'] as string)) {
              if (!existsSync(conversationsDir)) mkdirSync(conversationsDir, { recursive: true });
              const state = session.snapshot();
              writeFileSync(
                join(conversationsDir, `${msg['id'] as string}.json`),
                JSON.stringify(state, null, 2),
              );
              ws.send(JSON.stringify({ type: 'conversationSaved', id: msg['id'] }));
            }
            break;
          }
          case 'listConversations': {
            const summaries: Array<{ id: string; title: string; updatedAt: string }> = [];
            if (conversationsDir && existsSync(conversationsDir)) {
              const files = readdirSync(conversationsDir).filter((f) => f.endsWith('.json'));
              for (const f of files) {
                try {
                  const id = f.replace('.json', '');
                  summaries.push({ id, title: id, updatedAt: new Date().toISOString() });
                } catch {
                  /* skip */
                }
              }
            }
            ws.send(JSON.stringify({ type: 'conversations', data: summaries }));
            break;
          }
          case 'loadConversation': {
            if (conversationsDir && msg['id'] && VALID_ID.test(msg['id'] as string)) {
              const convPath = join(conversationsDir, `${msg['id'] as string}.json`);
              if (existsSync(convPath)) {
                try {
                  const content = readFileSync(convPath, 'utf-8');
                  ws.send(JSON.stringify({ type: 'conversationLoaded', id: msg['id'], data: JSON.parse(content) }));
                } catch {
                  ws.send(JSON.stringify({ type: 'error', message: 'Failed to parse conversation file' }));
                }
              }
            }
            break;
          }
        }
      } catch (err) {
        ws.send(JSON.stringify({ type: 'error', message: err instanceof Error ? err.message : 'Unknown error' }));
      }
    });

    ws.on('close', () => session.off('event', listener));
  });

  httpServer.listen(port);

  return {
    server: httpServer,
    session,
    close: () => {
      session.dispose();
      wss.close();
      httpServer.close();
    },
  };
}
