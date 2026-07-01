/**
 * Regression: a terminal WS open failure must not crash the process.
 *
 * When node-pty is unavailable the terminal handler closes the socket with the
 * load error as the close reason. WS close reasons are capped at 123 UTF-8
 * bytes (RFC 6455) — the raw node-pty error exceeds that, so `ws.close()` threw
 * a synchronous RangeError inside an async handler, surfacing as an unhandled
 * rejection that took down the whole pod (CrashLoopBackOff). `safeClose` must
 * truncate the reason and never throw.
 */
import { describe, it, expect, afterAll } from 'vitest';
import { WebSocketServer, WebSocket } from 'ws';
import type { AddressInfo } from 'node:net';
import { safeClose } from './terminal.js';

const servers: WebSocketServer[] = [];
afterAll(() => servers.forEach((s) => s.close()));

function closeReasonRoundTrip(reason: string): Promise<{ code: number; reason: string }> {
  return new Promise((resolve, reject) => {
    const wss = new WebSocketServer({ port: 0 });
    servers.push(wss);
    wss.on('connection', (ws) => {
      // Must not throw even though `reason` is far longer than 123 bytes.
      expect(() => safeClose(ws, 1011, reason)).not.toThrow();
    });
    wss.on('listening', () => {
      const { port } = wss.address() as AddressInfo;
      const client = new WebSocket(`ws://127.0.0.1:${port}`);
      client.on('close', (code, buf) => resolve({ code, reason: buf.toString('utf8') }));
      client.on('error', reject);
    });
  });
}

describe('safeClose', () => {
  it('does not throw and truncates an over-long close reason to ≤123 bytes', async () => {
    const longReason =
      'node-pty not available — terminal support requires a Node.js runtime with the native addon built (Cannot find package \'node-pty\' imported from /data/[eval])';
    expect(Buffer.byteLength(longReason, 'utf8')).toBeGreaterThan(123);

    const { code, reason } = await closeReasonRoundTrip(longReason);
    expect(code).toBe(1011);
    expect(Buffer.byteLength(reason, 'utf8')).toBeLessThanOrEqual(123);
    expect(longReason.startsWith(reason)).toBe(true);
  });

  it('passes short reasons through unchanged', async () => {
    const { code, reason } = await closeReasonRoundTrip('boom');
    expect(code).toBe(1011);
    expect(reason).toBe('boom');
  });
});
