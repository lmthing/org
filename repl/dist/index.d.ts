import { ReactElement } from 'react';
import { EventEmitter } from 'node:events';
import { z } from 'zod';
import vm from 'node:vm';
import ts from 'typescript';
export { F as FocusController, S as SectionName, a as SystemPromptBuilder, b as SystemPromptConfig, c as buildSystemPromptFromConfig } from './focus-Du18EYz5.js';

/**
 * Simple Git client for auto-committing file changes.
 *
 * Uses node:child_process to run git commands without external dependencies.
 */
interface GitClientOptions {
    /** Working directory (repo root). Defaults to process.cwd(). */
    workingDir?: string;
    /** Author name for commits. */
    authorName?: string;
    /** Author email for commits. */
    authorEmail?: string;
}
interface GitCommitResult {
    ok: boolean;
    hash?: string;
    error?: string;
}
interface GitStatusResult {
    exists: boolean;
    isRepo: boolean;
    hasChanges: boolean;
    branch?: string;
}
/**
 * Simple Git client for auto-committing agent file changes.
 */
declare class GitClient {
    private workingDir;
    private authorName;
    private authorEmail;
    constructor(options?: GitClientOptions);
    /**
     * Check if git repo exists and has changes.
     */
    getStatus(): Promise<GitStatusResult>;
    /**
     * Stage and commit a file change with a descriptive message.
     */
    commitFile(filePath: string, message: string): Promise<GitCommitResult>;
    /**
     * Stage and commit multiple files at once.
     */
    commitFiles(filePaths: string[], message: string): Promise<GitCommitResult>;
    /**
     * Get the current git status as a string.
     * Only shows changes to tracked files (not untracked files).
     */
    getStatusString(): Promise<string>;
    /**
     * Check if a specific file has uncommitted changes.
     */
    isFileChanged(filePath: string): Promise<boolean>;
}
/**
 * Create a default git client for auto-commits.
 */
declare function createGitClient(options?: GitClientOptions): GitClient;

interface AgentSpawnOptions {
    context: "empty" | "branch";
}
interface AgentSpawnConfig {
    spaceDir: string;
    spaceName: string;
    agentSlug: string;
    actionId: string;
    request: string;
    params: Record<string, any>;
    options: AgentSpawnOptions;
    /** Internal: links spawn to registry entry for Phase 1e child-to-parent questions. */
    _originPromise?: unknown;
}
interface AgentSpawnResult {
    scope: Record<string, any>;
    result: any;
    keyFiles?: string[];
    issues?: string[];
}
interface SerializedValue {
    value: unknown;
    display: string;
}
interface StopPayload {
    [argNameOrExpression: string]: SerializedValue;
}
interface ErrorPayload {
    type: string;
    message: string;
    line: number;
    source: string;
}
interface AsyncCancellation {
    cancelled: true;
    message: string;
}
interface AskCancellation {
    _cancelled: true;
}
interface ClassMethodInfo {
    name: string;
    description: string;
    signature: string;
}
interface TaskDefinition {
    id: string;
    instructions: string;
    outputSchema: Record<string, {
        type: string;
    }>;
    dependsOn?: string[];
    condition?: string;
    optional?: boolean;
}
interface Tasklist {
    tasklistId: string;
    description: string;
    tasks: TaskDefinition[];
}
interface TaskCompletion {
    output: Record<string, any>;
    timestamp: number;
    status: 'completed' | 'failed' | 'skipped';
    error?: string;
    duration?: number;
}
interface TasklistState {
    plan: Tasklist;
    completed: Map<string, TaskCompletion>;
    readyTasks: Set<string>;
    runningTasks: Set<string>;
    outputs: Map<string, Record<string, any>>;
    progressMessages: Map<string, {
        message: string;
        percent?: number;
    }>;
    retryCount: Map<string, number>;
}
interface TasklistsState {
    tasklists: Map<string, TasklistState>;
}
type AgentStatus = 'running' | 'waiting' | 'resolved' | 'failed';
interface AgentPromiseEntry {
    varName: string;
    label: string;
    status: AgentStatus;
    promise: Promise<unknown>;
    childSession: Session | null;
    resolvedValue?: unknown;
    error?: string;
    registeredAt: number;
    completedAt?: number;
    registeredTurn: number;
    pendingQuestion?: {
        message: string;
        schema: Record<string, unknown>;
    } | null;
}
interface AgentSnapshot {
    varName: string;
    label: string;
    status: AgentStatus;
    tasklistsState: TasklistsState | null;
    pendingQuestion: {
        message: string;
        schema: Record<string, unknown>;
    } | null;
    error?: string;
    valueIncluded?: boolean;
}
interface ScopeEntry {
    name: string;
    type: string;
    value: string;
}
type ASTPattern = {
    type: string;
    [property: string]: unknown;
} | {
    oneOf: ASTPattern[];
} | {
    type: string;
    not: ASTPattern;
};
interface HookMatch {
    node: unknown;
    source: string;
    captures: Record<string, unknown>;
}
interface HookContext {
    lineNumber: number;
    sessionId: string;
    scope: ScopeEntry[];
}
type HookAction = {
    type: 'continue';
} | {
    type: 'side_effect';
    fn: () => void | Promise<void>;
} | {
    type: 'transform';
    newSource: string;
} | {
    type: 'interrupt';
    message: string;
} | {
    type: 'skip';
    reason?: string;
};
interface Hook {
    id: string;
    label: string;
    pattern: ASTPattern;
    phase: 'before' | 'after';
    handler: (match: HookMatch, ctx: HookContext) => HookAction | Promise<HookAction>;
}
type SessionStatus = 'idle' | 'executing' | 'waiting_for_input' | 'paused' | 'complete' | 'error';
interface StreamPauseController {
    pause(): void;
    resume(): void;
    isPaused(): boolean;
}
interface StatementExecutor {
    execute(code: string, lineNumber: number): Promise<LineResult>;
    getScope(): ScopeEntry[];
    getScopeValue(name: string): unknown;
}
interface LineResult {
    ok: boolean;
    result?: unknown;
    error?: ErrorPayload;
}
interface RenderSurface {
    append(id: string, element: ReactElement): void;
    renderForm(id: string, element: ReactElement): Promise<Record<string, unknown>>;
    cancelForm(id: string): void;
    appendTasklistProgress?(tasklistId: string, state: TasklistState): void;
    updateTasklistProgress?(tasklistId: string, state: TasklistState): void;
    updateTaskProgress?(tasklistId: string, taskId: string, message: string, percent?: number): void;
}
type SessionEvent = {
    type: 'code';
    lines: string;
    blockId: string;
} | {
    type: 'code_complete';
    blockId: string;
    lineCount: number;
} | {
    type: 'read';
    payload: Record<string, unknown>;
    blockId: string;
} | {
    type: 'error';
    error: ErrorPayload;
    blockId: string;
} | {
    type: 'hook';
    hookId: string;
    action: string;
    detail: string;
    blockId: string;
} | {
    type: 'display';
    componentId: string;
    jsx: SerializedJSX;
} | {
    type: 'ask_start';
    formId: string;
    jsx: SerializedJSX;
} | {
    type: 'ask_end';
    formId: string;
} | {
    type: 'async_start';
    taskId: string;
    label: string;
} | {
    type: 'async_progress';
    taskId: string;
    elapsed: number;
} | {
    type: 'async_complete';
    taskId: string;
    elapsed: number;
} | {
    type: 'async_failed';
    taskId: string;
    error: string;
} | {
    type: 'async_cancelled';
    taskId: string;
} | {
    type: 'tasklist_declared';
    tasklistId: string;
    plan: Tasklist;
} | {
    type: 'task_complete';
    tasklistId: string;
    id: string;
    output: Record<string, any>;
} | {
    type: 'task_complete_continue';
    tasklistId: string;
    completedTaskId: string;
    readyTasks: Array<{
        id: string;
        instructions: string;
        outputSchema: Record<string, {
            type: string;
        }>;
    }>;
} | {
    type: 'tasklist_reminder';
    tasklistId: string;
    ready: string[];
    blocked: string[];
    failed: string[];
} | {
    type: 'task_failed';
    tasklistId: string;
    id: string;
    error: string;
} | {
    type: 'task_retried';
    tasklistId: string;
    id: string;
} | {
    type: 'task_skipped';
    tasklistId: string;
    id: string;
    reason: string;
} | {
    type: 'task_progress';
    tasklistId: string;
    id: string;
    message: string;
    percent?: number;
} | {
    type: 'task_async_start';
    tasklistId: string;
    id: string;
} | {
    type: 'task_async_complete';
    tasklistId: string;
    id: string;
    output: Record<string, any>;
} | {
    type: 'task_async_failed';
    tasklistId: string;
    id: string;
    error: string;
} | {
    type: 'task_order_violation';
    tasklistId: string;
    attemptedTaskId: string;
    readyTasks: Array<{
        id: string;
        instructions: string;
        outputSchema: Record<string, {
            type: string;
        }>;
    }>;
} | {
    type: 'knowledge_loaded';
    domains: string[];
} | {
    type: 'class_loaded';
    className: string;
    methods: string[];
} | {
    type: 'spawn_start';
    childId: string;
    context: string;
    directive: string;
} | {
    type: 'spawn_complete';
    childId: string;
    turns: number;
    duration: number;
} | {
    type: 'spawn_error';
    childId: string;
    error: string;
} | {
    type: 'agent_spawn_start';
    spaceName: string;
    agentSlug: string;
    actionId: string;
} | {
    type: 'agent_spawn_complete';
    spaceName: string;
    agentSlug: string;
    actionId: string;
    result: AgentSpawnResult;
} | {
    type: 'agent_spawn_failed';
    spaceName: string;
    agentSlug: string;
    actionId: string;
    error: string;
} | {
    type: 'agent_registered';
    varName: string;
    label: string;
} | {
    type: 'agent_resolved';
    varName: string;
} | {
    type: 'agent_failed';
    varName: string;
    error: string;
} | {
    type: 'agent_question_asked';
    varName: string;
    question: {
        message: string;
        schema: Record<string, unknown>;
    };
} | {
    type: 'agent_question_answered';
    varName: string;
} | {
    type: 'knowledge_saved';
    domain: string;
    field: string;
    option: string;
} | {
    type: 'knowledge_removed';
    domain: string;
    field: string;
    option: string;
} | {
    type: 'file_write';
    path: string;
    blockId: string;
} | {
    type: 'file_diff';
    path: string;
    blockId: string;
} | {
    type: 'file_error';
    path: string;
    error: string;
    blockId: string;
} | {
    type: 'status';
    status: SessionStatus;
} | {
    type: 'scope';
    entries: ScopeEntry[];
};
interface SerializedJSX {
    component: string;
    props: Record<string, unknown>;
    children?: (SerializedJSX | string)[];
}
interface SessionSnapshot {
    status: SessionStatus;
    blocks: Array<{
        type: string;
        id: string;
        data: unknown;
    }>;
    scope: ScopeEntry[];
    asyncTasks: Array<{
        id: string;
        label: string;
        status: string;
        elapsed: number;
    }>;
    activeFormId: string | null;
    tasklistsState: TasklistsState;
    agentEntries: Array<{
        varName: string;
        label: string;
        status: AgentStatus;
        error?: string;
    }>;
}

