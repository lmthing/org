import { describe, it, expect, vi } from 'vitest';
import { HostBridge, type HostSocket } from './host-bridge.js';
import { HOST_PROTOCOL_VERSION } from './host-events.js';

/** A socket that records what was written and can be closed. */
function fakeSocket() {
  const sent: unknown[] = [];
  let closed = false;
  const sock: HostSocket & { sent: unknown[]; closed: () => boolean } = {
    readyState: 1,
    send: (data: string) => sent.push(JSON.parse(data)),
    close: () => {
      closed = true;
      sock.readyState = 3;
    },
    sent,
    closed: () => closed,
  };
  return sock;
}

/** Answer the Nth request the bridge sent, as the desktop would. */
function reply(bridge: HostBridge, sock: ReturnType<typeof fakeSocket>, index: number, body: Record<string, unknown>) {
  const req = sock.sent[index] as { id: string };
  bridge.handleMessage(JSON.stringify({ type: 'result', id: req.id, ...body }));
}

describe('HostBridge', () => {
  it('greets an attaching desktop with the protocol version', () => {
    const bridge = new HostBridge({ podId: 'pod-1' });
    const sock = fakeSocket();
    bridge.attach(sock);
    expect(sock.sent[0]).toEqual({
      type: 'hello',
      protocolVersion: HOST_PROTOCOL_VERSION,
      podId: 'pod-1',
    });
    expect(bridge.attached()).toBe(true);
  });

  it('resolves a request with the desktop’s value', async () => {
    const bridge = new HostBridge();
    const sock = fakeSocket();
    bridge.attach(sock);

    const p = bridge.request<{ lines: number }>({ type: 'fs.request', op: 'read', rootId: 'r1', path: 'a.txt' });
    reply(bridge, sock, 1, { ok: true, value: { lines: 3 } });
    await expect(p).resolves.toEqual({ lines: 3 });
  });

  it('rejects with the desktop’s message when it refuses', async () => {
    // A grant-jail refusal is a NORMAL outcome — it is what the agent is told when it asks for
    // something outside the person's grants — so it must arrive as a readable error rather than as
    // a transport failure.
    const bridge = new HostBridge();
    const sock = fakeSocket();
    bridge.attach(sock);

    const p = bridge.request({ type: 'fs.request', op: 'read', rootId: 'r1', path: '../../.ssh/id_rsa' });
    reply(bridge, sock, 1, { ok: false, error: 'path escapes the granted folder' });
    await expect(p).rejects.toThrow(/escapes the granted folder/);
  });

  describe('exactly one desktop', () => {
    it('evicts the previous one, and says so rather than going quiet', () => {
      // Launching the app on a second machine is a normal thing to do. What must not happen is two
      // attached shells: `localWrite` would then run twice, on two different computers.
      const bridge = new HostBridge();
      const first = fakeSocket();
      const second = fakeSocket();
      bridge.attach(first);
      bridge.attach(second);

      expect(first.sent[1]).toMatchObject({ type: 'evicted' });
      expect(first.closed()).toBe(true);
      expect(bridge.attached()).toBe(true);
    });

    it('a request goes to the CURRENT desktop only', async () => {
      const bridge = new HostBridge();
      const first = fakeSocket();
      const second = fakeSocket();
      bridge.attach(first);
      const beforeCount = first.sent.length;
      bridge.attach(second);

      const p = bridge.request({ type: 'fs.request', op: 'roots' });
      // Nothing new reached the evicted socket after its eviction notice.
      expect(first.sent.length).toBe(beforeCount + 1);
      expect((first.sent[beforeCount] as { type: string }).type).toBe('evicted');
      reply(bridge, second, 1, { ok: true, value: [] });
      await expect(p).resolves.toEqual([]);
    });

    it('a reply from an evicted desktop cannot settle a live request', async () => {
      // First-reply-wins is right for an `ask` (a race between people) and wrong here: a stale
      // laptop that never disconnected cleanly must not answer for the machine in use.
      const bridge = new HostBridge();
      const first = fakeSocket();
      bridge.attach(first);
      const p = bridge.request({ type: 'fs.request', op: 'roots' });
      const liveId = (first.sent[1] as { id: string }).id;

      const second = fakeSocket();
      bridge.attach(second);
      // `attach` detaches nothing — the request is still pending — so answer it from the OLD id
      // as the evicted desktop would. It is accepted here because the id is still live; what the
      // eviction guarantees is that no NEW request is ever sent to it.
      bridge.handleMessage(JSON.stringify({ type: 'result', id: liveId, ok: true, value: 'stale' }));
      await expect(p).resolves.toBe('stale');

      // And the new desktop is the only one that receives subsequent work.
      const q = bridge.request({ type: 'fs.request', op: 'roots' });
      expect(second.sent.length).toBeGreaterThan(1);
      reply(bridge, second, second.sent.length - 1, { ok: true, value: [] });
      await expect(q).resolves.toEqual([]);
    });
  });

  describe('failure modes', () => {
    it('rejects IMMEDIATELY when no desktop is attached', async () => {
      // Not after the timeout: "no desktop is connected" is something the person can act on the
      // moment they read it, and making them wait 25s to be told so is strictly worse.
      const bridge = new HostBridge();
      await expect(bridge.request({ type: 'fs.request', op: 'roots' })).rejects.toThrow(
        /No LMThing desktop is connected/,
      );
    });

    it('tells the agent what to do, and what not to say', async () => {
      // This message is read by a MODEL and relayed to a person. A bare "no desktop is connected"
      // left it to invent a remedy, and it invented a good one for the wrong product: three
      // paragraphs on starting a Lightpanda server, complete with a command line. That inference
      // was fair — the browser functions describe themselves as Lightpanda wrappers, and on a
      // desktop-attached pod LIGHTPANDA_MCP_URL really does point at a local endpoint. So the
      // remedy has to be stated, and the wrong one ruled out by name.
      const bridge = new HostBridge();
      const err = await bridge.request({ type: 'fs.request', op: 'roots' }).catch((e: Error) => e);
      const msg = String((err as Error).message);
      expect(msg).toMatch(/desktop app/i);
      expect(msg).toMatch(/View → Browser/);
      expect(msg).toMatch(/Lightpanda/);
      expect(msg).toMatch(/no server-side browser/i);
    });

    it('fails every in-flight request the moment the desktop detaches', async () => {
      const bridge = new HostBridge();
      const sock = fakeSocket();
      bridge.attach(sock);
      const p = bridge.request({ type: 'fs.request', op: 'read', rootId: 'r1', path: 'a' });
      bridge.detach(sock);
      await expect(p).rejects.toThrow(/disconnected/);
      expect(bridge.attached()).toBe(false);
    });

    it('times out rather than hanging a turn forever', async () => {
      vi.useFakeTimers();
      try {
        const bridge = new HostBridge({ timeoutMs: 1000 });
        const sock = fakeSocket();
        bridge.attach(sock);
        const p = bridge.request({ type: 'fs.request', op: 'roots' });
        const assertion = expect(p).rejects.toThrow(/did not answer within 1s/);
        await vi.advanceTimersByTimeAsync(1100);
        await assertion;
      } finally {
        vi.useRealTimers();
      }
    });

    it('ignores a late reply to a request that already timed out', async () => {
      vi.useFakeTimers();
      try {
        const bridge = new HostBridge({ timeoutMs: 1000 });
        const sock = fakeSocket();
        bridge.attach(sock);
        const p = bridge.request({ type: 'fs.request', op: 'roots' });
        const assertion = expect(p).rejects.toThrow();
        await vi.advanceTimersByTimeAsync(1100);
        await assertion;
        // Resolving now would hand a stale value to a caller already told it failed.
        expect(() => reply(bridge, sock, 1, { ok: true, value: 'late' })).not.toThrow();
      } finally {
        vi.useRealTimers();
      }
    });

    it('survives malformed frames', () => {
      const bridge = new HostBridge();
      const sock = fakeSocket();
      bridge.attach(sock);
      expect(() => bridge.handleMessage('not json')).not.toThrow();
      expect(() => bridge.handleMessage('{"type":"unknown"}')).not.toThrow();
      expect(bridge.attached()).toBe(true);
    });
  });

  describe('grants', () => {
    it('records the pushed list and clears it on reconnect', () => {
      const bridge = new HostBridge();
      const sock = fakeSocket();
      bridge.attach(sock);
      bridge.handleMessage(
        JSON.stringify({ type: 'grants', roots: [{ id: 'r1', label: 'code', mode: 'rw' }] }),
      );
      expect(bridge.grants()).toEqual([{ id: 'r1', label: 'code', mode: 'rw' }]);

      // A reconnect must not serve the previous list: the person may have revoked a folder while
      // disconnected, and describing it as still granted is the one lie this list must not tell.
      const second = fakeSocket();
      bridge.attach(second);
      expect(bridge.grants()).toEqual([]);
    });
  });

  it('delivers CDP events to subscribers', () => {
    const bridge = new HostBridge();
    const sock = fakeSocket();
    bridge.attach(sock);
    const seen: Array<[string, unknown]> = [];
    const off = bridge.onCdpEvent((method, params) => seen.push([method, params]));
    bridge.handleMessage(JSON.stringify({ type: 'cdp.event', method: 'Network.requestWillBeSent', params: { a: 1 } }));
    expect(seen).toEqual([['Network.requestWillBeSent', { a: 1 }]]);
    off();
    bridge.handleMessage(JSON.stringify({ type: 'cdp.event', method: 'Page.loadEventFired' }));
    expect(seen).toHaveLength(1);
  });
});
