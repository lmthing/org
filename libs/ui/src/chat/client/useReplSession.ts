import { useState, useEffect, useCallback, useRef } from 'react';
import { ReplRpcClient, type ReplClientConfig } from './rpc-client.js';
import { buildModel, emptyModel, type SessionModel, type WireEvent } from '../store/model.js';

export interface ReplBlock {
  id: string;
  type: 'display' | 'ask' | 'variables' | 'error' | 'message';
  data: unknown;
}

interface AskStartEvent {
  type: 'ask_start';
  id: string;
  descriptor: unknown;
}

interface AskEndEvent {
  type: 'ask_end';
  id: string;
}

interface DisplayEvent {
  type: 'display';
  descriptor: unknown;
}

interface VariablesEvent {
  type: 'variables';
  vars: Record<string, unknown>;
}

interface ErrorEvent {
  type: 'error';
  message: string;
}

// The same `/api/ws?sessionId=` socket that carries display/ask/variables also
// streams the full execution trace (`trace_snapshot` on connect, then live
// `trace` events) — the source the full /chat surface builds its node tree
// from. We accumulate those here so the embedded chat can surface the same
// delegate/fork/tasklist activity.
interface TraceSnapshotEvent {
  type: 'trace_snapshot';
  events: WireEvent[];
}

interface TraceEventMsg {
  type: 'trace';
  seq: number;
  event: WireEvent['event'];
}

export function useReplSession(target: string | ReplClientConfig): {
  blocks: ReplBlock[];
  /** Live execution-tree model (nodes for forks/delegates/tasklists) rebuilt
   *  from the session's trace stream. Empty until trace events arrive. */
  model: SessionModel;
  sendMessage: (content: string) => void;
  submitForm: (id: string, value: unknown) => void;
  cancelAsk: (id: string) => void;
  isConnected: boolean;
  isDone: boolean;
} {
  const [blocks, setBlocks] = useState<ReplBlock[]>([]);
  const [model, setModel] = useState<SessionModel>(emptyModel);
  const [isConnected, setIsConnected] = useState(false);
  const [isDone, setIsDone] = useState(false);
  const clientRef = useRef<ReplRpcClient | null>(null);
  const blockIdCounter = useRef(0);
  // Wire events keyed by seq (dedupe snapshot vs live overlap); the model is
  // rebuilt from the seq-ordered values on every batch.
  const wireBySeq = useRef<Map<number, WireEvent>>(new Map());

  const nextId = () => {
    blockIdCounter.current++;
    return String(blockIdCounter.current);
  };

  const depKey = typeof target === 'string' ? target : `${target.baseUrl}#${target.sessionId}`;

  // A multi-session config with no sessionId yet (the caller is still creating
  // the session) must NOT open a WebSocket — `?sessionId=` is rejected by the
  // server and the doomed socket's close races with the real one, wedging the
  // hook at "connecting". Only connect once we have a real target.
  const connectable = typeof target === 'string' ? target.length > 0 : target.sessionId.length > 0;

  useEffect(() => {
    if (!connectable) {
      setIsConnected(false);
      return;
    }
    const client = new ReplRpcClient(target);
    clientRef.current = client;
    // Fresh session/target — drop any accumulated tree from a prior binding.
    wireBySeq.current = new Map();
    setModel(emptyModel());

    const rebuildModel = () => {
      const ordered = [...wireBySeq.current.values()].sort((a, b) => a.seq - b.seq);
      setModel(buildModel(ordered));
    };

    client.on('connect', () => setIsConnected(true));
    client.on('disconnect', () => setIsConnected(false));

    client.on('trace_snapshot', (data) => {
      const event = data as TraceSnapshotEvent;
      for (const we of event.events ?? []) wireBySeq.current.set(we.seq, we);
      rebuildModel();
    });

    client.on('trace', (data) => {
      const event = data as TraceEventMsg;
      wireBySeq.current.set(event.seq, { seq: event.seq, event: event.event });
      rebuildModel();
    });

    client.on('display', (data) => {
      const event = data as DisplayEvent;
      setBlocks((prev) => [
        ...prev,
        { id: nextId(), type: 'display', data: event.descriptor },
      ]);
    });

    client.on('ask_start', (data) => {
      const event = data as AskStartEvent;
      setBlocks((prev) => [
        ...prev,
        { id: event.id, type: 'ask', data: event.descriptor },
      ]);
    });

    client.on('ask_end', (data) => {
      const event = data as AskEndEvent;
      setBlocks((prev) => prev.filter((b) => b.id !== event.id));
    });

    client.on('variables', (data) => {
      const event = data as VariablesEvent;
      setBlocks((prev) => [
        ...prev,
        { id: nextId(), type: 'variables', data: event.vars },
      ]);
    });

    client.on('error', (data) => {
      const event = data as ErrorEvent;
      setBlocks((prev) => [
        ...prev,
        { id: nextId(), type: 'error', data: event.message },
      ]);
    });

    client.on('done', () => {
      setIsDone(true);
    });

    client.connect();

    return () => {
      client.disconnect();
      clientRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [depKey]);

  const sendMessage = useCallback((content: string) => {
    setIsDone(false);
    clientRef.current?.sendMessage(content);
  }, []);

  const submitForm = useCallback((id: string, value: unknown) => {
    clientRef.current?.submitForm(id, value);
  }, []);

  const cancelAsk = useCallback((id: string) => {
    clientRef.current?.cancelAsk(id);
  }, []);

  return { blocks, model, sendMessage, submitForm, cancelAsk, isConnected, isDone };
}
