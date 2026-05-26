import { Space } from './space.js';
import type { SpaceHandle } from './space.js';
import type { TraceWriter } from '../sandbox/trace.js';

// ── Agent loader types (from cli/src/cli/agent-loader.ts) ──

export interface AgentAction {
  id: string
  label: string
  description: string
  flow: string
}

export interface LoadedAgent {
  title: string
  model?: string
  instruct: string
  actions: AgentAction[]
  knowledgeDefaults: Record<string, any>
  catalogModules: string[]
  localFunctions: string[]
  componentRefs: string[]
  enabledAgents: Record<string, string[] | true>
  mcpServers: Record<string, {
    command?: string
    args?: string[]
    env?: Record<string, string>
    url?: string
    headers?: Record<string, string>
  }>
}

export interface FlowStep {
  number: number
  name: string
  id: string
  description: string
  instructions: string
  outputTarget?: string
  outputSchema?: Record<string, any>
}

export interface ParsedFlow {
  name: string
  description: string
  steps: FlowStep[]
}

export interface KnowledgeConfig {
  hiddenFields: Map<string, Set<string>>
  preloadOptions: Array<{ domain: string; field: string; option: string }>
}

export interface ResolvedComponents {
  localPaths: string[]
  catalogGroups: string[]
}

// ── Dynamic space loader types (from repl/src/spaces/dynamic-loader.ts) ──

export interface DynamicSpaceLoaderOptions {
  /** Root directory containing spaces. */
  spacesDir: string
  /** Callback for spawning agents when namespaces are called. */
  onSpawn?: (config: SpawnConfig) => Promise<SpawnResult>
  /** Log callback for reload events. */
  onReload?: (spaceName: string) => void
  /** Function to rebuild agent namespaces from spaces directory. */
  rebuildNamespaces?: (spacesDir: string) => Promise<{
    agentTree: Record<string, unknown>
    knowledgeNamespace: Record<string, unknown>
  }>
}

export interface DynamicSpaceLoaderHandle {
  /** Start watching spaces. */
  start: () => Promise<void>
  /** Stop watching spaces. */
  stop: () => Promise<void>
  /** Manually trigger a reload of all spaces. */
  reload: () => Promise<void>
  /** Check if currently watching. */
  isWatching: () => boolean
}

export interface SpawnConfig {
  spaceDir: string
  spaceName: string
  agentSlug: string
  actionId: string
  request: string
  params: Record<string, any>
}

export interface SpawnResult {
  scope: Record<string, any>
  result: any
  keyFiles?: string[]
  issues?: string[]
}

export { SpaceHandle } from './space.js';

// ── Loader Registry and Context ──

const activeSpaces = new Map<string, SpaceHandle>();
let currentSessionDir: string = '';
let currentTrace: TraceWriter | null = null;
let currentSpacesDir: string = '';

export function registerActiveSpace(name: string, handle: SpaceHandle): void {
  activeSpaces.set(name, handle);
}

export function setSessionContext(sessionDir: string, trace: TraceWriter, spacesDir: string): void {
  currentSessionDir = sessionDir;
  currentTrace = trace;
  currentSpacesDir = spacesDir;
}

/**
 * Load a space by name, returning its active SpaceHandle.
 */
export function loadSpace(name: string): SpaceHandle {
  const handle = activeSpaces.get(name);
  if (!handle) {
    if (!currentSessionDir || !currentTrace) {
      throw new Error(`loadSpace('${name}'): Session context not set`);
    }
    const space = new Space(name, { sessionDir: currentSessionDir, trace: currentTrace });
    
    // Construct a minimal handle synchronously to satisfy signature
    const lazyHandle: SpaceHandle = {
      name,
      agents: {},
      functions: {},
      components: {},
      knowledge: {},
      loadFunction(fnName, opts) {
        lazyHandle.functions[fnName] = opts?.expand
          ? `/* expanded — inspect() to view full interface */`
          : `/* collapsed class — call loadFunction('${fnName}', { expand: true }) then inspect() */`;
      },
      async read(p) { return space.read(p); },
      async write(p, c) { return space.write(p, c); },
      async patch(p, f, t) { return space.patch(p, f, t); },
      async list(p) { return space.list(p); },
      async remove(p) { return space.remove(p); },
    };
    
    activeSpaces.set(name, lazyHandle);
    
    // Asynchronously load files in background
    space.load().then((fullHandle) => {
      Object.assign(lazyHandle, fullHandle);
    }).catch(() => {});
    
    return lazyHandle;
  }
  return handle;
}

/**
 * Create a dynamic space loader handle.
 */
export function createDynamicSpaceLoader(
  options: DynamicSpaceLoaderOptions,
): DynamicSpaceLoaderHandle {
  let watching = false;
  return {
    async start() {
      watching = true;
    },
    async stop() {
      watching = false;
    },
    async reload() {
      options.onReload?.('*');
    },
    isWatching: () => watching,
  };
}
