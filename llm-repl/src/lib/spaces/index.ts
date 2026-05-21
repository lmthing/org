export { Space, buildDtsFromFiles } from './space.js';
export type { SpaceHandle, SpaceComponentKind, SpaceEntryKind, OrphanedClassVar } from './space.js';
export {
  loadSpace,
  createDynamicSpaceLoader,
} from './loader.js';
export type {
  AgentAction,
  LoadedAgent,
  FlowStep,
  ParsedFlow,
  KnowledgeConfig,
  ResolvedComponents,
  DynamicSpaceLoaderOptions,
  DynamicSpaceLoaderHandle,
  SpawnConfig,
  SpawnResult,
} from './loader.js';
