import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

/**
 * The hook now folds asks and errors into the ONE `model.blocks` transcript (mirroring the main
 * surface), and only a real server wire error (a string `message`) becomes a transcript error — a
 * messageless transport event no longer renders as the literal "undefined".
 */
type Handler = (data: unknown) => void;

// Hoisted so the class exists when the (hoisted) vi.mock factory runs.
const h = vi.hoisted(() => {
  class FakeClient {
    static last: FakeClient | null = null;
    handlers = new Map<string, Handler[]>();
    constructor(public target: unknown) {
      FakeClient.last = this;
    }
    on(event: string, fn: Handler): void {
      const arr = this.handlers.get(event) ?? [];
      arr.push(fn);
      this.handlers.set(event, arr);
    }
    emit(event: string, data: unknown): void {
      for (const fn of this.handlers.get(event) ?? []) fn(data);
    }
    connect(): void {}
    disconnect(): void {}
    sendMessage(): void {}
    submitForm(): void {}
    cancelAsk(): void {}
  }
  return { FakeClient };
});

vi.mock('./rpc-client', () => ({ ReplRpcClient: h.FakeClient }));

import { useReplSession } from './useReplSession';

const FakeClient = h.FakeClient;

describe('useReplSession — one transcript, guarded errors', () => {
  beforeEach(() => {
    FakeClient.last = null;
  });

  it('folds an ask into model.blocks and resolves it', () => {
    const { result } = renderHook(() => useReplSession({ baseUrl: 'https://pod.test', sessionId: 's1' }));
    const client = FakeClient.last!;
    act(() => client.emit('connect', undefined));
    expect(result.current.isConnected).toBe(true);

    act(() => client.emit('ask_start', { type: 'ask_start', id: 'a1', descriptor: 'Name?' }));
    const ask = result.current.model.blocks.find((b) => b.type === 'ask');
    expect(ask).toMatchObject({ type: 'ask', askId: 'a1', state: 'open' });

    act(() => client.emit('ask_end', { type: 'ask_end', id: 'a1' }));
    expect(result.current.model.blocks.find((b) => b.type === 'ask')).toMatchObject({ state: 'answered' });
  });

  it('does not duplicate an ask that the server resends on reconnect', () => {
    const { result } = renderHook(() => useReplSession({ baseUrl: 'https://pod.test', sessionId: 's1' }));
    const client = FakeClient.last!;
    act(() => client.emit('ask_start', { type: 'ask_start', id: 'a1', descriptor: 'Name?' }));
    act(() => client.emit('ask_start', { type: 'ask_start', id: 'a1', descriptor: 'Name?' }));
    expect(result.current.model.blocks.filter((b) => b.type === 'ask')).toHaveLength(1);
  });

  it('renders a real wire error but ignores a messageless transport event', () => {
    const { result } = renderHook(() => useReplSession({ baseUrl: 'https://pod.test', sessionId: 's1' }));
    const client = FakeClient.last!;

    // A messageless payload (what a DOM error Event would be) must NOT create a block.
    act(() => client.emit('error', { isTrusted: true }));
    expect(result.current.model.blocks.filter((b) => b.type === 'error')).toHaveLength(0);

    act(() => client.emit('error', { type: 'error', message: 'boom' }));
    const err = result.current.model.blocks.find((b) => b.type === 'error');
    expect(err).toMatchObject({ type: 'error', message: 'boom' });
  });
});
