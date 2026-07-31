import * as React from 'react'
import * as Prim from '@lmthing/ui/elements/primitives'
import { AppView } from '@lmthing/ui/elements/content/app-view'
import { apiBase } from '@lmthing/ui/platform'
import { useAuth } from '@lmthing/auth'

/**
 * A PERSONAL project's app, full-window.
 *
 * Covers the panes rather than replacing one: an app is a place you go into and come back from,
 * and the chat socket behind it should not be torn down to look at one.
 *
 * The embed itself is `@lmthing/ui`'s `AppView`, whose web fork is an `<iframe>` — the one place in
 * the design system a raw host element is correct, and already justified there. This file supplies
 * only the URL and the chrome around it.
 *
 * The token rides in the query string because a subframe's document request cannot carry an
 * `Authorization` header, and the pod's `/app/*` routing needs it to pick the right pod. That is
 * the same reason `apps/web` mirrors the JWT into a cookie for these navigations.
 */
export function AppScreen({
  projectId,
  name,
  onClose,
}: {
  projectId: string
  name: string
  onClose: () => void
}) {
  const { getAccessToken } = useAuth()
  const [url, setUrl] = React.useState<string | null>(null)
  const [error, setError] = React.useState<string | null>(null)

  React.useEffect(() => {
    let cancelled = false
    void getAccessToken()
      .then((token) => {
        if (cancelled) return
        setUrl(`${apiBase()}/app/${projectId}/?access_token=${encodeURIComponent(token)}`)
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err))
      })
    return () => {
      cancelled = true
    }
  }, [projectId, getAccessToken])

  return (
    <Prim.Col flex={1} minHeight={0}>
      <Prim.Row
        flexShrink={0}
        alignItems="center"
        gap="$2"
        paddingHorizontal="$3"
        paddingVertical="$2"
        borderBottomWidth={1}
        borderColor="$border"
      >
        <Prim.Pressable
          onClick={onClose}
          minHeight="$8"
          paddingHorizontal="$3"
          display="flex"
          alignItems="center"
          justifyContent="center"
          borderRadius="$radius-md"
          aria-label="Close app"
        >
          <Prim.Text color="$primary">← Back</Prim.Text>
        </Prim.Pressable>
        <Prim.Text fontWeight="$semibold">{name}</Prim.Text>
      </Prim.Row>

      {error ? (
        <Prim.Col flex={1} alignItems="center" justifyContent="center" padding="$4">
          <Prim.Text color="$destructive" textAlign="center">
            {error}
          </Prim.Text>
        </Prim.Col>
      ) : url ? (
        <AppView url={url} title={name} />
      ) : (
        <Prim.Col flex={1} alignItems="center" justifyContent="center">
          <Prim.Text>Opening {name}…</Prim.Text>
        </Prim.Col>
      )}
    </Prim.Col>
  )
}