interface AsyncTask {
    id: string;
    label: string;
    abortController: AbortController;
    promise: Promise<void>;
    status: 'running' | 'completed' | 'failed' | 'cancelled';
    startTime: number;
    result?: unknown;
    error?: string;
}
/**
 * Manages background async tasks spawned by async() calls.
 */
declare class AsyncManager {
    private tasks;
    private results;
    private counter;
    private maxTasks;
    constructor(maxTasks?: number);
    /**
     * Register a new background task.
     */
    register(fn: (signal: AbortSignal) => Promise<void>, label?: string): string;
    /**
     * Cancel a task by ID.
     */
    cancel(taskId: string, message?: string): boolean;
    /**
     * Store a result from a task's scoped stop() call.
     */
    setResult(taskId: string, value: unknown): void;
    /**
     * Drain all accumulated results and clear the results map.
     */
    drainResults(): Map<string, unknown>;
    /**
     * Get a task by ID.
     */
    getTask(taskId: string): AsyncTask | undefined;
    /**
     * Get all tasks.
     */
    getAllTasks(): AsyncTask[];
    /**
     * Get count of currently running tasks.
     */
    getRunningCount(): number;
    /**
     * Build the async portion of a stop payload.
     * Running tasks show "pending", completed ones show their results.
     */
    buildStopPayload(): Record<string, unknown>;
    /**
     * Wait for all running tasks to complete, with timeout.
     */
    drain(timeoutMs?: number): Promise<void>;
    /**
     * Cancel all running tasks.
     */
    cancelAll(): void;
}

/**
 * Represents a knowledge domain (top-level folder in knowledge/).
 */
interface KnowledgeDomain {
    slug: string;
    label: string;
    description: string;
    icon: string;
    color: string;
    fields: KnowledgeField[];
}
/**
 * Represents a field within a knowledge domain.
 */
interface KnowledgeField {
    slug: string;
    label: string;
    description: string;
    fieldType: 'select' | 'multiSelect' | 'text' | 'number';
    required: boolean;
    default?: string;
    variableName: string;
    options: KnowledgeOption[];
}
/**
 * Represents a selectable option within a field (parsed from .md frontmatter).
 */
interface KnowledgeOption {
    slug: string;
    title: string;
    description: string;
    order: number;
}
/**
 * The full knowledge tree for a space — used to show the agent what's available.
 */
interface KnowledgeTree {
    /** Space name (directory basename), used for grouping in the prompt */
    name?: string;
    domains: KnowledgeDomain[];
}
/**
 * Flat selector (no space names): { domainSlug: { fieldSlug: { optionSlug: true } } }
 */
type FlatKnowledgeSelector = Record<string, Record<string, Record<string, true>>>;
/**
 * Selector object the agent passes to loadKnowledge().
 *
 * With named spaces: { spaceName: { domainSlug: { fieldSlug: { optionSlug: true } } } }
 * Without spaces:    { domainSlug: { fieldSlug: { optionSlug: true } } }
 *
 * The loader auto-detects the format based on whether space names are configured.
 */
type KnowledgeSelector = Record<string, any>;
/**
 * Flat content (no space names): { domainSlug: { fieldSlug: { optionSlug: markdownString } } }
 */
type FlatKnowledgeContent = Record<string, Record<string, Record<string, string>>>;
/**
 * Loaded knowledge content returned to the agent.
 * Same shape as the selector but with markdown content instead of `true`.
 */
type KnowledgeContent = Record<string, any>;

interface GlobalsConfig {
    pauseController: StreamPauseController;
    renderSurface: RenderSurface;
    asyncManager: AsyncManager;
    serializationLimits?: {
        maxStringLength?: number;
        maxArrayElements?: number;
        maxObjectKeys?: number;
        maxDepth?: number;
    };
    askTimeout?: number;
    onStop?: (payload: StopPayload, source: string) => void;
    onDisplay?: (id: string) => void;
    onAsyncStart?: (taskId: string, label: string) => void;
    onTasklistDeclared?: (tasklistId: string, plan: Tasklist) => void;
    onTaskComplete?: (tasklistId: string, id: string, output: Record<string, any>) => void;
    onTaskFailed?: (tasklistId: string, id: string, error: string) => void;
    onTaskRetried?: (tasklistId: string, id: string) => void;
    onTaskSkipped?: (tasklistId: string, id: string, reason: string) => void;
    onTaskProgress?: (tasklistId: string, id: string, message: string, percent?: number) => void;
    onTaskAsyncStart?: (tasklistId: string, id: string) => void;
    onTaskAsyncComplete?: (tasklistId: string, id: string, output: Record<string, any>) => void;
    onTaskAsyncFailed?: (tasklistId: string, id: string, error: string) => void;
    onTaskOrderViolation?: (tasklistId: string, attemptedTaskId: string, readyTasks: Array<{
        id: string;
        instructions: string;
        outputSchema: Record<string, {
            type: string;
        }>;
    }>) => void;
    onTaskCompleteContinue?: (tasklistId: string, completedTaskId: string, readyTasks: Array<{
        id: string;
        instructions: string;
        outputSchema: Record<string, {
            type: string;
        }>;
    }>) => void;
    maxTaskRetries?: number;
    maxTasksPerTasklist?: number;
    sleepMaxSeconds?: number;
    onLoadKnowledge?: (selector: KnowledgeSelector) => KnowledgeContent;
    /** Validate a class name and return its methods (no side effects). */
    getClassInfo?: (className: string) => {
        methods: ClassMethodInfo[];
    } | null;
    /** Signal that loadClass was called — emits events, injects bindings. Called after pause. */
    onLoadClass?: (className: string) => void;
    /** Spawn a child agent session. Used by agent namespace globals. */
    onSpawn?: (config: AgentSpawnConfig) => Promise<AgentSpawnResult>;
    /** Route child agent's askParent() to parent. Set only for tracked child sessions. */
    onAskParent?: (question: {
        message: string;
        schema: Record<string, unknown>;
    }) => Promise<Record<string, unknown>>;
    /** Whether this is a fire-and-forget child (untracked). askParent resolves immediately. */
    isFireAndForget?: boolean;
    /** Deliver structured input to a child agent's pending askParent(). */
    onRespond?: (promise: unknown, data: Record<string, unknown>) => void;
    /** Return a context budget snapshot for the agent. */
    onContextBudget?: () => ContextBudgetSnapshot;
    /** Execute a reflection LLM call and return the assessment. */
    onReflect?: (request: ReflectRequest) => Promise<ReflectResult>;
    /** Execute speculative branches in parallel sandboxes. */
    onSpeculate?: (branches: SpeculateBranch[], timeout: number) => Promise<SpeculateResult>;
    /** Compress data via an LLM call. */
    onCompress?: (data: string, options: CompressOptions) => Promise<string>;
    /** Fork a lightweight child agent for sub-reasoning. */
    onFork?: (request: ForkRequest) => Promise<ForkResult>;
    /** Return execution profiling data. */
    onTrace?: () => TraceSnapshot;
    /** Generate a task plan from a natural language goal via LLM. */
    onPlan?: (goal: string, constraints?: string[]) => Promise<Array<{
        id: string;
        instructions: string;
        dependsOn?: string[];
    }>>;
    /** Critique output quality via LLM. */
    onCritique?: (output: string, criteria: string[], context?: string) => Promise<CritiqueResult>;
    /** Persist a learning to the knowledge base for cross-session memory. */
    onLearn?: (topic: string, insight: string, tags?: string[]) => Promise<void>;
    /** Snapshot current sandbox scope for checkpoint(). */
    onCheckpoint?: () => {
        values: Map<string, unknown>;
        declaredNames: Set<string>;
    };
    /** Restore sandbox scope from a checkpoint. */
    onRollback?: (snapshot: {
        values: Map<string, unknown>;
        declaredNames: Set<string>;
    }) => void;
    /** Search past reasoning by semantic similarity. */
    onVectorSearch?: (query: string, topK: number) => Promise<Array<{
        turn: number;
        score: number;
        text: string;
        code: string;
    }>>;
}
interface VectorMatch$1 {
    turn: number;
    score: number;
    text: string;
    code: string;
}
interface TraceSnapshot {
    turns: number;
    llmCalls: number;
    llmTokens: {
        input: number;
        output: number;
        total: number;
    };
    estimatedCost: string;
    asyncTasks: {
        completed: number;
        failed: number;
        running: number;
    };
    scopeSize: number;
    pinnedCount: number;
    memoCount: number;
    sessionDurationMs: number;
}
interface CritiqueResult {
    pass: boolean;
    overallScore: number;
    scores: Record<string, number>;
    issues: string[];
    suggestions: string[];
}
interface CheckpointData {
    id: string;
    timestamp: number;
    scopeSnapshot: Map<string, unknown>;
    declaredNames: Set<string>;
}
interface ForkRequest {
    task: string;
    context?: Record<string, unknown>;
    outputSchema?: Record<string, {
        type: string;
    }>;
    maxTurns?: number;
}
interface ForkResult {
    output: Record<string, unknown>;
    turns: number;
    success: boolean;
    error?: string;
}
interface CompressOptions {
    preserveKeys?: string[];
    maxTokens?: number;
    format?: 'structured' | 'prose';
}
interface SpeculateBranch {
    label: string;
    fn: () => unknown;
}
interface SpeculateBranchResult {
    label: string;
    ok: boolean;
    result?: unknown;
    error?: string;
    durationMs: number;
}
interface SpeculateResult {
    results: SpeculateBranchResult[];
}
interface ReflectRequest {
    question: string;
    context?: Record<string, unknown>;
    criteria?: string[];
}
interface ReflectResult {
    assessment: string;
    scores: Record<string, number>;
    suggestions: string[];
    shouldPivot: boolean;
}
interface ContextBudgetSnapshot {
    totalTokens: number;
    usedTokens: number;
    remainingTokens: number;
    systemPromptTokens: number;
    messageHistoryTokens: number;
    turnNumber: number;
    decayLevel: {
        stops: string;
        knowledge: string;
    };
    recommendation: 'nominal' | 'conserve' | 'critical';
}
/**
 * Create the twelve global functions: stop, display, ask, async, tasklist, completeTask, completeTaskAsync, taskProgress, failTask, retryTask, sleep, loadKnowledge.
 * These use callback interfaces, never importing stream-controller or session directly.
 */
