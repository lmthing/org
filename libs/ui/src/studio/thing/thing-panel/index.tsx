/**
 * ThingPanel - AI agent chat interface.
 * Adapted from the old ThingPanel to use the new FS state layer.
 * Provides a conversational interface with tool-calling for workspace operations.
 *
 * This file is the composition root: state/effects/data logic live in
 * `use-thing-session.ts` (and the hooks it composes), JSX chunks live in the
 * sibling `Thing*` components.
 */
import * as Prim from '../../../elements/primitives/index.js';
import { useNavigate } from '@tanstack/react-router'


import { useThingSession } from './use-thing-session'
import { ThingSidebar } from './ThingSidebar'
import { ThingChatHeader } from './ThingChatHeader'
import { ThingMessages } from './ThingMessages'
import { ThingComposer } from './ThingComposer'

// ── Component ──────────────────────────────────────────────────────────

export interface ThingPanelProps {
  /** When true, renders as a full page instead of panel */
  fullPage?: boolean
  onStatusChange?: (status: { isStreaming: boolean; hasError: boolean }) => void
}

export function ThingPanel({ fullPage, onStatusChange }: ThingPanelProps) {
  const navigate = useNavigate()

  const {
    input,
    setInput,
    conversations,
    currentConversation,
    setCurrentId,
    messages,
    isWorking,
    hasError,
    hasEnv,
    messagesEndRef,
    createNewChat,
    handleSubmit,
  } = useThingSession({ onStatusChange })

  return (
    <Prim.Box
      display="flex"
      backgroundColor="$background"
      height={fullPage ? '100vh' : '100%'}
    >
      <ThingSidebar
        fullPage={fullPage}
        onBack={() => navigate({ to: '/' })}
        conversations={conversations}
        currentConversationId={currentConversation?.id}
        onSelectConversation={setCurrentId}
        onNewChat={createNewChat}
        isWorking={isWorking}
      />

      {/* Main chat area */}
      <Prim.Box flexGrow={1} flexShrink={1} flexBasis="0%" display="flex" flexDirection="column" minWidth={0}>
        <ThingChatHeader
          title={currentConversation?.title || 'Chat'}
          isWorking={isWorking}
          hasError={hasError}
          hasEnv={hasEnv}
        />

        <ThingMessages
          hasEnv={hasEnv}
          messages={messages}
          isWorking={isWorking}
          messagesEndRef={messagesEndRef}
        />

        <ThingComposer
          input={input}
          setInput={setInput}
          hasEnv={hasEnv}
          isWorking={isWorking}
          onSubmit={handleSubmit}
        />
      </Prim.Box>
    </Prim.Box>
  )
}

export { ThingPanel as default }
