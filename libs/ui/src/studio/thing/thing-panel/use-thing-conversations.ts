/**
 * Owns the conversation list: persistence to localStorage, the
 * current/selected conversation, and mutation helpers (append messages,
 * start a new chat). Does not know anything about talking to an LLM.
 */
import { useCallback, useEffect, useMemo } from 'react'
import { useUIState } from '@lmthing/state'
import { CONVERSATIONS_KEY } from './constants'
import { createConversation, createWelcomeMessage, loadConversations } from './utils'
import type { ThingConversation, ThingMessage } from './types'

export function useThingConversations() {
  const [conversations, setConversations] = useUIState<ThingConversation[]>('thing-panel.conversations', loadConversations())
  const [currentId, setCurrentId] = useUIState<string | null>('thing-panel.currentId', null)

  const currentConversation = useMemo(() => {
    if (conversations.length === 0) return null
    if (!currentId) return conversations[0]
    return conversations.find(c => c.id === currentId) || conversations[0]
  }, [conversations, currentId])

  const messages = useMemo(
    () => currentConversation?.messages || [createWelcomeMessage()],
    [currentConversation],
  )

  // Persist conversations
  useEffect(() => {
    if (typeof window === 'undefined') return
    window.localStorage.setItem(CONVERSATIONS_KEY, JSON.stringify(conversations))
  }, [conversations])

  // Ensure current conversation exists
  useEffect(() => {
    if (conversations.length === 0) {
      const fallback = createConversation()
      setConversations([fallback])
      setCurrentId(fallback.id)
      return
    }
    if (!currentId || !conversations.some(c => c.id === currentId)) {
      setCurrentId(conversations[0].id)
    }
  }, [conversations, currentId])

  const updateMessages = useCallback((conversationId: string, msgs: ThingMessage[]) => {
    setConversations(prev => prev.map(c =>
      c.id === conversationId ? { ...c, messages: msgs, updatedAt: new Date().toISOString() } : c
    ))
  }, [])

  const createNewChat = useCallback(() => {
    const next = createConversation(`Chat ${conversations.length + 1}`)
    setConversations(prev => [next, ...prev])
    setCurrentId(next.id)
  }, [conversations.length])

  return {
    conversations,
    setConversations,
    currentId,
    setCurrentId,
    currentConversation,
    messages,
    updateMessages,
    createNewChat,
  }
}
