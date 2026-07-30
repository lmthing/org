import type { QuickJSHandle } from 'quickjs-emscripten';

export interface YieldRequest {
  kind: 'ask' | 'inspect' | 'loadKnowledge' | 'sleep' | 'tasklist' | 'fork' | 'delegate' | 'registerSpace' | 'fetch' | 'apiCall' | 'buildApp' | 'callConnection' | 'readDocument' | 'integrationStatus' | 'consent' | 'storeSearch' | 'storeInspect' | 'installSpace' | 'emitEvent' | 'teamContext' | 'teamMembers' | 'teamChannels' | 'teamHistory' | 'teamPost' | 'teamPinApp';
  args: unknown[];
  deferred: { resolve: (v: unknown) => void; reject: (e: unknown) => void };
  vmPromiseHandle: QuickJSHandle | undefined;
}

export const pendingYields: YieldRequest[] = [];
