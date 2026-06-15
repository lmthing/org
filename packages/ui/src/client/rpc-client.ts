type EventHandler = (data: unknown) => void;

/**
 * Multi-session client config. When provided (instead of a bare WS url), the
 * client talks to the multi-session server: actions go over HTTP to
 * `/api/sessions/:id/*` and events stream over `WS /api/ws?sessionId=:id`.
 */
export interface ReplClientConfig {
  /** HTTP origin of the agent server (or gateway), e.g. https://lmthing.computer */
  baseUrl: string;
  /** The session id (from POST /api/sessions). */
  sessionId: string;
  /** Optional bearer token appended to the WS url and sent on HTTP requests. */
  accessToken?: string;
}

function isConfig(v: string | ReplClientConfig): v is ReplClientConfig {
  return typeof v === 'object' && v !== null;
}

function toWsUrl(baseUrl: string): string {
  return baseUrl.replace(/^http/, 'ws');
}

export class ReplRpcClient {
  private ws: WebSocket | null = null;
  private handlers: Map<string, EventHandler[]> = new Map();
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  private legacyUrl: string | null = null;
  private config: ReplClientConfig | null = null;

  constructor(target: string | ReplClientConfig) {
    if (isConfig(target)) {
      this.config = target;
    } else {
      this.legacyUrl = target;
    }
  }

  /** Create a new server-side session and return a client bound to it. */
  static async createSession(
    baseUrl: string,
    opts: { spaceDir?: string; agentSlug?: string; model?: string; budget?: unknown } = {},
    accessToken?: string,
  ): Promise<ReplRpcClient> {
    const res = await fetch(`${baseUrl}/api/sessions`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(accessToken ? { authorization: `Bearer ${accessToken}` } : {}),
      },
      body: JSON.stringify(opts),
    });
    if (!res.ok) throw new Error(`createSession failed: ${res.status} ${await res.text()}`);
    const { sessionId } = (await res.json()) as { sessionId: string };
    return new ReplRpcClient({ baseUrl, sessionId, accessToken });
  }

  get sessionId(): string | null {
    return this.config?.sessionId ?? null;
  }

  connect(): void {
    const wsUrl = this.config
      ? `${toWsUrl(this.config.baseUrl)}/api/ws?sessionId=${encodeURIComponent(this.config.sessionId)}` +
        (this.config.accessToken ? `&access_token=${encodeURIComponent(this.config.accessToken)}` : '')
      : (this.legacyUrl as string);

    this.ws = new WebSocket(wsUrl);
    this.ws.onopen = () => this.emit('connect', undefined);
    this.ws.onclose = () => this.emit('disconnect', undefined);
    this.ws.onerror = (err) => this.emit('error', err);
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
    if (this.config) {
      void this.post(`/api/sessions/${this.config.sessionId}/message`, { content });
    } else {
      this.wsSend({ type: 'sendMessage', content });
    }
  }

  submitForm(id: string, value: unknown): void {
    if (this.config) {
      void this.post(`/api/sessions/${this.config.sessionId}/ask/${id}`, { value });
    } else {
      this.wsSend({ type: 'submitForm', id, value });
    }
  }

  cancelAsk(id: string): void {
    if (this.config) {
      void this.del(`/api/sessions/${this.config.sessionId}/ask/${id}`);
    } else {
      this.wsSend({ type: 'cancelAsk', id });
    }
  }

  on(event: string, handler: EventHandler): void {
    const existing = this.handlers.get(event) ?? [];
    existing.push(handler);
    this.handlers.set(event, existing);
  }

  off(event: string, handler: EventHandler): void {
    const existing = this.handlers.get(event) ?? [];
    this.handlers.set(event, existing.filter((h) => h !== handler));
  }

  private authHeaders(): Record<string, string> {
    return this.config?.accessToken ? { authorization: `Bearer ${this.config.accessToken}` } : {};
  }

  private async post(path: string, body: unknown): Promise<void> {
    await fetch(`${this.config!.baseUrl}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...this.authHeaders() },
      body: JSON.stringify(body),
    });
  }

  private async del(path: string): Promise<void> {
    await fetch(`${this.config!.baseUrl}${path}`, { method: 'DELETE', headers: this.authHeaders() });
  }

  private wsSend(data: unknown): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(data));
    }
  }

  private emit(event: string, data: unknown): void {
    for (const handler of this.handlers.get(event) ?? []) handler(data);
  }
}
