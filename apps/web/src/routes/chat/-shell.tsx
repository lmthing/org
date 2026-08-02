import { useCallback } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { ChatShell } from '@lmthing/ui/chat'
import '@lmthing/ui/chat/css'

/**
 * The chat surface, wired to the router.
 *
 * Three routes render this — `/chat`, `/chat/$projectId`, `/chat/$projectId/$sessionId` — because
 * those are the three states the surface has, and each one has to survive a reload, a share and a
 * back button. The shell itself knows nothing about TanStack Router (it also runs in a desktop
 * window and a React Native app, neither of which has a history stack); it takes the location as
 * props and hands navigations back here. See `libs/ui/src/chat/app/chat-nav.tsx`.
 *
 * The `-` prefix keeps this file out of the generated route tree.
 */
export function ChatRouteShell({
  projectId = null,
  sessionId = null,
}: {
  projectId?: string | null
  sessionId?: string | null
}) {
  const navigate = useNavigate()

  const onNavigate = useCallback(
    (to: { projectId: string | null; sessionId: string | null }, opts: { replace: boolean }) => {
      // `replace` comes from the shell and decides whether this lands in the back stack: the user's
      // own choices push, the app's corrections replace.
      const { replace } = opts
      if (to.projectId && to.sessionId) {
        void navigate({
          to: '/chat/$projectId/$sessionId',
          params: { projectId: to.projectId, sessionId: to.sessionId },
          replace,
        })
      } else if (to.projectId) {
        void navigate({ to: '/chat/$projectId', params: { projectId: to.projectId }, replace })
      } else {
        void navigate({ to: '/chat', replace })
      }
      // Note what is NOT carried across: `?node=&tab=&follow=`. Those name a node inside the
      // conversation being left, so a router default that preserved search would produce links
      // selecting a node that does not exist in the conversation they point at.
    },
    [navigate],
  )

  return <ChatShell projectId={projectId} sessionId={sessionId} onNavigate={onNavigate} />
}
