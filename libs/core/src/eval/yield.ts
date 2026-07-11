import type { QuickJSHandle } from 'quickjs-emscripten';

export interface YieldRequest {
  kind: 'ask' | 'inspect' | 'loadKnowledge' | 'sleep' | 'tasklist' | 'fork' | 'delegate' | 'registerSpace' | 'fetch' | 'setSessionMeta' | 'apiCall' | 'callConnection' | 'readDocument' | 'tool' | 'integrationStatus';
  args: unknown[];
  deferred: { resolve: (v: unknown) => void; reject: (e: unknown) => void };
  vmPromiseHandle: QuickJSHandle | undefined;
}

export const pendingYields: YieldRequest[] = [];
