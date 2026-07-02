import { createFileRoute } from '@tanstack/react-router'
import { ChatShell } from '@lmthing/ui/chat'
import '@lmthing/ui/chat/css'
import { BudgetWindows } from './budget-windows'

function ChatPage() {
  return <ChatShell composerFooter={<BudgetWindows />} />
}

export const Route = createFileRoute('/chat/')({
  component: ChatPage,
})
