import { createFileRoute } from '@tanstack/react-router'
import { ChatRouteShell } from './-shell'

/** `/chat` — no project named yet. The shell resolves the default one and REPLACES this entry. */
export const Route = createFileRoute('/chat/')({
  component: () => <ChatRouteShell />,
})
