import { createFileRoute } from '@tanstack/react-router'
import { ChatShell } from '@lmthing/ui/chat'
import '@lmthing/ui/chat/css'

function ChatPage() {
  return <ChatShell />
}

export const Route = createFileRoute('/chat/')({
  component: ChatPage,
})
