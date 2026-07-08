import { WebSocket, WebSocketServer } from 'ws';
import type { SessionManager, SessionEntry } from '../session-manager.js';
import type { ServerEvent, ClientMessage } from '../../rpc/events.js';

function registerControlSocket(
  ws: WebSocket,
  terminalCwd: string,
): void {
  let terminals: import('../terminal.js').TerminalManager | null = null;
  const send = (e: ServerEvent) => { if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(e)); };
  const fail = (message: string) => { if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'error', message } satisfies ServerEvent)); };

  // Envoy Gateway already validated the JWT before forwarding the connection;
  // confirm to the client so PodRuntime transitions to 'running'.
  send({ type: 'auth.ok' });

  const ensureTerminals = async (): Promise<import('../terminal.js').TerminalManager> => {
    if (terminals) return terminals;
    const { TerminalManager } = await import('../terminal.js');
    terminals = new TerminalManager();
    return terminals;
  };

  ws.on('message', (data: Buffer) => {
    let msg: ClientMessage;
    try { msg = JSON.parse(data.toString()) as ClientMessage; } catch { return; }
    switch (msg.type) {
      case 'terminal.open': {
        const termId = msg.sessionId;
        const command = (msg as { command?: string }).command;
        void ensureTerminals()
          .then((mgr) => mgr.open(termId, terminalCwd, (out) => send({ type: 'terminal.data', sessionId: termId, data: out }), command))
          .then(() => send({ type: 'terminal.opened', sessionId: termId }))
          .catch((err: unknown) => fail(err instanceof Error ? err.message : String(err)));
        break;
      }
      case 'terminal.input':
        terminals?.input(msg.sessionId, msg.data);
        break;
      case 'terminal.resize':
        terminals?.resize(msg.sessionId, msg.cols, msg.rows);
        break;
      case 'terminal.close':
        terminals?.close(msg.sessionId);
        break;
    }
  });

  ws.on('close', () => { terminals?.closeAll(); });
}

function registerSocket(
  ws: WebSocket,
  entry: SessionEntry,
  manager: SessionManager,
): void {
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
    try {
      switch (msg.type) {
        case 'sendMessage':
          // Async (attachment assembly reads uploads from disk); route both
          // pre-run assembly errors and the sync-throw case to the client.
          void manager
            .sendMessage(entry.sessionId, msg.content ?? '', msg.attachments?.map((a) => a.id))
            .catch((err) => send({ type: 'error', message: err instanceof Error ? err.message : String(err) }));
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
    } catch (err) {
      // A synchronous throw (e.g. sendMessage before the session finished
      // initializing) would otherwise be swallowed by the ws listener and the
      // client would just hang. Surface it as an error event instead.
      send({ type: 'error', message: err instanceof Error ? err.message : String(err) });
    }
  });
}

export interface AgentWsOpts {
  wss: WebSocketServer;
  manager: SessionManager;
  terminalCwd: string;
}

export function handleAgentWsUpgrade(
  req: import('node:http').IncomingMessage,
  socket: import('node:stream').Duplex,
  head: Buffer,
  opts: AgentWsOpts,
): void {
  const { wss, manager, terminalCwd } = opts;
  const url = new URL(req.url ?? '/', 'http://localhost');
  if (url.pathname !== '/api/ws') { socket.destroy(); return; }
  const id = url.searchParams.get('sessionId') ?? '';
  // No sessionId → control socket (terminal multiplexing), not bound to an
  // agent SessionEntry. computer/ connects this way for its terminal.
  if (!id) {
    wss.handleUpgrade(req, socket, head, (ws) => {
      registerControlSocket(ws, terminalCwd);
    });
    return;
  }
  const entry = manager.getSession(id);
  if (!entry) {
    // Unknown session — refuse the upgrade with 404.
    socket.write('HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n');
    socket.destroy();
    return;
  }
  wss.handleUpgrade(req, socket, head, (ws) => {
    registerSocket(ws, entry, manager);
  });
}