declare function createGlobals(config: GlobalsConfig): {
    stop: (...values: unknown[]) => Promise<void>;
    display: (element: unknown) => void;
    ask: (element: unknown) => Promise<Record<string, unknown>>;
    async: (fn: () => Promise<void>, label?: string) => void;
    tasklist: (tasklistId: string, description: string, tasks: Tasklist["tasks"]) => void;
    completeTask: (tasklistId: string, id: string, output: Record<string, any>) => void;
    completeTaskAsync: (tasklistId: string, taskId: string, fn: () => Promise<Record<string, any>>) => void;
    taskProgress: (tasklistId: string, taskId: string, message: string, percent?: number) => void;
    failTask: (tasklistId: string, taskId: string, error: string) => void;
    retryTask: (tasklistId: string, taskId: string) => void;
    sleep: (seconds: number) => Promise<void>;
    loadKnowledge: (selector: KnowledgeSelector) => KnowledgeContent;
    loadClass: (className: string) => void;
    askParent: (message: string, schema?: Record<string, unknown>) => Promise<Record<string, unknown>>;
    respond: (promise: unknown, data: Record<string, unknown>) => void;
    contextBudget: () => ContextBudgetSnapshot;
    pin: (key: string, value: unknown) => void;
    unpin: (key: string) => void;
    memo: (key: string, value?: string | null) => string | undefined;
    reflect: (request: ReflectRequest) => Promise<ReflectResult>;
    speculate: (branches: Array<{
        label: string;
        fn: () => unknown;
    }>, options?: {
        timeout?: number;
    }) => Promise<SpeculateResult>;
    vectorSearch: (query: string, topK?: number) => Promise<VectorMatch$1[]>;
    compress: (data: unknown, options?: CompressOptions) => Promise<string>;
    fork: (request: ForkRequest) => Promise<ForkResult>;
    focus: (...sections: string[]) => void;
    guard: (condition: unknown, message: string) => void;
    trace: () => TraceSnapshot;
    checkpoint: (id: string) => string;
    rollback: (id: string) => void;
    parallel: (tasks: Array<{
        label: string;
        fn: () => unknown;
    }>, options?: {
        timeout?: number;
        failFast?: boolean;
    }) => Promise<Array<{
        label: string;
        ok: boolean;
        result?: unknown;
        error?: string;
        durationMs: number;
    }>>;
    plan: (goal: string, constraints?: string[]) => Promise<Array<{
        id: string;
        instructions: string;
        dependsOn?: string[];
    }>>;
    critique: (output: string, criteria: string[], context?: string) => Promise<CritiqueResult>;
    learn: (topic: string, insight: string, tags?: string[]) => Promise<void>;
    broadcast: (channel: string, data: unknown) => void;
    listen: (channel: string, callback?: (data: unknown) => void) => unknown[] | (() => void);
    delegate: (task: string | (() => unknown), options?: {
        strategy?: "auto" | "fork" | "parallel" | "direct";
        timeout?: number;
        context?: Record<string, unknown>;
    }) => Promise<{
        strategy: string;
        result: unknown;
        durationMs: number;
    }>;
    schema: (value: unknown) => Record<string, unknown>;
    validate: (value: unknown, schema: Record<string, unknown>) => {
        valid: boolean;
        errors?: string[];
    };
    cachedFetch: (url: string, options?: {
        method?: string;
        headers?: Record<string, string>;
        body?: string;
        cacheTtlMs?: number;
        maxRetries?: number;
        parseAs?: "json" | "text";
        timeout?: number;
    }) => Promise<{
        data: unknown;
        cached: boolean;
        status: number;
        durationMs: number;
    }>;
    pipeline: (data: unknown, ...transforms: Array<{
        name: string;
        fn: (input: unknown) => unknown;
    }>) => Promise<{
        result: unknown;
        steps: Array<{
            name: string;
            durationMs: number;
            ok: boolean;
            error?: string;
        }>;
    }>;
    watch: (variableName: string, callback: (newVal: unknown, oldVal: unknown) => void) => () => void;
    setCurrentSource: (source: string) => void;
    resolveStop: () => void;
    getTasklistsState: () => TasklistsState;
    getPinnedMemory: () => Map<string, {
        value: unknown;
        display: string;
        turn: number;
    }>;
    getMemoMemory: () => Map<string, string>;
    getFocusSections: () => Set<string> | null;
    setPinTurn: (turn: number) => void;
    checkWatchers: (getVar: (name: string) => unknown) => void;
};

interface SessionConfig {
    functionTimeout: number;
    askTimeout: number;
    sessionTimeout: number;
    maxStopCalls: number;
    maxAsyncTasks: number;
    maxTasklistReminders: number;
    maxTaskRetries: number;
    maxTasksPerTasklist: number;
    taskAsyncTimeout: number;
    sleepMaxSeconds: number;
    maxContextTokens: number;
    serializationLimits: {
        maxStringLength: number;
        maxArrayElements: number;
        maxObjectKeys: number;
        maxDepth: number;
    };
    workspace: {
        maxScopeVariables: number;
        maxScopeValueWidth: number;
        maxScopeTokens: number;
    };
    contextWindow: {
        codeWindowLines: number;
        stopDecayTiers: {
            full: number;
            keysOnly: number;
            summary: number;
        };
        neverTruncateInterventions: boolean;
    };
}
declare function createDefaultConfig(): SessionConfig;
declare const sessionConfigSchema: z.ZodObject<{
    functionTimeout: z.ZodOptional<z.ZodNumber>;
    askTimeout: z.ZodOptional<z.ZodNumber>;
    sessionTimeout: z.ZodOptional<z.ZodNumber>;
    maxStopCalls: z.ZodOptional<z.ZodNumber>;
    maxAsyncTasks: z.ZodOptional<z.ZodNumber>;
    maxTasklistReminders: z.ZodOptional<z.ZodNumber>;
    maxTaskRetries: z.ZodOptional<z.ZodNumber>;
    maxTasksPerTasklist: z.ZodOptional<z.ZodNumber>;
    taskAsyncTimeout: z.ZodOptional<z.ZodNumber>;
    sleepMaxSeconds: z.ZodOptional<z.ZodNumber>;
    maxContextTokens: z.ZodOptional<z.ZodNumber>;
    serializationLimits: z.ZodOptional<z.ZodObject<{
        maxStringLength: z.ZodOptional<z.ZodNumber>;
        maxArrayElements: z.ZodOptional<z.ZodNumber>;
        maxObjectKeys: z.ZodOptional<z.ZodNumber>;
        maxDepth: z.ZodOptional<z.ZodNumber>;
    }, z.core.$strip>>;
    workspace: z.ZodOptional<z.ZodObject<{
        maxScopeVariables: z.ZodOptional<z.ZodNumber>;
        maxScopeValueWidth: z.ZodOptional<z.ZodNumber>;
        maxScopeTokens: z.ZodOptional<z.ZodNumber>;
    }, z.core.$strip>>;
    contextWindow: z.ZodOptional<z.ZodObject<{
        codeWindowLines: z.ZodOptional<z.ZodNumber>;
        stopDecayTiers: z.ZodOptional<z.ZodObject<{
            full: z.ZodOptional<z.ZodNumber>;
            keysOnly: z.ZodOptional<z.ZodNumber>;
            summary: z.ZodOptional<z.ZodNumber>;
        }, z.core.$strip>>;
        neverTruncateInterventions: z.ZodOptional<z.ZodBoolean>;
    }, z.core.$strip>>;
}, z.core.$strip>;
type PartialSessionConfig = z.infer<typeof sessionConfigSchema>;
declare function validateConfig(input: unknown): {
    valid: true;
    config: PartialSessionConfig;
} | {
    valid: false;
    errors: string[];
};
declare function mergeConfig(overrides: PartialSessionConfig): SessionConfig;

