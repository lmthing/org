import { useState, useEffect, useRef } from 'react'
import { useReplSession } from './rpc-client'
import { ThingWebView } from '@lmthing/thing-ui/thing-web-view'

const WS_URL = (import.meta as unknown as { env: Record<string, string> }).env?.VITE_WS_URL ?? 'ws://localhost:3010'

function useConversationId(defaultId: string): string {
  const [id, setId] = useState(() => {
    const match = window.location.hash.match(/^#\/chat\/(.+)$/)
    if (match) return match[1]!
    window.location.hash = `#/chat/${defaultId}`
    return defaultId
  })

  useEffect(() => {
    const handler = () => {
      const match = window.location.hash.match(/^#\/chat\/(.+)$/)
      if (match) setId(match[1]!)
    }
    window.addEventListener('hashchange', handler)
    return () => window.removeEventListener('hashchange', handler)
  }, [])

  return id
}

export function App() {
  const [activeSessionId] = useState(() => crypto.randomUUID())
  const conversationId = useConversationId(activeSessionId)
  const session = useReplSession(WS_URL)
  const { snapshot, blocks, connected, sendMessage } = session
  const isLiveView = conversationId === activeSessionId

  // Request conversations list on connect
  useEffect(() => {
    if (connected) session.requestConversations()
  }, [connected])

  // Auto-save when execution settles
  const prevStatusRef = useRef(snapshot.status)
  useEffect(() => {
    const prev = prevStatusRef.current
    const curr = snapshot.status
    prevStatusRef.current = curr
    if (
      connected &&
      prev === 'executing' &&
      (curr === 'idle' || curr === 'waiting_for_input' || curr === 'complete')
    ) {
      session.saveConversation(activeSessionId)
    }
  }, [snapshot.status, connected, activeSessionId])

  // Load history conversation when browsing
  useEffect(() => {
    if (!isLiveView && connected) {
      session.loadConversation(conversationId)
    }
  }, [conversationId, isLiveView, connected])

  // Iframe embedding support
  useEffect(() => {
    if (window === window.top) return
    window.parent.postMessage(
      { type: 'lmthing:repl-update', connected, snapshot: { status: snapshot.status }, blocks },
      '*',
    )
  }, [connected, snapshot.status, blocks])

  useEffect(() => {
    if (window === window.top) return
    function onMessage(e: MessageEvent) {
      if ((e.data as { type?: string })?.type === 'lmthing:repl-send')
        sendMessage((e.data as { text: string }).text)
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [sendMessage])

  const handleSelectConversation = (id: string) => {
    window.location.hash = `#/chat/${id}`
  }

  const handleNewConversation = () => {
    window.location.hash = `#/chat/${activeSessionId}`
  }

  return (
    <ThingWebView
      session={session}
      conversationId={conversationId}
      liveSessionId={activeSessionId}
      onSelectConversation={handleSelectConversation}
      onNewConversation={handleNewConversation}
      historyBlocks={[]}
      isLiveView={isLiveView}
      wsUrl={WS_URL}
    />
  )
}
