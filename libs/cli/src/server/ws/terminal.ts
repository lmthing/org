import { WebSocket, WebSocketServer } from 'ws';

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
      ws.close(1011, err instanceof Error ? err.message : String(err));
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
