/**
 * Factory functions for every WebSocket event the server can emit.
 * Mirrors the event shapes consumed by blocksReducer and applyEvent in rpc-client.ts.
 */

export type SessionStatus =
  | 'idle'
  | 'executing'
  | 'waiting_for_input'
  | 'paused'
  | 'complete'
  | 'error'

export interface SessionSnapshot {
  status: SessionStatus
  scope: Array<{ name: string; type: string; value: string }>
  asyncTasks: Array<{ id: string; label: string; status: string; elapsed: number }>
  activeFormId: string | null
  budget: {
    tokensUsed: number
    tokensRemaining: number
    costUsd: number
    forksActive: number
    forksCompleted: number
    nearingLimit: boolean
  }
  agentSlug: string
  flowSlug: string
  spaceDir: string
  cycle: number
}

export const EMPTY_SNAPSHOT: SessionSnapshot = {
  status: 'idle',
  scope: [],
  asyncTasks: [],
  activeFormId: null,
  budget: {
    tokensUsed: 0,
    tokensRemaining: 64000,
    costUsd: 0,
    forksActive: 0,
    forksCompleted: 0,
    nearingLimit: false,
  },
  agentSlug: 'test-agent',
  flowSlug: 'main',
  spaceDir: '/tmp/test-space',
  cycle: 0,
}

export interface SerializedJSX {
  component: string
  props?: Record<string, unknown>
  children?: Array<SerializedJSX | string>
}

// ── Server → Browser events ──────────────────────────────────────────────────

