export { Space, buildDtsFromFiles } from './space.js';
export type { SpaceHandle, SpaceComponentKind, SpaceEntryKind, OrphanedClassVar } from './space.js';
export {
  loadSpace,
  createDynamicSpaceLoader,
  registerActiveSpace,
  setSessionContext,
} from './loader.js';
export { loadSpaceFromDisk } from './disk.js';
export { LIBRARY_AMBIENT_DTS } from './library-dts.js';
export { extractOverlayDts } from './overlay-dts.js';
export type { ExtractOverlayDtsOpts, OverlayDtsResult } from './overlay-dts.js';
export { parseFrontmatter, parseFrontmatterBlock } from './frontmatter.js';
export type { ParsedFrontmatter } from './frontmatter.js';
export {
  loadAgent,
  loadFlow,
  loadKnowledge,
  listAgents,
  listFlows,
  buildAgentPrompt,
  buildUserPrompt,
} from './prompt-builder.js';
export type {
  LoadedAgent,
  LoadedFlow,
  FlowStep,
  FlowSink,
  KnowledgeSlice,
  BuildPromptInput,
  BuiltPrompt,
} from './prompt-builder.js';
export type {
  LoadSpaceFromDiskOpts,
  LoadedDiskSpace,
  DiskAgent,
  DiskFlow,
  DiskFlowStep,
  DiskKnowledgeDomain,
  DiskKnowledgeField,
  DiskKnowledgeOption,
} from './disk.js';
export type {
  AgentAction,
  ParsedFlow,
  KnowledgeConfig,
  ResolvedComponents,
  DynamicSpaceLoaderOptions,
  DynamicSpaceLoaderHandle,
  SpawnConfig,
  SpawnResult,
} from './loader.js';
