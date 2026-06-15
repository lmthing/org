import { useState, useEffect, useCallback, useRef } from 'react';
import { ReplRpcClient, type ReplClientConfig } from './rpc-client.js';

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

export function useReplSession(target: string | ReplClientConfig): {
  blocks: ReplBlock[];
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

  const nextId = () => {
    blockIdCounter.current++;
    return String(blockIdCounter.current);
  };

  const depKey = typeof target === 'string' ? target : `${target.baseUrl}#${target.sessionId}`;

  useEffect(() => {
    const client = new ReplRpcClient(target);
    clientRef.current = client;

    client.on('connect', () => setIsConnected(true));
    client.on('disconnect', () => setIsConnected(false));

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

  return { blocks, sendMessage, submitForm, cancelAsk, isConnected, isDone };
}
