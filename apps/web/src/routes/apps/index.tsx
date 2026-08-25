import * as Prim from '@lmthing/ui/elements/primitives';
import { createFileRoute } from '@tanstack/react-router'
import { useProjects } from '@lmthing/state'
import { useAuth } from '@lmthing/auth'
import { crossAppOrigin } from '@lmthing/ui/lib/app-urls'
import { setPodSessionCookie } from '@/lib/pod-session'

/**
 * lmthing.app landing — the user's **app launcher**. Lists the projects in their pod and, on
 * selection, LOADS THE APP INSIDE THE CHAT SURFACE (`/chat/<project>`) rather than opening the
 * pod-served bundle in a separate tab. Every project is a served app from birth (a chat page that
 * grows), and the chat surface renders it inline with THING embedded — so there is no longer a
 * separate app surface to leave for. A project-app is single-user and has no auth of its own;
 * selecting one ensures the platform-session cookie is set (so its pages/assets/api route to this
 * user's pod — see {@link setPodSessionCookie}). In local dev there is no gateway and none of this.
 */
function AppLauncher() {
  const { projects, isLoading } = useProjects()
  const { getAccessTokenSync } = useAuth()

  function openApp(id: string) {
    setPodSessionCookie(getAccessTokenSync?.())
    // Load the app inside the chat surface; same origin locally, the chat host in production.
    window.location.assign(`${crossAppOrigin('chat')}/chat/${encodeURIComponent(id)}`)
  }

  return (
    <Prim.Box marginHorizontal="auto" display="flex" height="100%" width="100%" maxWidth={896} flexDirection="column" gap="$6" padding="$8">
      <Prim.Box as="header" display="flex" flexDirection="column" gap="$1">
        <Prim.Text as="h1" fontSize="$2xl" fontWeight="$semibold" color="$foreground">Your apps</Prim.Text>
        <Prim.Text as="p" fontSize="$sm" color="$muted-foreground">
          Open an app installed in your workspace, or browse the{' '}
          <Prim.Link href="https://lmthing.store/projects" color="$primary" textDecorationLine="underline">
            app store
          </Prim.Link>{' '}
          to install more.
        </Prim.Text>
      </Prim.Box>

      {isLoading ? (
        <Prim.Box fontSize="$sm" color="$muted-foreground">Loading your apps…</Prim.Box>
      ) : projects.length === 0 ? (
        <Prim.Box borderRadius="$radius-lg" borderWidth={1} borderColor="$border" backgroundColor="$card" padding="$8" textAlign="center" fontSize="$sm" color="$muted-foreground">
          No apps yet. Install one from the{' '}
          <Prim.Link href="https://lmthing.store/projects" color="$primary" textDecorationLine="underline">
            app store
          </Prim.Link>
          .
        </Prim.Box>
      ) : (
        <Prim.List display="grid" gridTemplateColumns="repeat(1, minmax(0, 1fr))" gap="$3" $sm={{ gridTemplateColumns: "repeat(2, minmax(0, 1fr))" }}>
          {projects.map((p) => (
            <Prim.ListItem key={p.id}>
              <Prim.Pressable
                type="button"
                onClick={() => openApp(p.id)}
                transition="quick" animateOnly={["color", "background-color", "border-color"]} display="flex" width="100%" flexDirection="column" gap="$1" borderRadius="$radius-lg" borderWidth={1} borderColor="$border" backgroundColor="$card" padding="$4" textAlign="left" hoverStyle={{ backgroundColor: "$muted" }}
              >
                <Prim.Text fontWeight="$medium" color="$foreground">{p.name ?? p.id}</Prim.Text>
                <Prim.Text fontFamily="$mono" fontSize="$xs" color="$muted-foreground">Open in chat</Prim.Text>
              </Prim.Pressable>
            </Prim.ListItem>
          ))}
        </Prim.List>
      )}
    </Prim.Box>
  )
}

export const Route = createFileRoute('/apps/')({
  component: AppLauncher,
})
