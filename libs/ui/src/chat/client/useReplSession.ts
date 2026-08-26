import { useState, useEffect, useCallback, useRef } from 'react';
import { ReplRpcClient, type ReplClientConfig } from './rpc-client';
import {
  applyWireEvent,
  emptyModel,
  pushAskBlock,
  resolveAskBlock,
  pushErrorBlock,
  type ConvoBlock,
  type SessionModel,
  type WireEvent,
} from '../store/model';

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
  /** The single live transcript + execution-tree model, fed from the session's trace stream plus the
   *  ask/error channels. `model.blocks` is the ordered `ConvoBlock[]` the rich dock renders. */
  model: SessionModel;
  sendMessage: (content: string) => void;
  submitForm: (id: string, value: unknown) => void;
  cancelAsk: (id: string) => void;
  isConnected: boolean;
  isDone: boolean;
} {
  const [blocks, setBlocks] = useState<ReplBlock[]>([]);
  const [isConnected, setIsConnected] = useState(false);
  const [isDone, setIsDone] = useState(false);
  const clientRef = useRef<ReplRpcClient | null>(null);
  const blockIdCounter = useRef(0);
  // Trace seqs already folded into the model — dedupes the snapshot-vs-live overlap AND the
  // whole-snapshot resend on a reconnect, so re-applying is a no-op rather than a double-count.
  const seenSeq = useRef<Set<number>>(new Set());
  // The single live model is held in a ref and mutated in place (matching how the main store feeds
  // it); a version counter forces the re-render. Mutating inside a `setState` updater would be
  // double-applied under React StrictMode/concurrent — a ref keeps each event folded in exactly once.
  const modelRef = useRef<SessionModel>(emptyModel());
  const [, setVersion] = useState(0);
  const rerender = () => setVersion((v) => v + 1);

  const nextId = () => {
    blockIdCounter.current++;
    return String(blockIdCounter.current);
  };

  const mutateModel = (fn: (m: SessionModel) => void) => {
    fn(modelRef.current);
    rerender();
  };

  const hasOpenAsk = (m: SessionModel, askId: string): boolean =>
    m.blocks.some((b): b is Extract<ConvoBlock, { type: 'ask' }> =>
      b.type === 'ask' && b.askId === askId && b.state === 'open',
    );

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
    // Fresh session/target — drop any accumulated transcript from a prior binding.
    seenSeq.current = new Set();
    modelRef.current = emptyModel();
    rerender();
    setBlocks([]);

    // Fold a trace event into the model exactly once. Applied incrementally (never a wholesale
    // rebuild) so the ask/error blocks pushed imperatively below survive each new batch.
    const applyTrace = (we: WireEvent) => {
      if (seenSeq.current.has(we.seq)) return;
      seenSeq.current.add(we.seq);
      mutateModel((m) => applyWireEvent(m, we));
    };

    client.on('connect', () => setIsConnected(true));
    client.on('disconnect', () => setIsConnected(false));

    client.on('trace_snapshot', (data) => {
      const event = data as TraceSnapshotEvent;
      for (const we of event.events ?? []) applyTrace(we);
    });

    client.on('trace', (data) => {
      const event = data as TraceEventMsg;
      applyTrace({ seq: event.seq, event: event.event });
    });

    // `display` also arrives as a trace event (folded into `model.blocks` above); keep the legacy
    // `blocks` list populated too, for the other `useReplSession` consumers (cli `--web`, the studio
    // agent-chat route) that still render it directly.
    client.on('display', (data) => {
      const event = data as DisplayEvent;
      setBlocks((prev) => [
        ...prev,
        { id: nextId(), type: 'display', data: event.descriptor },
      ]);
    });

    // Asks and errors are NOT trace events — the server streams them on their own channels — so feed
    // them into the model here (mirroring the main surface's `noteAskStart`/`noteAskEnd`/`noteError`)
    // to keep `model.blocks` the single, correctly-ordered transcript the rich dock renders. Guarded
    // against the reconnect resend so an already-open ask is not duplicated.
    client.on('ask_start', (data) => {
      const event = data as AskStartEvent;
      mutateModel((m) => { if (!hasOpenAsk(m, event.id)) pushAskBlock(m, event.id, event.descriptor); });
      setBlocks((prev) => [...prev, { id: event.id, type: 'ask', data: event.descriptor }]);
    });

    client.on('ask_pending', (data) => {
      const event = data as { asks?: { id: string; descriptor: unknown }[] };
      for (const a of event.asks ?? []) {
        mutateModel((m) => { if (!hasOpenAsk(m, a.id)) pushAskBlock(m, a.id, a.descriptor); });
      }
    });

    client.on('ask_end', (data) => {
      const event = data as AskEndEvent;
      mutateModel((m) => resolveAskBlock(m, event.id, undefined, false));
      setBlocks((prev) => prev.filter((b) => b.id !== event.id));
    });

    client.on('variables', (data) => {
      const event = data as VariablesEvent;
      setBlocks((prev) => [
        ...prev,
        { id: nextId(), type: 'variables', data: event.vars },
      ]);
    });

    // Only a real server wire error (a string `message`) becomes a transcript error. A socket
    // transport failure rides the client's separate `'socket_error'` channel now, so this no longer
    // renders a messageless DOM Event as the literal text "undefined".
    client.on('error', (data) => {
      const event = data as Partial<ErrorEvent>;
      if (typeof event.message !== 'string') return;
      const message = event.message;
      mutateModel((m) => pushErrorBlock(m, message));
      setBlocks((prev) => [...prev, { id: nextId(), type: 'error', data: message }]);
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

  return { blocks, model: modelRef.current, sendMessage, submitForm, cancelAsk, isConnected, isDone };
}
