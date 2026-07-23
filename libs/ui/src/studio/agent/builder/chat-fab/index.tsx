/**
 * ChatFAB - Floating action button for testing agent in chat.
 * US-208 / C9: Fixed bottom-right, violet accent, icon + label.
 */
import * as Prim from '../../../../elements/primitives/index.js';
import '@lmthing/css/components/agent/builder/index.css'
import { MessageCircle } from 'lucide-react'

export interface ChatFABProps {
  onClick: () => void
}

export function ChatFAB({ onClick }: ChatFABProps) {
  return (
    <Prim.Pressable
      onClick={onClick}
      title="Chat with this agent"
      className="chat-fab"
    >
      <MessageCircle className="chat-fab__icon" />
      Chat
    </Prim.Pressable>
  )
}
