type EventHandler = (data: unknown) => void;

export class ReplRpcClient {
  private ws: WebSocket | null = null;
  private handlers: Map<string, EventHandler[]> = new Map();
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(private url: string) {}

  connect(): void {
    this.ws = new WebSocket(this.url);

    this.ws.onopen = () => {
      this.emit('connect', undefined);
    };

    this.ws.onclose = () => {
      this.emit('disconnect', undefined);
    };

    this.ws.onerror = (err) => {
      this.emit('error', err);
    };

    this.ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data as string) as { type: string };
        this.emit(data.type, data);
      } catch {
        // Ignore parse errors
      }
    };
  }

  disconnect(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }

  sendMessage(content: string): void {
    this.send({ type: 'sendMessage', content });
  }

  submitForm(id: string, value: unknown): void {
    this.send({ type: 'submitForm', id, value });
  }

  cancelAsk(id: string): void {
    this.send({ type: 'cancelAsk', id });
  }

  on(event: string, handler: EventHandler): void {
    const existing = this.handlers.get(event) ?? [];
    existing.push(handler);
    this.handlers.set(event, existing);
  }

  off(event: string, handler: EventHandler): void {
    const existing = this.handlers.get(event) ?? [];
    const filtered = existing.filter((h) => h !== handler);
    this.handlers.set(event, filtered);
  }

  private send(data: unknown): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(data));
    }
  }

  private emit(event: string, data: unknown): void {
    const handlers = this.handlers.get(event) ?? [];
    for (const handler of handlers) {
      handler(data);
    }
  }
}