interface AgentRegistryConfig {
    onRegistered?: (varName: string, label: string) => void;
    onResolved?: (varName: string) => void;
    onFailed?: (varName: string, error: string) => void;
    onQuestionAsked?: (varName: string, question: {
        message: string;
        schema: Record<string, unknown>;
    }) => void;
    onQuestionAnswered?: (varName: string) => void;
}
declare class AgentRegistry {
    private entries;
    private questionResolvers;
    private currentTurn;
    private config;
    constructor(config?: AgentRegistryConfig);
    register(varName: string, promise: Promise<unknown>, label: string, childSession: Session | null): void;
    resolve(varName: string, value: unknown): void;
    fail(varName: string, error: string): void;
    getAll(): AgentPromiseEntry[];
    getPending(): AgentPromiseEntry[];
    getSnapshot(varName: string): AgentSnapshot | null;
    getAllSnapshots(): AgentSnapshot[];
    findByPromise(promise: unknown): AgentPromiseEntry | null;
    advanceTurn(): void;
    getCurrentTurn(): number;
    hasEntries(): boolean;
    hasVisibleEntries(): boolean;
    /**
     * Low-level setter — updates entry status and question fields.
     * Prefer askQuestion() for the full flow (sets question + returns Promise).
     */
    setPendingQuestion(varName: string, question: {
        message: string;
        schema: Record<string, unknown>;
    }): void;
    /**
     * Ask a question on behalf of a child agent. Sets status to 'waiting',
     * stores the question, and returns a Promise that resolves when the
     * parent calls respond().
     */
    askQuestion(varName: string, question: {
        message: string;
        schema: Record<string, unknown>;
    }): Promise<Record<string, unknown>>;
    /**
     * Deliver structured input to a child agent's pending askParent() call.
     * Resolves the Promise returned by askQuestion(), clears the pending
     * question, and sets the agent back to 'running'.
     */
    respond(varName: string, data: Record<string, unknown>): void;
    destroy(): void;
}

type TurnBoundary = {
    type: 'stop';
    payload: Record<string, {
        display: string;
        type: string;
    }>;
} | {
    type: 'error';
    error: {
        type: string;
        message: string;
        line: number;
        source: string;
    };
} | {
    type: 'intervention';
    text: string;
} | {
    type: 'hook_interrupt';
    hookId: string;
    message: string;
} | {
    type: 'tasklist_reminder';
    tasklistId: string;
    ready: string[];
    blocked: string[];
    failed: string[];
} | {
    type: 'completion';
};
interface ScopeDelta {
    added: ScopeEntry[];
    changed: Array<ScopeEntry & {
        previousValue: string;
        previousType: string;
    }>;
    removed: string[];
}
type TurnEvent = {
    type: 'display';
    componentId: string;
} | {
    type: 'ask_start';
    formId: string;
} | {
    type: 'ask_end';
    formId: string;
} | {
    type: 'async_start';
    taskId: string;
    label: string;
} | {
    type: 'async_complete';
    taskId: string;
} | {
    type: 'async_failed';
    taskId: string;
    error: string;
} | {
    type: 'async_cancelled';
    taskId: string;
} | {
    type: 'tasklist_declared';
    tasklistId: string;
    description: string;
    taskCount: number;
} | {
    type: 'task_complete';
    tasklistId: string;
    taskId: string;
} | {
    type: 'task_failed';
    tasklistId: string;
    taskId: string;
    error: string;
} | {
    type: 'task_retried';
    tasklistId: string;
    taskId: string;
} | {
    type: 'task_skipped';
    tasklistId: string;
    taskId: string;
    reason: string;
} | {
    type: 'task_progress';
    tasklistId: string;
    taskId: string;
    message: string;
    percent?: number;
} | {
    type: 'knowledge_loaded';
    domains: string[];
} | {
    type: 'class_loaded';
    className: string;
    methods: string[];
} | {
    type: 'hook';
    hookId: string;
    action: string;
} | {
    type: 'agent_registered';
    varName: string;
    label: string;
} | {
    type: 'agent_resolved';
    varName: string;
} | {
    type: 'agent_failed';
    varName: string;
    error: string;
};
interface ConversationTurn {
    /** Monotonically increasing turn index (0-based) */
    index: number;
    /** Timestamp when the turn started */
    startedAt: number;
    /** Timestamp when the turn boundary was hit */
    endedAt: number;
    /** Role of this turn */
    role: 'assistant' | 'user' | 'system';
    /** For assistant turns: the code lines written */
    code: string[] | null;
    /** For user turns: the message text */
    message: string | null;
    /** What caused this turn to end (null for user turns) */
    boundary: TurnBoundary | null;
    /** Scope snapshot after this turn */
    scopeSnapshot: ScopeEntry[];
    /** Scope delta compared to the previous turn */
    scopeDelta: ScopeDelta | null;
    /** Events that occurred during this turn */
    events: TurnEvent[];
}
interface SerializedTaskCompletion {
    output: Record<string, any>;
    timestamp: number;
    status: 'completed' | 'failed' | 'skipped';
    error?: string;
    duration?: number;
}
interface SerializedTasklistState {
    plan: {
        tasklistId: string;
        description: string;
        tasks: TaskDefinition[];
    };
    completed: Record<string, SerializedTaskCompletion>;
    readyTasks: string[];
    runningTasks: string[];
    outputs: Record<string, Record<string, any>>;
    progressMessages: Record<string, {
        message: string;
        percent?: number;
    }>;
    retryCount: Record<string, number>;
}
interface SerializedTasklistsState {
    tasklists: Record<string, SerializedTasklistState>;
}
interface ConversationState {
    /** Session start timestamp */
    startedAt: number;
    /** All turns in chronological order */
    turns: ConversationTurn[];
    /** Current tasklist state (serializable) */
    tasklists: SerializedTasklistsState;
    /** Total stop calls so far */
    stopCount: number;
    /** Current session status */
    status: SessionStatus;
}
/**
 * Compute what changed in scope between two snapshots.
 */
declare function computeScopeDelta(previous: ScopeEntry[], current: ScopeEntry[]): ScopeDelta;
/**
 * Convert TasklistsState (Map/Set) to a plain JSON-serializable object.
 */
declare function serializeTasklistsState(state: TasklistsState): SerializedTasklistsState;
/**
 * Builds a serializable ConversationState incrementally at each turn boundary.
 */
declare class ConversationRecorder {
    private state;
    private previousScope;
    private pendingEvents;
    private currentTurnStartedAt;
    constructor();
    /** Record an assistant turn ending at a stop boundary. */
    recordStop(code: string[], payload: StopPayload, scope: ScopeEntry[], tasklists: TasklistsState): void;
    /** Record an assistant turn ending at an error boundary. */
    recordError(code: string[], error: ErrorPayload, scope: ScopeEntry[]): void;
    /** Record an assistant turn ending at an intervention boundary. */
    recordIntervention(code: string[], text: string, scope: ScopeEntry[]): void;
    /** Record an assistant turn ending at a tasklist reminder boundary. */
    recordTasklistReminder(code: string[], tasklistId: string, ready: string[], blocked: string[], failed: string[], scope: ScopeEntry[], tasklists: TasklistsState): void;
    /** Record session completion. */
    recordCompletion(code: string[], scope: ScopeEntry[], tasklists: TasklistsState, status: SessionStatus): void;
    /** Record a user message turn. */
    recordUserMessage(text: string, scope: ScopeEntry[]): void;
    /** Accumulate a session event (filtered to TurnEvent subset). */
    recordEvent(event: SessionEvent): void;
    /** Update session status. */
    updateStatus(status: SessionStatus): void;
    /** Get the current full conversation state (returns a shallow copy). */
    getState(): ConversationState;
    private pushTurn;
}

/**
 * Tracks which file paths have been read by the agent this session.
 * Used to enforce the read-before-patch safety gate for diff operations.
 */
interface ReadLedger {
    paths: Set<string>;
}

