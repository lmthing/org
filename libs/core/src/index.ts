// Session types
export type { RenderHost, SessionOpts, SessionDeps, Clock } from './session/types.js';

// Sandbox
export { BoundaryDetector } from './sandbox/boundary.js';
export { createVM } from './sandbox/quickjs.js';
export type { VM, VMOpts, EvalResult } from './sandbox/quickjs.js';
export { marshalToQuickJS, marshalToHost, injectGlobal } from './sandbox/host-bridge.js';
export { JSX_RUNTIME_CODE } from './sandbox/jsx-runtime.js';
export { injectSpaceFunctions } from './sandbox/inject-functions.js';
export { Tracer, NULL_TRACER } from './sandbox/trace.js';
export type { TraceEvent, TraceScope, NodeKind, NodeStatus, NodeDetail, TraceAttachment } from './sandbox/trace.js';
export { buildTraceTree, applyEvent } from './sandbox/trace-tree.js';
export type { TraceTree, TreeNode, LlmCall, StatementEntry, YieldEntry, DisplayEntry } from './sandbox/trace-tree.js';

// Typecheck
export { runTsc } from './typecheck/tsc.js';
export type { TscResult, TscDiagnostic, TscOpts } from './typecheck/tsc.js';
export { LIBRARY_DTS } from './typecheck/library-dts.js';
export { buildOverlay } from './typecheck/overlay.js';

// Design-system UI catalog + cross-platform form normalization
export {
  CATALOG, DISPLAY_CATALOG, FORM_CATALOG, CATALOG_BY_NAME, CATALOG_NAMES,
  isFormComponent, catalogDts, catalogSummary,
} from './ui/catalog.js';
export type { CatalogEntry, CatalogProp } from './ui/catalog.js';
export {
  flattenForm, normalizeOptions, coerceValue, defaultFor, isFormDescriptor, isCatalogForm,
} from './ui/form.js';
export type { FieldSpec, FieldKind, FormSpec, Option } from './ui/form.js';

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
export { createRegisterSpaceGlobal } from './globals/register-space.js';
export type { RegisterSpaceResult } from './globals/register-space.js';
export { createSetSessionMetaGlobal } from './globals/set-session-meta.js';
export type { SessionMetaInput, SetSessionMetaResult } from './globals/set-session-meta.js';

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
export { routeCommonYield } from './eval/yield-router.js';
export type { YieldRouterContext, RouteResult } from './eval/yield-router.js';

// Stream types
export type {
  StreamOpts,
  StreamSession,
  StreamMessage,
  MediaPart,
  ImagePart,
  FilePart,
} from './eval/stream-types.js';

// Turn loop
export { runTurnLoop } from './eval/turn-loop.js';
export type { TurnLoopDeps } from './eval/turn-loop.js';
export { buildErrorBlock } from './eval/error-rewind.js';

// Budget guardrails
export { Budget, BudgetExceededError } from './eval/budget.js';
export type { BudgetLimits, BudgetKind, BudgetSnapshot } from './eval/budget.js';

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
export type { UserInput, UserAttachment } from './session/session.js';
export { saveSnapshot, loadSnapshot } from './session/snapshot.js';
export type { Snapshot } from './session/snapshot.js';

// Tasklist
export { validateDag, topoSort, findReadyTasks, resolveGoalTask } from './tasklist/dag.js';
export { validateOutput, validateInput } from './tasklist/schema.js';
export { evaluateCondition } from './tasklist/condition-dsl.js';
export { runTasklist } from './tasklist/orchestrator.js';

// Fork
export { ForkEngine } from './fork/fork.js';
export type { ForkTask, ForkEngineOpts, ForkResultMeta } from './fork/fork.js';
export { normalizeRole, rolePreamble, roleProfile, modelForRole } from './fork/roles.js';
export type { ForkRole, RoleModelConfig } from './fork/roles.js';

// Exec unification — shared child-VM wiring (capability profile, bootstrap,
// ForkEngine options builder, delegate-target matcher, statement protocol)
export { sessionCapabilities, forkCapabilities, delegateCapabilities, intersectAppCaps } from './exec/capability.js';
export type { CapabilityProfile } from './exec/capability.js';
export { createChildVM, buildAmbientDts, CURRENT_TASK_DTS } from './exec/bootstrap.js';
export type { ChildVMOpts, AmbientDtsOpts } from './exec/bootstrap.js';
export { injectAppGlobals } from './exec/app-globals.js';
export type { AppGlobalImpls, AuthoringResult, ProjectResult } from './exec/app-globals.js';

// Project-app layer (Phase 1 foundation): db schema + runtime API interfaces +
// fail-loud validator, and the parsed capability model. Storage engine is in libs/cli.
export type {
  DbApi, AsyncDbApi, ApiCallFn, ConnectionRequest, ConnectionResolver, ConnectionResponse, SpawnFn, Row, QueryOpts, UpdateOpts, RemoveOpts,
  TableSchema, ColumnSchema, RelationSchema, LoadedTable, ColumnType, GeneratedKind, OnDelete, ColumnReference,
} from './db/index.js';
export { validateTableSchema, validateSchemaSet, isBelongsTo, isHasMany } from './db/index.js';
export { parseCapabilities, CAPABILITY_IDS, DB_CAPABILITY_IDS } from './spaces/capabilities.js';
export type { AppCapabilities, CapabilityId } from './spaces/capabilities.js';
export { forkEngineOptsFrom } from './exec/fork-config.js';
export type { ForkEngineParentContext } from './exec/fork-config.js';
export { resolveTaskDelegate, refMatchesDelegateCall, evaluateDelegatePolicy, isDelegateAllowed, formatDelegateDenial, matchesRegisteredSpace, REGISTERED_WILDCARD } from './exec/target-match.js';
export type { DelegatePolicy, DelegatePolicyLevel, DelegateAllowance } from './exec/target-match.js';
export { STATEMENT_PROTOCOL } from './exec/preamble.js';
export { salvageData } from './exec/envelope.js';
export type { TaskEnvelope, DegradeReason } from './exec/envelope.js';
export { runPrelude, splitPreludeStatements } from './exec/prelude.js';
export type { RunPreludeOpts, PreludeResult, PreludeFailure } from './exec/prelude.js';

// Delegate
export { DelegateRegistry } from './delegate/registry.js';
export { runDelegate } from './delegate/delegate.js';
export type { RunDelegateOpts } from './delegate/delegate.js';

// Testing — scripted mock provider (run end-to-end with no API keys)
export { createMockStreamFn, mockScript, mockMatch } from './testing/mock-provider.js';
export type { MockHandler, MockContext, MockRule } from './testing/mock-provider.js';
