import { WebSocketServer, WebSocket } from 'ws';
import type { Session } from '@lmthing/core';
import type { RenderHost } from '@lmthing/core';
import type { ServerEvent, ClientMessage } from './events.js';

/**
 * A RenderHost that emits events over WebSocket instead of drawing to terminal.
 */
export class WebRenderHost implements RenderHost {
  private clients: Set<WebSocket> = new Set();
  private askResolvers: Map<string, (value: unknown) => void> = new Map();
  /** Open ask forms (id → descriptor) so a (re)connecting client can re-render them. */
  private openAsks: Map<string, unknown> = new Map();
  /** Non-WebSocket listeners — see {@link onEvent}. */
  private listeners: Set<(event: ServerEvent) => void> = new Set();

  addClient(ws: WebSocket): void {
    this.clients.add(ws);
    ws.on('close', () => this.clients.delete(ws));
  }

  /**
   * Watch this host's events without being a WebSocket.
   *
   * `ask`/`submitForm` were always transport-agnostic — the promise suspends the
   * turn and any caller can resolve it — but the only way to SEE an `ask_start`
   * was to be a connected socket. A team channel has no socket of its own: it
   * needs to turn the ask into a message in a thread and resolve it when somebody
   * replies. Returns an unsubscribe.
   */
  onEvent(listener: (event: ServerEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  emit(event: ServerEvent): void {
    const msg = JSON.stringify(event);
    for (const client of this.clients) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(msg);
      }
    }
    // After the sockets, and never allowed to break them: a throwing listener
    // must not stop the frame reaching a real client.
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch {
        /* a listener's failure is not the render host's problem */
      }
    }
  }

  display(descriptor: unknown): void {
    this.emit({ type: 'display', descriptor });
  }

  ask(id: string, descriptor: unknown): Promise<unknown> {
    this.openAsks.set(id, descriptor);
    this.emit({ type: 'ask_start', id, descriptor });

    return new Promise((resolve) => {
      this.askResolvers.set(id, (value) => {
        this.openAsks.delete(id);
        this.emit({ type: 'ask_end', id, value });
        resolve(value);
      });
    });
  }

  submitForm(id: string, value: unknown): void {
    const resolver = this.askResolvers.get(id);
    if (resolver) {
      this.askResolvers.delete(id);
      resolver(value);
    }
  }

  cancelAsk(id: string): void {
    const resolver = this.askResolvers.get(id);
    if (resolver) {
      this.askResolvers.delete(id);
      resolver(null);
    }
  }

  /** Snapshot of currently-open ask forms — for connect-time catch-up. */
  pendingAsks(): Array<{ id: string; descriptor: unknown }> {
    return [...this.openAsks.entries()].map(([id, descriptor]) => ({ id, descriptor }));
  }

  log(message: string): void {
    // Turn-loop debug chatter — goes to the server console, NOT the browser
    // conversation. Real progress reaches the UI via the trace stream (statements,
    // llm_*, yields); genuine failures are emitted as 'error' by the run wrapper.
    process.stdout.write(message + '\n');
  }
}

export class ReplWebSocketServer {
  private wss: WebSocketServer | null = null;
  private renderHost: WebRenderHost;

  constructor(private opts: { port: number; session: Session }) {
    this.renderHost = new WebRenderHost();
  }

  getRenderHost(): WebRenderHost {
    return this.renderHost;
  }

  start(): void {
    this.wss = new WebSocketServer({ port: this.opts.port });

    this.wss.on('connection', (ws: WebSocket) => {
      this.renderHost.addClient(ws);

      ws.on('message', (data: Buffer) => {
        let msg: ClientMessage;
        try {
          msg = JSON.parse(data.toString()) as ClientMessage;
        } catch {
          return;
        }

        switch (msg.type) {
          case 'sendMessage': {
            // Start a new session turn
            this.opts.session
              .start(msg.content)
              .then(() => {
                this.renderHost.emit({ type: 'done' });
              })
              .catch((err: unknown) => {
                const message = err instanceof Error ? err.message : String(err);
                this.renderHost.emit({ type: 'error', message });
              });
            break;
          }
          case 'submitForm': {
            this.renderHost.submitForm(msg.id, msg.value);
            break;
          }
          case 'cancelAsk': {
            this.renderHost.cancelAsk(msg.id);
            break;
          }
        }
      });
    });
  }

  stop(): void {
    if (this.wss) {
      this.wss.close();
      this.wss = null;
    }
  }
}