interface SessionOptions {
    config?: Partial<SessionConfig>;
    hooks?: Hook[];
    globals?: Record<string, unknown>;
    knowledgeLoader?: (selector: KnowledgeSelector) => KnowledgeContent;
    /** Return class info without side effects (validation only). */
    getClassInfo?: (className: string) => {
        methods: ClassMethodInfo[];
    } | null;
    /** Load a class: instantiate, bind methods, inject into sandbox. */
    loadClass?: (className: string, session: Session) => void;
    /** Agent namespace globals to inject into the sandbox. */
    agentNamespaces?: Record<string, unknown>;
    /** Spawn a child agent session. Used by agent namespace globals. */
    onSpawn?: (config: AgentSpawnConfig) => Promise<AgentSpawnResult>;
    /** Route child agent's askParent() to parent. Set for tracked child sessions. */
    onAskParent?: (question: {
        message: string;
        schema: Record<string, unknown>;
    }) => Promise<Record<string, unknown>>;
    /** Whether this is a fire-and-forget child (untracked). askParent resolves immediately. */
    isFireAndForget?: boolean;
    /** Knowledge namespace global (built-in, always available if configured). */
    knowledgeNamespace?: Record<string, unknown>;
    /**
     * Working directory for file block operations (4-backtick write/diff blocks).
     * Defaults to process.cwd(). Paths are validated to stay within this directory.
     */
    fileWorkingDir?: string;
    /** Callback to get context budget snapshot for the agent. */
    onContextBudget?: () => ContextBudgetSnapshot;
    /** Callback to execute a reflection LLM call. */
    onReflect?: (request: ReflectRequest) => Promise<ReflectResult>;
    /** Callback to search past reasoning by semantic similarity. */
    onVectorSearch?: (query: string, topK: number) => Promise<Array<{
        turn: number;
        score: number;
        text: string;
        code: string;
    }>>;
    /** Callback to compress data via LLM. */
    onCompress?: (data: string, options: CompressOptions) => Promise<string>;
    /** Callback to fork a lightweight child agent. */
    onFork?: (request: ForkRequest) => Promise<ForkResult>;
    /** Callback to get execution profiling data. */
    onTrace?: () => TraceSnapshot;
    /** Callback for LLM-powered task planning. */
    onPlan?: (goal: string, constraints?: string[]) => Promise<Array<{
        id: string;
        instructions: string;
        dependsOn?: string[];
    }>>;
    /** Callback for LLM-powered output critique. */
    onCritique?: (output: string, criteria: string[], context?: string) => Promise<CritiqueResult>;
    /** Callback to persist a learning to cross-session memory. */
    onLearn?: (topic: string, insight: string, tags?: string[]) => Promise<void>;
    /** Callback to run parallel speculation branches in isolated sandboxes. */
    onSpeculate?: (branches: SpeculateBranch[], timeout: number) => Promise<SpeculateResult>;
    /** Git client for auto-committing file writes. */
    gitClient?: GitClient;
    /** Whether to auto-commit after file writes. Default: true if gitClient provided. */
    autoCommit?: boolean;
}
declare class Session extends EventEmitter {
    private status;
    private config;
    private sandbox;
    private asyncManager;
    private hookRegistry;
    private streamController;
    private globalsApi;
    private blocks;
    private codeLines;
    private messages;
    private activeFormId;
    private stopCount;
    private tasklistReminderCount;
    private agentRegistry;
    private recorder;
    private turnCodeStart;
    private onSpawn?;
    private readLedger;
    private fileWorkingDir;
    private vectorIndex;
    private currentTurn;
    private options;
    constructor(options?: SessionOptions);
    private executeStatement;
    private handleStop;
    private handleError;
    private handleFileBlock;
    /**
     * Get the read ledger for this session.
     * Pass to setReadLedger() in the fs catalog module to track readFile() calls.
     */
    getReadLedger(): ReadLedger;
    /**
     * Handle a user message.
     */
    handleUserMessage(text: string): Promise<void>;
    /**
     * Feed tokens from the LLM stream.
     */
    feedToken(token: string): Promise<void>;
    /**
     * Finalize the LLM stream.
     * Returns 'complete' if done, or 'tasklist_incomplete' if tasks remain.
     */
    finalize(): Promise<'complete' | 'tasklist_incomplete'>;
    /**
     * Resolve a pending stop() call, allowing sandbox to continue.
     * Called by the runner after injecting the stop payload as a user message.
     */
    resolveStop(): void;
    /**
     * Inject a value into the sandbox as a global.
     * Used to inject class namespace objects after loadClass().
     */
    injectGlobal(name: string, value: unknown): void;
    /**
     * Resolve a pending ask() form.
     */
    resolveAsk(formId: string, data: Record<string, unknown>): void;
    /**
     * Cancel a pending ask() form.
     */
    cancelAsk(formId: string): void;
    /**
     * Cancel an async task.
     */
    cancelAsyncTask(taskId: string, message?: string): void;
    /**
     * Pause the session.
     */
    pause(): void;
    /**
     * Resume the session.
     */
    resume(): void;
    /**
     * Handle user intervention (message while agent is running).
     */
    handleIntervention(text: string): void;
    /**
     * Get a snapshot of the current session state.
     */
    snapshot(): SessionSnapshot;
    /**
     * Get the full serializable conversation state.
     */
    getConversationState(): ConversationState;
    /**
     * Get the current status.
     */
    getStatus(): SessionStatus;
    /**
     * Get messages for context.
     */
    getMessages(): Array<{
        role: string;
        content: string;
    }>;
    /**
     * Get the public globals object (for passing to setup functions).
     */
    getGlobals(): Record<string, Function>;
    /**
     * Get the agent registry.
     */
    getAgentRegistry(): AgentRegistry;
    /**
     * Get scope table as string.
     */
    getScopeTable(): string;
    /**
     * Get raw scope entries (for internal use like speculate).
     */
    getScope(): ScopeEntry[];
    getPinnedMemory(): Map<string, {
        value: unknown;
        display: string;
        turn: number;
    }>;
    getMemoMemory(): Map<string, string>;
    getFocusSections(): Set<string> | null;
    private setStatus;
    private emitEvent;
    /**
     * Destroy the session and clean up resources.
     */
    destroy(): void;
}

interface SandboxOptions {
    timeout?: number;
    globals?: Record<string, unknown>;
    /** Resource limits for the sandbox. */
    resourceLimits?: SandboxResourceLimits;
}
interface SandboxResourceLimits {
    /** Max total execution time in ms across all lines (default: 300_000 = 5 min). */
    maxTotalExecutionMs?: number;
    /** Max number of lines that can be executed (default: 5000). */
    maxLines?: number;
    /** Max number of declared variables (default: 500). */
    maxVariables?: number;
}
interface SandboxResourceUsage {
    totalExecutionMs: number;
    linesExecuted: number;
    variableCount: number;
    limits: Required<SandboxResourceLimits>;
}
/**
 * The REPL sandbox — manages a persistent vm.Context for line-by-line execution.
 */
declare class Sandbox {
    private context;
    private declaredNames;
    private lineCount;
    private timeout;
    private totalExecutionMs;
    private resourceLimits;
    constructor(options?: SandboxOptions);
    /**
     * Execute a line of TypeScript in the sandbox.
     */
    execute(code: string): Promise<LineResult>;
    /**
     * Inject a value into the sandbox's global scope.
     */
    inject(name: string, value: unknown): void;
    /**
     * Get a value from the sandbox scope.
     */
    getValue(name: string): unknown;
    /**
     * Get all user-declared variable names.
     */
    getDeclaredNames(): string[];
    /**
     * Get the current scope as ScopeEntry[].
     */
    getScope(): ScopeEntry[];
    /**
     * Get the line count.
     */
    getLineCount(): number;
    /**
     * Get the raw vm.Context (for advanced use).
     */
    getContext(): vm.Context;
    /**
     * Get current resource usage and limits.
     */
    getResourceUsage(): SandboxResourceUsage;
    /**
     * Snapshot all declared variable values (deep clone via structuredClone).
     */
    snapshotScope(): {
        values: Map<string, unknown>;
        declaredNames: Set<string>;
    };
    /**
     * Restore sandbox scope from a snapshot. Removes variables not in the snapshot,
     * restores values for those that are, and updates declaredNames.
     */
    restoreScope(snapshot: {
        values: Map<string, unknown>;
        declaredNames: Set<string>;
    }): void;
    /**
     * Destroy the sandbox.
     */
    destroy(): void;
}

/**
 * Transpile a TypeScript statement to JavaScript.
 * Uses transpile-only mode (no type checking).
 */
declare function transpile(code: string): string;

/**
 * Execute a single line of TypeScript in the given sandbox context.
 * Handles both declarations (which must persist in scope) and expressions.
 */
declare function executeLine(code: string, lineNumber: number, context: vm.Context, timeout?: number): Promise<LineResult>;

/**
 * VectorIndex — in-memory TF-IDF semantic search on past reasoning.
 *
 * No external dependencies. Uses TF-IDF (term frequency–inverse document frequency)
 * with cosine similarity to find semantically similar comment blocks and code.
 *
 * Usage:
 *   const index = new VectorIndex();
 *   index.index("// Calculate sum of array", const sum = arr.reduce(...), turn);
 *   const results = index.search("array summation");
 */
interface VectorMatch {
    turn: number;
    score: number;
    text: string;
    code: string;
}
interface VectorIndexOptions {
    maxDocuments?: number;
    minTermLength?: number;
    stopWords?: Set<string>;
}
/**
 * TF-IDF vector index for semantic search on code + comments.
 */
declare class VectorIndex {
    private documents;
    private idf;
    private options;
    constructor(options?: VectorIndexOptions);
    /**
     * Tokenize text into terms, filtering stop words and short terms.
     */
    private tokenize;
    /**
     * Compute TF-IDF score for a term in a document.
     */
    private tfIdf;
    /**
     * Compute cosine similarity between two term vectors.
     */
    private cosineSimilarity;
    /**
     * Index a document (text + code) for a given turn.
     * Extracts comments from code for semantic indexing.
     */
    index(text: string, code: string, turn: number): void;
    /**
     * Extract comments from code (single-line and multi-line).
     */
    private extractComments;
    /**
     * Recompute IDF scores for all terms.
     */
    private recomputeIdf;
    /**
     * Search for similar documents using TF-IDF cosine similarity.
     */
    search(query: string, topK?: number): VectorMatch[];
    /**
     * Get number of indexed documents.
     */
    get size(): number;
    /**
     * Clear all indexed documents.
     */
    clear(): void;
}

interface BracketState {
    round: number;
    curly: number;
    square: number;
    inString: false | "'" | '"' | '`';
    inLineComment: boolean;
    inBlockComment: boolean;
    templateDepth: number;
    /** JSX nesting depth — tracks open/close tag pairs */
    jsxDepth: number;
    /**
     * JSX tag parsing state:
     * - 'none': not inside a JSX tag
     * - 'pending_open': saw '<', waiting for next char to classify
     * - 'open': inside an opening tag <Component ...
     * - 'close': inside a closing tag </Component...
     * - 'selfclose_pending': saw '/' inside opening tag, waiting for '>'
     */
    jsxTagState: 'none' | 'pending_open' | 'open' | 'close' | 'selfclose_pending';
}
declare function createBracketState(): BracketState;
/**
 * Feed a chunk of text into the bracket tracker, updating state character by character.
 * Returns the updated state (mutates and returns the same object for performance).
 */
declare function feedChunk(state: BracketState, chunk: string): BracketState;
/**
 * Returns true if all brackets are balanced and we're not inside a string/comment.
 */
