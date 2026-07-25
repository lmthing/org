/**
 * THING panel sidebar: brand header (with optional back button for
 * full-page mode), "new chat" action, and the conversation switcher list.
 */
import * as Prim from '../../../elements/primitives/index';
import { Button } from '../../../elements/forms/button'
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
    <Prim.Box
      width="$64"
      borderRightWidth={1}
      borderRightColor="$border"
      display="flex"
      flexDirection="column"
      flexShrink={0}
    >
      {/* Sidebar header */}
      <Prim.Box
        padding="$4"
        borderBottomWidth={1}
        borderBottomColor="$border"
        display="flex"
        alignItems="center"
        justifyContent="space-between"
      >
        <Prim.Box display="flex" alignItems="center" gap="$2">
          {fullPage && (
            <Button
              variant="ghost"
              size="sm"
              onClick={onBack}
            >
              <ArrowLeft size={16} />
            </Button>
          )}
          <Prim.Box display="flex" alignItems="center" gap="$1.5">
            <Bot size={18} />
            <Prim.Text fontWeight="$semibold" fontSize="$sm">
              <CozyThingText text="THING" />
            </Prim.Text>
          </Prim.Box>
        </Prim.Box>
        <Button variant="ghost" size="sm" onClick={onNewChat} disabled={isWorking}>
          <Plus size={14} />
        </Button>
      </Prim.Box>

      {/* Conversation list */}
      <Prim.Box flexGrow={1} flexShrink={1} flexBasis="0%" overflowY="auto" padding="$2">
        {conversations.map(conv => {
          const isCurrent = conv.id === currentConversationId
          return (
            <Prim.Pressable
              key={conv.id}
              onClick={() => onSelectConversation(conv.id)}
              display="block"
              width="100%"
              textAlign="left"
              paddingVertical="$2"
              paddingHorizontal="$3"
              borderRadius="$radius-md"
              borderWidth={0}
              backgroundColor="transparent"
              cursor="pointer"
              fontSize={13}
              fontWeight="$normal"
              overflow="hidden"
              textOverflow="ellipsis"
              whiteSpace="nowrap"
              marginBottom="$0.5"
              {...(isCurrent ? { backgroundColor: '$muted', fontWeight: '$semibold' } : {})}
            >
              {conv.title}
            </Prim.Pressable>
          )
        })}
      </Prim.Box>
    </Prim.Box>
  )
}
