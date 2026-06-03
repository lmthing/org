// Session types
export type { RenderHost, SessionOpts, SessionDeps, Clock } from './session/types.js';

// Sandbox
export { BoundaryDetector } from './sandbox/boundary.js';
export { createVM } from './sandbox/quickjs.js';
export type { VM, VMOpts, EvalResult } from './sandbox/quickjs.js';
export { marshalToQuickJS, marshalToHost, injectGlobal } from './sandbox/host-bridge.js';
export { JSX_RUNTIME_CODE } from './sandbox/jsx-runtime.js';
export { Tracer } from './sandbox/trace.js';
export type { TraceEvent } from './sandbox/trace.js';

// Typecheck
export { runTsc } from './typecheck/tsc.js';
export type { TscResult, TscDiagnostic, TscOpts } from './typecheck/tsc.js';
export { LIBRARY_DTS } from './typecheck/library-dts.js';
export { buildOverlay } from './typecheck/overlay-dts.js';

// Globals
export { serialize } from './globals/serialize.js';
export type { SerializeOpts } from './globals/serialize.js';
export { createAskGlobal } from './globals/ask.js';
export { createDisplayGlobal } from './globals/display.js';
export { createInspectGlobal, applyQuery, formatInspectResult } from './globals/inspect.js';
export type { InspectQuery } from './globals/inspect.js';
export { createSleepGlobal, parseDuration } from './globals/sleep.js';
export { createLoadKnowledgeGlobal, loadKnowledgeFile } from './globals/load-knowledge.js';
export { createForkGlobal } from './globals/fork.js';
export type { ForkGlobalOpts } from './globals/fork.js';
export { createDelegateGlobal } from './globals/delegate.js';
export type { DelegateOpts } from './globals/delegate.js';
export { createTasklistGlobal } from './globals/tasklist.js';

// Context
export { emitVariables, extractBindingNames } from './context/variables.js';
export { MessageHistory } from './context/history.js';
export type { Message, MessageRole } from './context/history.js';
export { buildSystemBlock } from './context/system-block.js';
export type { SystemBlockOpts } from './context/system-block.js';
export { summarizeHistory } from './context/summarize.js';
export type { SummarizeOpts } from './context/summarize.js';

// Yield protocol
export type { YieldRequest } from './eval/yield.js';
export { pendingYields } from './eval/yield.js';

// Stream types
export type { StreamOpts, StreamSession } from './eval/stream-types.js';

// Turn loop
export { runTurnLoop } from './eval/turn-loop.js';
export type { TurnLoopDeps } from './eval/turn-loop.js';
export { buildErrorBlock } from './eval/error-rewind.js';

// Spaces
export { loadSpace } from './spaces/load.js';
export type {
  Space,
  AgentDef,
  ActionDef,
  AgentConfig,
  TasklistDir,
  KnowledgeTree,
  KnowledgeDomain,
  KnowledgeField,
} from './spaces/load.js';
export { getAgentFunctions, resolveDirectDeps } from './spaces/agent.js';
export type { ResolvedDep } from './spaces/agent.js';
export {
  loadSystemSpaces,
  mergeSystemInto,
  defaultSystemSpaceDirs,
  systemFunctionNames,
  SYSTEM_SPACE_NAMES,
} from './spaces/system.js';
export { injectHostTools } from './globals/host-tools.js';
export type { HostToolsProfile } from './globals/host-tools.js';
export { getAgentComponents } from './spaces/components.js';
export { resolveKnowledge } from './spaces/knowledge.js';
export { parseFrontmatter } from './spaces/frontmatter.js';
export { loadTasklist, loadTasklistFromSpace } from './spaces/tasklist-load.js';
export type { TaskNode } from './spaces/tasklist-load.js';

// Session
export { Session } from './session/session.js';
export { saveSnapshot, loadSnapshot } from './session/snapshot.js';
export type { Snapshot } from './session/snapshot.js';

// Tasklist
export { validateDag, topoSort, findReadyTasks } from './tasklist/dag.js';
export { validateOutput } from './tasklist/schema.js';
export { evaluateCondition } from './tasklist/condition-dsl.js';
export { runTasklist } from './tasklist/orchestrator.js';

// Fork
export { ForkEngine } from './fork/fork.js';
export type { ForkTask } from './fork/fork.js';

// Delegate
export { DelegateRegistry } from './delegate/registry.js';
export { runDelegate } from './delegate/delegate.js';
export type { RunDelegateOpts } from './delegate/delegate.js';
