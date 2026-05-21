/**
 * Space loader skeleton — Phase 0 stub.
 *
 * Combines type signatures from cli/src/cli/agent-loader.ts and
 * repl/src/spaces/dynamic-loader.ts. The full Space class implementation
 * lands in Phase 11 (L10).
 *
 * Only exports type signatures and no-op stubs — do NOT use at runtime yet.
 */

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

// ── Space handle (surface API stub) ──

export interface SpaceHandle {
  loadAgent(role: string): void
  loadFunction(name: string, opts?: { expand?: boolean }): void
  loadComponent(name: string): void
  loadKnowledge(domain: string, field: string, option?: string): void
  agents: Record<string, unknown>
  functions: Record<string, unknown>
  components: Record<string, unknown>
}

// ── Stub implementations — NOT for production use ──

/**
 * Stub: load a space by name.
 * Full implementation lands in Phase 11 (L10).
 */
export function loadSpace(_name: string): SpaceHandle {
  throw new Error('loadSpace: not implemented — Phase 11 (L10)')
}

/**
 * Stub: create a dynamic space loader handle.
 * Full implementation lands in Phase 11 (L10).
 */
export function createDynamicSpaceLoader(
  _options: DynamicSpaceLoaderOptions,
): DynamicSpaceLoaderHandle {
  throw new Error('createDynamicSpaceLoader: not implemented — Phase 11 (L10)')
}
