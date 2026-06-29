import { createFileRoute } from '@tanstack/react-router'
import { ChatShell } from '@lmthing/agent-ui/app/ChatShell'
import '@lmthing/agent-ui/app/styles.css'

/**
 * `/chat` — the full agent-ui shell (sidebar + transcript + DevPanel), the same
 * experience lmthing.chat served standalone. ChatShell encapsulates the project
 * preload + URL↔state sync that main.tsx boot() did for shell mode.
 */
function ChatPage() {
  return <ChatShell />
}

export const Route = createFileRoute('/chat')({
  component: ChatPage,
})
