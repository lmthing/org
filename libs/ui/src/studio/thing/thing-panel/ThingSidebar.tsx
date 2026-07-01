/**
 * THING panel sidebar: brand header (with optional back button for
 * full-page mode), "new chat" action, and the conversation switcher list.
 */
import { Bot, Plus, ArrowLeft } from 'lucide-react'
import { CozyThingText } from '@lmthing/ui/elements/branding/cozy-text'
import type { ThingConversation } from './types'

export interface ThingSidebarProps {
  fullPage?: boolean
  onBack: () => void
  conversations: ThingConversation[]
  currentConversationId?: string | null
  onSelectConversation: (id: string) => void
  onNewChat: () => void
  isWorking: boolean
}

export function ThingSidebar({
  fullPage,
  onBack,
  conversations,
  currentConversationId,
  onSelectConversation,
  onNewChat,
  isWorking,
}: ThingSidebarProps) {
  return (
    <div className="thing-panel__sidebar">
      {/* Sidebar header */}
      <div className="thing-panel__sidebar-header">
        <div className="thing-panel__sidebar-title">
          {fullPage && (
            <button
              className="btn btn--ghost btn--sm"
              onClick={onBack}
            >
              <ArrowLeft size={16} />
            </button>
          )}
          <div className="thing-panel__sidebar-brand">
            <Bot size={18} />
            <span className="thing-panel__sidebar-brand-name">
              <CozyThingText text="THING" />
            </span>
          </div>
        </div>
        <button className="btn btn--ghost btn--sm" onClick={onNewChat} disabled={isWorking}>
          <Plus size={14} />
        </button>
      </div>

      {/* Conversation list */}
      <div className="thing-panel__sidebar-list">
        {conversations.map(conv => {
          const isCurrent = conv.id === currentConversationId
          return (
            <button
              key={conv.id}
              onClick={() => onSelectConversation(conv.id)}
              className={`thing-panel__conv-btn ${isCurrent ? 'thing-panel__conv-btn--active' : ''}`}
            >
              {conv.title}
            </button>
          )
        })}
      </div>
    </div>
  )
}
