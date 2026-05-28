import { WebSocketServer, WebSocket } from 'ws';
import type { Session } from '@repl/core';
import type { RenderHost } from '@repl/core';
import type { ServerEvent, ClientMessage } from './events.js';

/**
 * A RenderHost that emits events over WebSocket instead of drawing to terminal.
 */
export class WebRenderHost implements RenderHost {
  private clients: Set<WebSocket> = new Set();
  private askResolvers: Map<string, (value: unknown) => void> = new Map();

  addClient(ws: WebSocket): void {
    this.clients.add(ws);
    ws.on('close', () => this.clients.delete(ws));
  }

  emit(event: ServerEvent): void {
    const msg = JSON.stringify(event);
    for (const client of this.clients) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(msg);
      }
    }
  }

  display(descriptor: unknown): void {
    this.emit({ type: 'display', descriptor });
  }

  ask(id: string, descriptor: unknown): Promise<unknown> {
    this.emit({ type: 'ask_start', id, descriptor });

    return new Promise((resolve) => {
      this.askResolvers.set(id, (value) => {
        this.emit({ type: 'ask_end', id });
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

  log(message: string): void {
    this.emit({ type: 'error', message });
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
