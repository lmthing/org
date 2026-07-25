import * as Prim from '@lmthing/ui/elements/primitives';
import { createFileRoute } from '@tanstack/react-router'
import { useProjects } from '@lmthing/state'
import { useAuth } from '@lmthing/auth'
import { COMPUTER_BASE_URL, APP_PATH_PREFIX } from '@/lib/config'
import { setPodSessionCookie } from '@/lib/pod-session'

/**
 * lmthing.app landing — the user's **app launcher**. Lists the projects installed in
 * their pod and opens the pod-served app at `<APP_PATH_PREFIX>/<project>/` (clean
 * `/<project>/` in production, `/app/<project>/` on localhost). A project-app is single-user
 * and has no auth of its own; opening one just ensures the platform-session cookie is set
 * (so the app's pages + assets route to this user's pod — see {@link setPodSessionCookie}).
 * In local dev there is no gateway and the pod is reached directly with no auth at all.
 */
function AppLauncher() {
  const { projects, isLoading } = useProjects()
  const { getAccessTokenSync } = useAuth()

  function openApp(id: string) {
    setPodSessionCookie(getAccessTokenSync?.())
    window.open(`${COMPUTER_BASE_URL}${APP_PATH_PREFIX}/${encodeURIComponent(id)}/`, '_blank', 'noopener')
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
                className="transition-colors" display="flex" width="100%" flexDirection="column" gap="$1" borderRadius="$radius-lg" borderWidth={1} borderColor="$border" backgroundColor="$card" padding="$4" textAlign="left" hoverStyle={{ backgroundColor: "$muted" }}
              >
                <Prim.Text fontWeight="$medium" color="$foreground">{p.name ?? p.id}</Prim.Text>
                <Prim.Text fontFamily="$mono" fontSize="$xs" color="$muted-foreground">{APP_PATH_PREFIX}/{p.id}/</Prim.Text>
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