declare function isBalanced(state: BracketState): boolean;
/**
 * Reset the bracket state.
 */
declare function resetBracketState(state: BracketState): void;

type Statement = {
    type: 'code';
    source: string;
} | {
    type: 'file_write';
    path: string;
    content: string;
} | {
    type: 'file_diff';
    path: string;
    diff: string;
};
type FileBlockStatement = Extract<Statement, {
    type: 'file_write' | 'file_diff';
}>;
type AccumulatorMode = 'typescript' | 'file_block_header' | 'file_write' | 'file_diff';
interface LineAccumulator {
    buffer: string;
    bracketState: BracketState;
    mode: AccumulatorMode;
    /** Backticks seen consecutively when buffer is all-whitespace (potential file block start). */
    pendingBackticks: number;
    fileBlockHeader: string;
    fileBlockPath: string;
    fileBlockContent: string;
    fileBlockCurrentLine: string;
}
declare function createLineAccumulator(): LineAccumulator;
interface FeedResult {
    /** Complete statements (code or file blocks) that were flushed */
    statements: Statement[];
    /** Whether there's still content in the buffer */
    hasRemaining: boolean;
}
/**
 * Feed a token (chunk of text) into the accumulator.
 * Returns any complete statements that were detected.
 */
declare function feed(acc: LineAccumulator, token: string): FeedResult;
/**
 * Flush any remaining content in the buffer as a statement.
 * Called when the LLM stream ends.
 * File blocks in progress are discarded (no closing marker arrived).
 */
declare function flush(acc: LineAccumulator): Statement | null;
/**
 * Clear the accumulator without returning any content.
 */
declare function clear(acc: LineAccumulator): void;

declare class HookRegistry {
    private hooks;
    private failureCounts;
    private disabledHooks;
    private maxConsecutiveFailures;
    constructor(maxConsecutiveFailures?: number);
    register(hook: Hook): void;
    unregister(id: string): boolean;
    get(id: string): Hook | undefined;
    /**
     * List hooks by phase, excluding disabled hooks.
     */
    listByPhase(phase: 'before' | 'after'): Hook[];
    /**
     * Record a failure for a hook. After maxConsecutiveFailures, disable it.
     */
    recordFailure(id: string): void;
    /**
     * Record a success for a hook (resets failure count).
     */
    recordSuccess(id: string): void;
    isDisabled(id: string): boolean;
    getAll(): Hook[];
    clear(): void;
}

interface StreamControllerOptions {
    onStatement: (source: string) => Promise<LineResult>;
    onStop: (payload: StopPayload, source: string) => void;
    onError: (error: ErrorPayload) => void;
    onEvent: (event: SessionEvent) => void;
    onCodeLine: (line: string) => void;
    hookRegistry: HookRegistry;
    hookContext: () => HookContext;
    /** Called when a 4-backtick file write or diff block is detected in the stream. */
    onFileBlock?: (stmt: FileBlockStatement) => Promise<void>;
}
declare class StreamController implements StreamPauseController {
    private accumulator;
    private paused;
    private pauseResolve;
    private options;
    private lineCount;
    private currentBlockId;
    constructor(options: StreamControllerOptions);
    /**
     * Feed tokens from the LLM stream.
     */
    feedToken(token: string): Promise<void>;
    /**
     * Called when the LLM stream ends. Flush remaining buffer.
     */
    finalize(): Promise<void>;
    private processStatement;
    pause(): void;
    resume(): void;
    isPaused(): boolean;
    private waitForResume;
    /**
     * Clear the line accumulator (e.g., on intervention).
     */
    clearBuffer(): void;
    /**
     * Set the current block ID for events.
     */
    setBlockId(id: string): void;
    private newBlockId;
}

interface SerializationLimits {
    maxStringLength: number;
    maxArrayElements: number;
    maxObjectKeys: number;
    maxDepth: number;
}
/**
 * Serialize a value to a human-readable string for injection into the LLM context.
 * Handles truncation, circular references, and depth limiting.
 */
declare function serialize(value: unknown, limits?: Partial<SerializationLimits>): string;

/**
 * Determines if a buffered string is a complete TypeScript statement.
 * Uses bracket depth, JSX depth, and string context tracking as a heuristic.
 */
declare function isCompleteStatement(buffer: string): boolean;

/**
 * Detects if a source line is a call to one of the six globals.
 * Handles both `stop(...)` and `await stop(...)` patterns.
 */
type GlobalName = 'stop' | 'display' | 'ask' | 'async' | 'tasklist' | 'completeTask' | 'loadKnowledge';
declare function detectGlobalCall(source: string): GlobalName | null;

/**
 * Parse a single TypeScript statement into an AST node.
 */
declare function parseStatement(source: string): ts.Node | null;
/**
 * Extract declared variable names from a statement.
 * Handles const/let/var and destructuring patterns.
 */
declare function extractDeclarations(source: string): string[];
/**
 * Recover argument names from a stop(...) or similar call expression.
 * Given `stop(user.name, x, getX())`, returns:
 *   ["user.name", "x", "arg_2"]
 */
declare function recoverArgumentNames(source: string): string[];
/**
 * Extract all variable names referenced in a source string.
 */
declare function extractVariableNames(source: string): string[];

interface ScopeGeneratorOptions {
    maxVariables?: number;
    maxValueWidth?: number;
}
/**
 * Generate a SCOPE table string from scope entries.
 */
declare function generateScopeTable(entries: ScopeEntry[], options?: ScopeGeneratorOptions): string;
/**
 * Describe the type of a value for the scope table.
 */
declare function describeType(val: unknown): string;
/**
 * Truncate a value for display in the scope table.
 */
declare function truncateValue(val: unknown, maxLen?: number): string;

interface CodeTurn {
    lines: string[];
    declarations: string[];
    turnIndex: number;
}
/**
 * Compress code turns beyond the sliding window.
 * Uses semantic anchoring: keeps high-priority turns (referenced declarations,
 * @keep directives, function/class definitions) and summarizes low-priority ones.
 */
declare function compressCodeWindow(turns: CodeTurn[], maxLines: number): string[];
/**
 * Build a summary comment for a compressed code section.
 */
declare function buildSummaryComment(startLine: number, endLine: number, declarations: string[]): string;

interface DecayTiers {
    full: number;
    keysOnly: number;
    summary: number;
}
type DecayLevel = 'full' | 'keys' | 'count' | 'removed';
/**
 * Determine decay level based on distance from current turn.
 */
declare function getDecayLevel(distance: number, tiers?: DecayTiers): DecayLevel;
/**
 * Apply decay to a stop payload string based on distance.
 */
declare function decayStopPayload(payload: StopPayload, distance: number, tiers?: DecayTiers): string | null;
/**
 * Apply decay to an error payload message.
 */
declare function decayErrorMessage(errorMsg: string, distance: number, tiers?: DecayTiers): string | null;

/**
 * Build the system prompt by replacing slot markers with content.
 */
declare function buildSystemPrompt(template: string, slots: Record<string, string>): string;
/**
 * Update just the {{SCOPE}} slot in an existing system prompt.
 */
declare function updateScopeInPrompt(systemPrompt: string, scopeTable: string): string;

/**
 * Progressive decay for knowledge content in stop payloads.
 *
 * When the agent loads knowledge via loadKnowledge() and reads it via stop(),
 * the markdown content can be very large. As turns progress, older knowledge
 * stop messages are progressively truncated to conserve context window space.
 *
 * Decay tiers (by distance in turns from current):
 *   0     → full content (as serialized)
 *   1     → truncated: first ~300 chars per file + "...(truncated)"
 *   2     → headers: just markdown headings from each file
 *   3+    → names: just the loaded file paths
 */

/** Symbol used to tag objects returned by loadKnowledge(). */
declare const KNOWLEDGE_TAG: unique symbol;
interface KnowledgeDecayTiers {
    /** Distance 0..full: show full content */
    full: number;
    /** Distance full+1..truncated: show truncated content */
    truncated: number;
    /** Distance truncated+1..headers: show headers only */
    headers: number;
}
type KnowledgeDecayLevel = 'full' | 'truncated' | 'headers' | 'names';
declare function getKnowledgeDecayLevel(distance: number, tiers?: KnowledgeDecayTiers): KnowledgeDecayLevel;
/**
 * Check if a value was returned by loadKnowledge() (has the knowledge tag).
 */
declare function isKnowledgeContent(value: unknown): value is KnowledgeContent;
/**
 * Tag an object as knowledge content (called by the loadKnowledge global).
 */
declare function tagAsKnowledge<T extends object>(obj: T): T;
/**
 * Produce a decayed serialization of knowledge content for a stop message.
 */
declare function decayKnowledgeValue(content: KnowledgeContent, distance: number, tiers?: KnowledgeDecayTiers): string;

/**
 * Build a user message for a stop() injection.
 * Format: ← stop { key: value, ... }
 */
declare function buildStopMessage(payload: StopPayload): string;
/**
 * Build a user message for an error injection.
 * Format: ← error [Type] message (line N)
 */
declare function buildErrorMessage(error: ErrorPayload): string;
/**
 * Build a user message for a human intervention.
 * No prefix — raw text.
 */
declare function buildInterventionMessage(text: string): string;
/**
 * Build a user message for a hook interrupt.
 * Format: ⚠ [hook:id] message
 */
declare function buildHookInterruptMessage(hookId: string, message: string): string;
/**
 * Build a user message for an incomplete tasklist reminder.
 * Format: ⚠ [system] Tasklist "tasklistId" incomplete. Remaining: id1, id2. Continue from where you left off.
 */
declare function buildTasklistReminderMessage(tasklistId: string, ready: string[], blocked: string[], failed: string[]): string;
/**
 * Compute the symbol and detail string for a single task, given the tasklist state.
 * Reused by generateTasksBlock and agents-block.ts.
 */
