import { useState, useEffect, useCallback, useRef, useReducer } from 'react'

export type { UIBlock, BlockAction, ConversationSummary, AgentAction } from '@lmthing/thing-ui/thing-web-view/types'
export { blocksReducer } from '@lmthing/thing-ui/thing-web-view/blocks'

import type { UIBlock, AgentAction, ConversationSummary } from '@lmthing/thing-ui/thing-web-view/types'
import { blocksReducer } from '@lmthing/thing-ui/thing-web-view/blocks'

// ── Snapshot ──────────────────────────────────────────────────────────────────

export interface SessionBudget {
  tokensUsed: number
  tokensRemaining: number
  costUsd: number
  forksActive: number
  forksCompleted: number
  nearingLimit: boolean
}

export interface SessionSnapshot {
  status: 'idle' | 'executing' | 'waiting_for_input' | 'paused' | 'complete' | 'error'
  scope: Array<{ name: string; type: string; value: string }>
  asyncTasks: Array<{ id: string; label: string; status: string; elapsed: number }>
  activeFormId: string | null
  budget: SessionBudget
  agentSlug: string
  flowSlug: string
  spaceDir: string
  cycle: number
}

type AnyEvent = Record<string, unknown>

function applyEvent(prev: SessionSnapshot, event: AnyEvent): SessionSnapshot {
  switch (event['type']) {
    case 'status':
      return { ...prev, status: event['status'] as SessionSnapshot['status'] }
    case 'ask_start':
      return { ...prev, activeFormId: event['formId'] as string }
    case 'ask_end':
      return { ...prev, activeFormId: null }
    case 'budget_update':
      return {
        ...prev,
        budget: {
          tokensUsed: (event['tokensUsed'] as number) ?? prev.budget.tokensUsed,
          tokensRemaining: (event['tokensRemaining'] as number) ?? prev.budget.tokensRemaining,
          costUsd: (event['costUsd'] as number) ?? prev.budget.costUsd,
          forksActive: (event['forksActive'] as number) ?? prev.budget.forksActive,
          forksCompleted: (event['forksCompleted'] as number) ?? prev.budget.forksCompleted,
          nearingLimit: (event['nearingLimit'] as boolean) ?? prev.budget.nearingLimit,
        },
      }
    case 'space_info':
      return {
        ...prev,
        agentSlug: (event['agentSlug'] as string) ?? prev.agentSlug,
        flowSlug: (event['flowSlug'] as string) ?? prev.flowSlug,
        spaceDir: (event['spaceDir'] as string) ?? prev.spaceDir,
      }
    default:
      return prev
  }
}

const EMPTY_SNAPSHOT: SessionSnapshot = {
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
  agentSlug: '',
  flowSlug: '',
  spaceDir: '',
  cycle: 0,
}

// ── Hook ──────────────────────────────────────────────────────────────────────

export interface UseReplSessionResult {
  snapshot: SessionSnapshot
  blocks: UIBlock[]
  connected: boolean
  actions: AgentAction[]
  conversations: ConversationSummary[]
  loadedConversation: { id: string; state: unknown } | null
  sendMessage: (text: string) => void
  submitForm: (formId: string, data: Record<string, unknown>) => void
  cancelAsk: (formId: string) => void
  cancelTask: (taskId: string, message?: string) => void
  pause: () => void
  resume: () => void
  intervene: (text: string) => void
  saveConversation: (id: string) => void
  requestConversations: () => void
  loadConversation: (id: string) => void
}

export function useReplSession(url = 'ws://localhost:3010'): UseReplSessionResult {
  const [snapshot, setSnapshot] = useState<SessionSnapshot>(EMPTY_SNAPSHOT)
  const [connected, setConnected] = useState(false)
  const [actions, setActions] = useState<AgentAction[]>([])
  const [conversations, setConversations] = useState<ConversationSummary[]>([])
  const [loadedConversation, setLoadedConversation] = useState<{
    id: string
    state: unknown
  } | null>(null)
  const [blocks, dispatchBlock] = useReducer(blocksReducer, [])
  const wsRef = useRef<WebSocket | null>(null)
  const msgCounterRef = useRef(0)

  useEffect(() => {
    const ws = new WebSocket(url)
    wsRef.current = ws

    ws.onopen = () => {
      setConnected(true)
      ws.send(JSON.stringify({ type: 'getSnapshot' }))
    }

    ws.onmessage = (event) => {
      const data = JSON.parse(event.data as string) as AnyEvent
      if (data['type'] === 'snapshot') {
        setSnapshot(data['data'] as SessionSnapshot)
      } else if (data['type'] === 'actions') {
        setActions(data['data'] as AgentAction[])
      } else if (data['type'] === 'conversations') {
        setConversations(data['data'] as ConversationSummary[])
      } else if (data['type'] === 'conversationLoaded') {
        setLoadedConversation({ id: data['id'] as string, state: data['data'] })
      } else if (data['type'] === 'conversationSaved') {
        ws.send(JSON.stringify({ type: 'listConversations' }))
      } else {
        setSnapshot((prev) => applyEvent(prev, data))
        dispatchBlock({ type: 'event', event: data as never })
      }
    }

    ws.onclose = () => setConnected(false)
    ws.onerror = () => setConnected(false)

    return () => ws.close()
  }, [url])

  const send = useCallback((msg: Record<string, unknown>) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(msg))
    }
  }, [])

  const sendMessage = useCallback(
    (text: string) => {
      const id = `user_${++msgCounterRef.current}`
      dispatchBlock({ type: 'add_user_message', id, text })
      send({ type: 'sendMessage', text })
    },
    [send],
  )

  const intervene = useCallback(
    (text: string) => {
      const id = `user_${++msgCounterRef.current}`
      dispatchBlock({ type: 'add_user_message', id, text })
      send({ type: 'intervene', text })
    },
    [send],
  )

  return {
    snapshot,
    blocks,
    connected,
    actions,
    conversations,
    loadedConversation,
    sendMessage,
    submitForm: (formId, data) => send({ type: 'submitForm', formId, data }),
    cancelAsk: (formId) => send({ type: 'cancelAsk', formId }),
    cancelTask: (taskId, message) => send({ type: 'cancelTask', taskId, message }),
    pause: () => send({ type: 'pause' }),
    resume: () => send({ type: 'resume' }),
    intervene,
    saveConversation: (id: string) => send({ type: 'saveConversation', id }),
    requestConversations: () => send({ type: 'listConversations' }),
    loadConversation: (id: string) => {
      setLoadedConversation(null)
      send({ type: 'loadConversation', id })
    },
  }
}
