import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ReplRpcClient } from './rpc-client';

/**
 * The embedded dock's socket. Two regressions are pinned here:
 *  - it must open at the POD's `/api/ws` (the section passes `podOrigin(client.baseUrl)`), never
 *    under `…/app/<project>` — the app has no such route, so the handshake failed and the dock hung
 *    on "Connecting…";
 *  - a transport `onerror` must NOT ride the same `'error'` channel as a server wire error, which is
 *    what turned a failed handshake into a red transcript block reading the literal "undefined".
 */
class FakeWS {
  static last: FakeWS | null = null;
  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: ((e: unknown) => void) | null = null;
  onmessage: ((e: { data: string }) => void) | null = null;
  readyState = 0;
  constructor(public url: string) {
    FakeWS.last = this;
  }
  send(): void {}
  close(): void {
    this.readyState = 3;
  }
}

describe('ReplRpcClient socket', () => {
  beforeEach(() => {
    vi.stubGlobal('WebSocket', FakeWS as unknown as typeof WebSocket);
    FakeWS.last = null;
  });
  afterEach(() => vi.unstubAllGlobals());

  it('opens at the pod /api/ws with sessionId + token, never under /app', () => {
    const c = new ReplRpcClient({ baseUrl: 'https://pod.test', sessionId: 's1', accessToken: 'tok' });
    c.connect();
    expect(FakeWS.last!.url).toBe('wss://pod.test/api/ws?sessionId=s1&access_token=tok');
    expect(FakeWS.last!.url).not.toContain('/app/');
  });

  it('keeps a transport error off the wire-error channel', () => {
    const c = new ReplRpcClient({ baseUrl: 'https://pod.test', sessionId: 's1' });
    const onError = vi.fn();
    const onSocketError = vi.fn();
    c.on('error', onError);
    c.on('socket_error', onSocketError);
    c.connect();
    FakeWS.last!.onerror?.(new Event('error'));
    expect(onSocketError).toHaveBeenCalledTimes(1);
    expect(onError).not.toHaveBeenCalled();
  });

  it('routes a server wire error to the error channel', () => {
    const c = new ReplRpcClient({ baseUrl: 'https://pod.test', sessionId: 's1' });
    const onError = vi.fn();
    c.on('error', onError);
    c.connect();
    FakeWS.last!.onmessage?.({ data: JSON.stringify({ type: 'error', message: 'boom' }) });
    expect(onError).toHaveBeenCalledWith({ type: 'error', message: 'boom' });
  });
});
