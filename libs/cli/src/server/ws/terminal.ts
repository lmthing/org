import { WebSocket, WebSocketServer } from 'ws';

/**
 * Close a WebSocket with an optional reason, never throwing.
 *
 * A WS close reason must be ≤123 UTF-8 bytes (RFC 6455); `ws` throws a
 * synchronous RangeError otherwise. Because our close calls live inside async
 * handlers, that throw becomes an unhandled rejection and crashes the whole
 * process. Truncate to a safe byte budget and swallow any residual error so a
 * failed terminal open only tears down its own socket.
 */
export function safeClose(ws: WebSocket, code: number, reason: string): void {
  try {
    let truncated = reason;
    while (Buffer.byteLength(truncated, 'utf8') > 123) {
      truncated = truncated.slice(0, -1);
    }
    ws.close(code, truncated);
  } catch {
    try { ws.terminate(); } catch { /* already gone */ }
  }
}

export function handleTerminalWsUpgrade(
  req: import('node:http').IncomingMessage,
  socket: import('node:stream').Duplex,
  head: Buffer,
  wss: WebSocketServer,
  terminalCwd: string,
  termId: string,
): void {
  const url = new URL(req.url ?? '/', 'http://localhost');
  const command = url.searchParams.get('command') ?? undefined;
  wss.handleUpgrade(req, socket, head, (ws) => {
    registerTerminalSocket(ws, terminalCwd, command);
  });
}

function registerTerminalSocket(ws: WebSocket, terminalCwd: string, command?: string): void {
  void (async () => {
    let mgr: import('../terminal.js').TerminalManager | null = null;
    try {
      const { TerminalManager } = await import('../terminal.js');
      mgr = new TerminalManager();
      await mgr.open('sole', terminalCwd, (data) => {
        if (ws.readyState === WebSocket.OPEN) ws.send(data);
      }, command);
    } catch (err) {
      safeClose(ws, 1011, err instanceof Error ? err.message : String(err));
      return;
    }
    ws.on('message', (data: Buffer) => {
      if (!mgr) return;
      const str = data.toString();
      try {
        const msg = JSON.parse(str) as { type: string; data?: string; cols?: number; rows?: number };
        if (msg.type === 'input' && msg.data != null) mgr.input('sole', msg.data);
        else if (msg.type === 'resize' && typeof msg.cols === 'number' && typeof msg.rows === 'number') mgr.resize('sole', msg.cols, msg.rows);
      } catch { /* ignore parse errors */ }
    });
    ws.on('close', () => { mgr?.closeAll(); mgr = null; });
  })();
}
