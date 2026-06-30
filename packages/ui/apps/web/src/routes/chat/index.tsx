import { createFileRoute } from '@tanstack/react-router'
import { ChatShell } from '@lmthing/agent-ui/app/ChatShell'
import '@lmthing/agent-ui/app/styles.css'

function ChatPage() {
  return <ChatShell />
}

export const Route = createFileRoute('/chat/')({
  component: ChatPage,
})