export const e = {
  /** Full snapshot (sent on connect and on getSnapshot) */
  snapshot: (data: Partial<SessionSnapshot> = {}): Record<string, unknown> => ({
    type: 'snapshot',
    data: { ...EMPTY_SNAPSHOT, ...data },
  }),

  /** Space metadata (agents list for @ picker) */
  spaceMetadata: (
    agents: Array<{ slug: string; title: string; requiredKnowledge: unknown[] }> = [],
  ): Record<string, unknown> => ({
    type: 'space_metadata',
    agents,
  }),

  /** Available slash commands */
  actions: (
    actions: Array<{ id: string; label: string; description: string }> = [],
  ): Record<string, unknown> => ({
    type: 'actions',
    data: actions,
  }),

  /** Conversations list */
  conversations: (
    list: Array<{ id: string; title: string; updatedAt: string; turnCount: number }> = [],
  ): Record<string, unknown> => ({
    type: 'conversations',
    data: list,
  }),

  /** Conversation loaded */
  conversationLoaded: (id: string, data: unknown): Record<string, unknown> => ({
    type: 'conversationLoaded',
    id,
    data,
  }),

  /** Conversation saved acknowledgement */
  conversationSaved: (id: string): Record<string, unknown> => ({
    type: 'conversationSaved',
    id,
  }),

  // ── Status events ────────────────────────────────────────────────────────

  status: (status: SessionStatus): Record<string, unknown> => ({ type: 'status', status }),

  // ── Block-creating events ────────────────────────────────────────────────

  /** Begin/append a code streaming block */
  code: (blockId: string, lines: string): Record<string, unknown> => ({
    type: 'code',
    blockId,
    lines,
  }),

  /** Finalize a code block (stops streaming indicator) */
  codeComplete: (blockId: string): Record<string, unknown> => ({
    type: 'code_complete',
    blockId,
  }),

  /** Read block (scope inspection) */
  read: (
    blockId: string,
    payload: Record<string, unknown> = {},
  ): Record<string, unknown> => ({
    type: 'read',
    blockId,
    payload,
  }),

  /** Error block */
  error: (
    blockId: string,
    error: { type: string; message: string; line: number; source: string } = {
      type: 'TypeError',
      message: 'Cannot read property of undefined',
      line: 5,
      source: 'const x = obj.missing',
    },
  ): Record<string, unknown> => ({
    type: 'error',
    blockId,
    error,
  }),

  /** Hook block */
  hook: (
    blockId: string,
    hookId: string,
    action: string,
    detail: string,
  ): Record<string, unknown> => ({
    type: 'hook',
    blockId,
    hookId,
    action,
    detail,
  }),

  /** Display block (JSX output from display()) */
  display: (componentId: string, jsx: SerializedJSX): Record<string, unknown> => ({
    type: 'display',
    componentId,
    jsx,
  }),

  /** Ask start — creates a form block and sets activeFormId */
  askStart: (formId: string, jsx: SerializedJSX): Record<string, unknown> => ({
    type: 'ask_start',
    formId,
    jsx,
  }),

  /** Ask end — marks form as submitted, clears activeFormId */
  askEnd: (formId: string): Record<string, unknown> => ({
    type: 'ask_end',
    formId,
  }),

  /** Budget update */
  budgetUpdate: (
    opts: {
      tokensUsed?: number
      tokensRemaining?: number
      costUsd?: number
      cycleCostUsd?: number
      forksActive?: number
      forksCompleted?: number
      nearingLimit?: boolean
    } = {},
  ): Record<string, unknown> => ({
    type: 'budget_update',
    tokensUsed: opts.tokensUsed ?? 1000,
    tokensRemaining: opts.tokensRemaining ?? 63000,
    costUsd: opts.costUsd ?? 0.00025,
    cycleCostUsd: opts.cycleCostUsd ?? 0.00012,
    forksActive: opts.forksActive ?? 0,
    forksCompleted: opts.forksCompleted ?? 0,
    nearingLimit: opts.nearingLimit ?? false,
  }),

  /** Fork spawn */
  forkSpawn: (
    forkId: string,
    instruction: string,
    tokenCap = 8000,
  ): Record<string, unknown> => ({
    type: 'fork_spawn',
    forkId,
    instruction,
    tokenCap,
  }),

  /** Fork resolve */
  forkResolve: (forkId: string, tokensUsed = 1200): Record<string, unknown> => ({
    type: 'fork_resolve',
    forkId,
    tokensUsed,
  }),

  /** Checkpoint */
  checkpoint: (label: string): Record<string, unknown> => ({
    type: 'checkpoint',
    label,
  }),

  /** Space info block */
  spaceInfo: (
    agentSlug = 'test-agent',
    flowSlug = 'main',
    spaceDir = '/tmp/test-space',
  ): Record<string, unknown> => ({
    type: 'space_info',
    agentSlug,
    flowSlug,
    spaceDir,
  }),

  /** Knowledge form */
  knowledgeForm: (
    id: string,
    agentSlug: string,
    fields: Array<{ domain: string; field: string; label: string; options: string[] }>,
  ): Record<string, unknown> => ({
    type: 'knowledge_form',
    id,
    agentSlug,
    fields,
  }),

  /** Knowledge form done (remove the form block) */
  knowledgeFormDone: (id: string): Record<string, unknown> => ({
    type: 'knowledge_form_done',
    id,
  }),

  /** Tasklist declared */
  tasklistDeclared: (
    tasklistId: string,
    plan: { description: string; tasks: Array<{ id: string; instructions: string }> },
  ): Record<string, unknown> => ({
    type: 'tasklist_declared',
    tasklistId,
    plan,
  }),

  /** Task complete */
  taskComplete: (
    tasklistId: string,
    id: string,
    output: Record<string, unknown> = {},
  ): Record<string, unknown> => ({
    type: 'task_complete',
    tasklistId,
    id,
    output,
  }),
}

// ── Prebuilt JSX descriptors for form/display tests ──────────────────────────

export const jsx = {
  simpleText: (text: string): SerializedJSX => ({
    component: 'div',
    props: {},
    children: [text],
  }),

  form: (fields: Array<{ name: string; label: string; placeholder?: string }>): SerializedJSX => ({
    component: 'div',
    props: {},
    children: fields.map((f) => ({
      component: 'div',
      props: { style: { marginBottom: '12px' } },
      children: [
        { component: 'label', props: {}, children: [f.label] },
        {
          component: 'input',
          props: {
            type: 'text',
            name: f.name,
            placeholder: f.placeholder ?? f.label,
          },
          children: [],
        },
      ],
    })),
  }),

  heading: (text: string): SerializedJSX => ({
    component: 'h2',
    props: {},
    children: [text],
  }),

  paragraph: (text: string): SerializedJSX => ({
    component: 'p',
    props: {},
    children: [text],
  }),
}