declare function renderTaskLine(task: TaskDefinition, state: TasklistState): {
    symbol: string;
    detail: string;
};
/**
 * Build a user message after a task completion when there are remaining tasks.
 * Guides the agent to the next ready task with its instructions.
 */
declare function buildTaskContinueMessage(tasklistId: string, completedTaskId: string, readyTasks: Array<{
    id: string;
    instructions: string;
    outputSchema: Record<string, {
        type: string;
    }>;
}>, tasklistsState: TasklistsState): string;
/**
 * Build a user message for a task order violation.
 * Stops the stream and guides the agent to the correct next task.
 */
declare function buildTaskOrderViolationMessage(tasklistId: string, attemptedTaskId: string, readyTasks: Array<{
    id: string;
    instructions: string;
    outputSchema: Record<string, {
        type: string;
    }>;
}>, tasklistsState: TasklistsState): string;
/**
 * Generate a {{CURRENT_TASK}} block showing instructions for the next ready task(s).
 * Appended to stop messages alongside {{TASKS}} when tasklists are active.
 */
declare function generateCurrentTaskBlock(tasklistsState: TasklistsState): string | null;
/**
 * Generate the {{TASKS}} block showing current state of all active tasklists.
 * Appended to stop messages when tasklists are active.
 */
declare function generateTasksBlock(tasklistsState: TasklistsState): string | null;

/**
 * Generate the {{AGENTS}} block showing the state of all tracked agent promises.
 * Returns null if no entries are visible.
 */
declare function generateAgentsBlock(registry: AgentRegistry, resolvedInThisStop: Set<string>): string | null;

/**
 * Match an AST pattern against a TypeScript AST node.
 */
declare function matchPattern(node: ts.Node, pattern: ASTPattern, sourceFile: ts.SourceFile): HookMatch | null;
/**
 * Find all matching nodes in a source file for a pattern.
 */
declare function findMatches(sourceFile: ts.SourceFile, pattern: ASTPattern): HookMatch[];

interface HookExecutionResult {
    action: 'execute' | 'skip' | 'interrupt';
    source: string;
    interruptMessage?: string;
    sideEffects: Array<() => void | Promise<void>>;
    matchedHooks: Array<{
        hookId: string;
        action: string;
    }>;
}
/**
 * Run matching hooks for a statement.
 * Returns the final action: execute (possibly with transformed source), skip, or interrupt.
 */
declare function executeHooks(source: string, phase: 'before' | 'after', registry: HookRegistry, context: HookContext): Promise<HookExecutionResult>;

interface RegistryOptions {
    timeout?: number;
    rateLimit?: {
        maxCalls: number;
        windowMs: number;
    };
    onCall?: (name: string, args: unknown[], duration: number) => void;
}
/**
 * Wrap a function with timeout, logging, and rate limiting.
 */
declare function wrapFunction<T extends (...args: any[]) => any>(name: string, fn: T, options?: RegistryOptions): T;
/**
 * Create a function registry that wraps all registered functions.
 */
declare class FunctionRegistry {
    private functions;
    private options;
    constructor(options?: RegistryOptions);
    register(name: string, fn: (...args: any[]) => any): void;
    get(name: string): Function | undefined;
    getAll(): Record<string, Function>;
    has(name: string): boolean;
    names(): string[];
}

interface SanitizationError {
    path: string;
    message: string;
}
/**
 * Validate a serialized JSX tree for security concerns.
 * Returns an array of errors (empty if safe).
 */
declare function sanitizeJSX(jsx: SerializedJSX, path?: string): SanitizationError[];
/**
 * Check if a JSX tree is safe to render.
 */
declare function isJSXSafe(jsx: SerializedJSX): boolean;
/**
 * Validate that an ask() form only contains registered input components.
 */
declare function validateFormComponents(jsx: SerializedJSX, allowedComponents: Set<string>, path?: string): SanitizationError[];

interface CatalogFunction {
    /** Function name — becomes a global in the sandbox */
    name: string;
    /** Human-readable description — injected into system prompt */
    description: string;
    /** TypeScript signature string for the system prompt */
    signature: string;
    /** The actual implementation */
    fn: (...args: unknown[]) => unknown;
}
interface CatalogModule {
    /** Module name (e.g., "fs", "fetch") */
    id: string;
    /** One-line description */
    description: string;
    /** Functions provided by this module */
    functions: CatalogFunction[];
}

interface McpServerConfig {
    command?: string;
    args?: string[];
    env?: Record<string, string>;
    url?: string;
    headers?: Record<string, string>;
}
interface McpServerEntry {
    /** PascalCase server name used as the class/namespace in the sandbox (e.g. "Filesystem") */
    name: string;
    /** Raw key from mcp.json (e.g. "filesystem") */
    key: string;
    /** Tool metadata for the system prompt (populated at load time) */
    methods: ClassMethodInfo[];
    /** Inject this server's tools as a namespace — called when agent runs loadClass(name) */
    inject: (injectGlobal: (name: string, value: unknown) => void) => void;
    /** Close the underlying MCP client connection */
    close: () => Promise<void>;
}
/**
 * Connect to a map of MCP servers and return one McpServerEntry per server.
 * This is the core implementation used by both loadMcpServers() and loadMcpServersFromConfig().
 */
declare function loadMcpServersFromConfig(mcpServers: Record<string, McpServerConfig>, source?: string): Promise<McpServerEntry[]>;
/**
 * Load MCP servers declared in a space's mcp.json.
 * Returns [] if the file does not exist.
 */
declare function loadMcpServers(mcpJsonPath: string): Promise<McpServerEntry[]>;

/**
 * Web Search Catalog Module
 *
 * Provides web search functionality for agents using DuckDuckGo HTML API.
 * No API key required — uses public search results.
 */

/**
 * Web search result.
 */
interface WebSearchResult {
    title: string;
    url: string;
    snippet: string;
}
/**
 * Web search response.
 */
interface WebSearchResponse {
    results: WebSearchResult[];
    query: string;
    totalResults: number;
}
/**
 * Perform a web search using DuckDuckGo HTML API.
 *
 * @param query — Search query
 * @param maxResults — Maximum number of results (default: 10)
 * @returns Search results with titles, URLs, and snippets
 */
declare function webSearch(query: string, maxResults?: number): Promise<WebSearchResponse>;
/**
 * Format web search results for display.
 */
declare function formatWebSearchResults(response: WebSearchResponse): string;

/**
 * Load catalog modules by their IDs.
 * If 'all' is passed, loads all available modules.
 */
declare function loadCatalog(moduleIds: string[] | 'all'): Promise<CatalogModule[]>;
/**
 * Merge multiple catalogs into a flat list of functions.
 */
declare function mergeCatalogs(modules: CatalogModule[]): CatalogFunction[];
/**
 * Get a specific module by ID from a loaded catalog list.
 */
declare function getCatalogModule(modules: CatalogModule[], id: string): CatalogModule | undefined;

/**
 * Generate the system prompt block for catalog functions.
 */
declare function formatCatalogForPrompt(modules: CatalogModule[]): string;

/**
 * Knowledge tree builder and file loader for spaces.
 *
 * Reads a space's knowledge/ directory, builds a tree of domains/fields/options,
 * and provides a loader function that reads selected markdown files on demand.
 */

/**
 * Merge multiple KnowledgeTrees into one. Domains with the same slug are
 * combined (fields are merged); distinct domains are concatenated.
 */
declare function mergeKnowledgeTrees(trees: KnowledgeTree[]): KnowledgeTree;
/**
 * Build a KnowledgeTree from a space's knowledge/ directory.
 */
declare function buildKnowledgeTree(knowledgeDir: string): KnowledgeTree;
/**
 * Load knowledge file contents based on a selector object.
 *
 * The selector mirrors the knowledge tree structure:
 * { domainSlug: { fieldSlug: { optionSlug: true } } }
 *
 * Returns the same structure with markdown content:
 * { domainSlug: { fieldSlug: { optionSlug: "# Title\n..." } } }
 */
declare function loadKnowledgeFiles(knowledgeDir: string, selector: FlatKnowledgeSelector): FlatKnowledgeContent;
/**
 * Format knowledge trees as an XML representation for the system prompt.
 *
 * Accepts a single tree or an array of named trees.
 *
 * ```xml
 * <knowledge>
 *   <space name="cooking">
 *     <domain name="cuisine" icon="🌍" label="Cuisine">
 *       <field name="type" type="select" var="cuisineType">
 *         <option name="italian">Italian — Mediterranean cooking</option>
 *         <option name="japanese">Japanese — East Asian cuisine</option>
 *       </field>
 *     </domain>
 *   </space>
 * </knowledge>
 * ```
 */
declare function formatKnowledgeTreeForPrompt(treeOrTrees: KnowledgeTree | KnowledgeTree[]): string;

/**
 * Knowledge writer — creates, updates, and deletes knowledge files on disk.
 *
 * Used by the built-in `knowledge` agent namespace to persist memories
 * and manage knowledge entries. Files follow the same domain/field/option
 * structure as regular knowledge.
 */
/**
 * Save a knowledge file to disk.
 *
 * Creates domain/field directories and config.json files if they don't exist.
 * Writes the option as a markdown file with frontmatter.
 */
declare function saveKnowledgeFile(knowledgeDir: string, domain: string, field: string, option: string, content: string): void;
/**
 * Delete a knowledge option file.
 */
declare function deleteKnowledgeFile(knowledgeDir: string, domain: string, field: string, option: string): boolean;
/**
 * Ensure the memory domain exists in a knowledge directory.
 *
 * Creates the `memory/` domain with `user`, `project`, `feedback`,
 * and `reference` field directories plus their config.json files.
 * Idempotent — skips already-existing entries.
 */
declare function ensureMemoryDomain(knowledgeDir: string): void;
/**
 * Parse a "domain/field" path from the writer's `field` param.
 * Supports both "domain/field" and plain "field" (defaults to memory domain).
 */
