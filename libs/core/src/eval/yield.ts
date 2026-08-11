import type { QuickJSHandle } from 'quickjs-emscripten';

export interface YieldRequest {
  kind: 'ask' | 'inspect' | 'loadKnowledge' | 'sleep' | 'tasklist' | 'fork' | 'delegate' | 'registerSpace' | 'fetch' | 'hostFs' | 'hostCdp' | 'apiCall' | 'callConnection' | 'readDocument' | 'integrationStatus' | 'consent' | 'storeSearch' | 'storeInspect' | 'installSpace' | 'emitEvent' | 'teamContext' | 'teamMembers' | 'teamChannels' | 'teamHistory' | 'teamPost' | 'teamPinApp' | 'teamCreateChannel' | 'teamMemory' | 'teamRemember';
  args: unknown[];
  deferred: { resolve: (v: unknown) => void; reject: (e: unknown) => void };
  vmPromiseHandle: QuickJSHandle | undefined;
}

export const pendingYields: YieldRequest[] = [];