declare function parseFieldPath(fieldParam: string): {
    domain: string;
    field: string;
};

/**
 * THING Agent Entry Point — main interface for agent interactions.
 *
 * Provides the primary entry point for THING agent sessions,
 * with built-in spaces and common task helpers.
 */

interface ThingEntryPointOptions extends Omit<SessionOptions, 'gitClient' | 'autoCommit'> {
    /** Git client for auto-committing file writes. */
    gitClient?: GitClient;
    /** Auto-commit files after writes (default: true). */
    autoCommit?: boolean;
}
/**
 * Create a THING agent session with standard configuration.
 *
 * This is the main entry point for creating THING agent sessions,
 * with sensible defaults and built-in integrations.
 */
declare function createThingSession(options?: ThingEntryPointOptions): Session;
/**
 * Quick start — create a THING agent with minimal setup.
 *
 * @param workingDir — Working directory for file operations
 * @param gitAutoCommit — Enable git auto-commit (default: true)
 */
declare function quickStart(workingDir?: string, gitAutoCommit?: boolean): Session;
/**
 * THING Agent Entry Point Class
 *
 * Wraps a Session with THING-specific convenience methods.
 */
declare class ThingAgent {
    private session;
    constructor(options?: ThingEntryPointOptions);
    /**
     * Send a user message to the agent.
     */
    sendMessage(text: string): Promise<void>;
    /**
     * Get the underlying session.
     */
    getSession(): Session;
    /**
     * Get the agent's current scope.
     */
    getScope(): string;
    /**
     * Get pinned memory.
     */
    getPinned(): Map<string, {
        value: unknown;
        display: string;
        turn: number;
    }>;
    /**
     * Get agent memos.
     */
    getMemos(): Map<string, string>;
    /**
     * Check if agent is currently processing.
     */
    isBusy(): boolean;
    /**
     * Get agent status.
     */
    getStatus(): string;
    /**
     * Destroy the agent session.
     */
    destroy(): void;
}

/**
 * Space creation utilities for agent-generated spaces.
 *
 * Provides helpers for creating complete space structures using file blocks.
 */
interface SpaceMetadata {
    name: string;
    version?: string;
    description?: string;
}
interface AgentDefinition {
    name: string;
    role: string;
    instruct: string;
}
/**
 * Generate a package.json for a space.
 */
declare function generatePackageJson(metadata: SpaceMetadata): string;
/**
 * Generate an agent config.json from an agent definition.
 */
declare function generateAgentConfig(agent: AgentDefinition): string;
/**
 * Generate the file block content for a complete space structure.
 *
 * This returns a mapping of file paths to content that can be written
 * using 4-backtick file blocks.
 */
declare function generateSpaceStructure(metadata: SpaceMetadata, agents?: Record<string, AgentDefinition>): Record<string, string>;
/**
 * Generate file block statements for a space.
 *
 * Returns an array of file block strings that can be emitted
 * by the agent to create a complete space.
 */
declare function generateSpaceFileBlocks(metadata: SpaceMetadata, agents?: Record<string, AgentDefinition>): string[];
/**
 * Validate a space name (kebab-case).
 */
declare function validateSpaceName(name: string): boolean;
/**
 * Slugify a string into a valid space name.
 */
declare function slugifySpaceName(input: string): string;

/**
 * Space watcher — hot-reload spaces when files change.
 *
 * Watches space directories for changes and triggers rebuilds
 * of agent namespaces without requiring session restart.
 */
interface SpaceWatcherOptions {
    /** Root directory containing spaces. */
    spacesDir: string;
    /** Callback when a space changes. */
    onChange: (spaceName: string) => void | Promise<void>;
    /** Debounce delay in ms (default: 300). */
    debounceMs?: number;
    /** Whether to watch recursively (default: true). */
    recursive?: boolean;
}
interface SpaceWatcherHandle {
    /** Stop watching. */
    stop: () => Promise<void>;
    /** Check if currently watching. */
    isWatching: () => boolean;
}
/**
 * Watch spaces directory for changes.
 */
declare function watchSpaces(options: SpaceWatcherOptions): Promise<SpaceWatcherHandle>;
/**
 * Check if file watching is supported (not available in all environments).
 */
declare function isFileWatchingSupported(): boolean;

/**
 * Dynamic space loader — hot-reload spaces and update namespaces.
 *
 * Provides utilities to watch space directories and update Session
 * with new agent namespaces when spaces change.
 */

interface DynamicSpaceLoaderOptions {
    /** Root directory containing spaces. */
    spacesDir: string;
    /** Session to update with new namespaces. */
    session: Session;
    /** Callback for spawning agents when namespaces are called. */
    onSpawn: (config: AgentSpawnConfig) => Promise<AgentSpawnResult>;
    /** Log callback for reload events. */
    onReload?: (spaceName: string) => void;
    /** Function to rebuild agent namespaces from spaces directory. */
    rebuildNamespaces: (spacesDir: string) => Promise<{
        agentTree: Record<string, unknown>;
        knowledgeNamespace: Record<string, unknown>;
    }>;
}
interface DynamicSpaceLoaderHandle {
    /** Start watching spaces. */
    start: () => Promise<void>;
    /** Stop watching spaces. */
    stop: () => Promise<void>;
    /** Manually trigger a reload of all spaces. */
    reload: () => Promise<void>;
    /** Check if currently watching. */
    isWatching: () => boolean;
}
/**
 * Create a dynamic space loader that watches for changes and updates namespaces.
 */
declare function createDynamicSpaceLoader(options: DynamicSpaceLoaderOptions): DynamicSpaceLoaderHandle;

export { type ASTPattern, type AgentDefinition, type AgentPromiseEntry, AgentRegistry, type AgentRegistryConfig, type AgentSnapshot, type AgentSpawnConfig, type AgentSpawnResult, type AgentStatus, type AskCancellation, type AsyncCancellation, AsyncManager, type CatalogFunction, type CatalogModule, type CheckpointData, type ClassMethodInfo, type CompressOptions, type ContextBudgetSnapshot, ConversationRecorder, type ConversationState, type ConversationTurn, type CritiqueResult, type DynamicSpaceLoaderHandle, type DynamicSpaceLoaderOptions, type ErrorPayload, type FlatKnowledgeContent, type FlatKnowledgeSelector, type ForkRequest, type ForkResult, FunctionRegistry, GitClient, type GitClientOptions, type GitCommitResult, type GitStatusResult, type GlobalName, type GlobalsConfig, type Hook, type HookAction, type HookContext, type HookExecutionResult, type HookMatch, HookRegistry, KNOWLEDGE_TAG, type KnowledgeContent, type KnowledgeDecayLevel, type KnowledgeDecayTiers, type KnowledgeDomain, type KnowledgeField, type KnowledgeOption, type KnowledgeSelector, type KnowledgeTree, type LineResult, type McpServerConfig, type McpServerEntry, type PartialSessionConfig, type ReflectRequest, type ReflectResult, type RegistryOptions, type RenderSurface, Sandbox, type SandboxOptions, type SandboxResourceLimits, type SandboxResourceUsage, type ScopeDelta, type ScopeEntry, type SerializationLimits, type SerializedJSX, type SerializedTaskCompletion, type SerializedTasklistState, type SerializedTasklistsState, type SerializedValue, Session, type SessionConfig, type SessionEvent, type SessionOptions, type SessionSnapshot, type SessionStatus, type SpaceMetadata, type SpaceWatcherHandle, type SpaceWatcherOptions, type SpeculateBranch, type SpeculateBranchResult, type SpeculateResult, type StatementExecutor, type StopPayload, StreamController, type StreamControllerOptions, type StreamPauseController, type TaskCompletion, type TaskDefinition, type Tasklist, type TasklistsState, ThingAgent, type ThingEntryPointOptions, type TraceSnapshot, type TurnBoundary, type TurnEvent, VectorIndex, type VectorIndexOptions, type VectorMatch, type WebSearchResponse, type WebSearchResult, buildErrorMessage, buildHookInterruptMessage, buildInterventionMessage, buildKnowledgeTree, buildStopMessage, buildSummaryComment, buildSystemPrompt, buildTaskContinueMessage, buildTaskOrderViolationMessage, buildTasklistReminderMessage, clear, compressCodeWindow, computeScopeDelta, createBracketState, createDefaultConfig, createDynamicSpaceLoader, createGitClient, createGlobals, createLineAccumulator, createThingSession, decayErrorMessage, decayKnowledgeValue, decayStopPayload, deleteKnowledgeFile, describeType, detectGlobalCall, ensureMemoryDomain, executeHooks, executeLine, extractDeclarations, extractVariableNames, feed, feedChunk, findMatches, flush, formatCatalogForPrompt, formatKnowledgeTreeForPrompt, formatWebSearchResults, generateAgentConfig, generateAgentsBlock, generateCurrentTaskBlock, generatePackageJson, generateScopeTable, generateSpaceFileBlocks, generateSpaceStructure, generateTasksBlock, getCatalogModule, getDecayLevel, getKnowledgeDecayLevel, isBalanced, isCompleteStatement, isFileWatchingSupported, isJSXSafe, isKnowledgeContent, loadCatalog, loadKnowledgeFiles, loadMcpServers, loadMcpServersFromConfig, matchPattern, mergeCatalogs, mergeConfig, mergeKnowledgeTrees, parseFieldPath, parseStatement, quickStart, recoverArgumentNames, renderTaskLine, resetBracketState, sanitizeJSX, saveKnowledgeFile, serialize, serializeTasklistsState, slugifySpaceName, tagAsKnowledge, transpile, truncateValue, updateScopeInPrompt, validateConfig, validateFormComponents, validateSpaceName, watchSpaces, webSearch, wrapFunction };
