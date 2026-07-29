/**
 * `chat` — the assistant dock. Replaces the catalogue's four hand-built
 * `ConciergeDock`/`CopilotDock`/`AssistantDock` components.
 *
 * ## Why this is not `@app/runtime`'s `<Chat>`
 *
 * That widget is web-only in a way that cannot be papered over: it reads
 * `window.matchMedia` to decide between a sheet and a floating card, and it lives in
 * `@lmthing/cli`, which depends on `@lmthing/ui` — importing it here would be a package
 * cycle. What both share, and what is actually load-bearing, is `ReplChatView` from
 * `@lmthing/ui/chat`: the connected-session transcript, the descriptor renderer, the
 * ask/answer round-trip and the message input. That component is already on the native
 * graph (`metro/entries/surface.ts` imports `src/chat`), so the section is the same
 * surface on both targets.
 *
 * Session creation is the only other half, and it is three lines of the standard pod
 * protocol (`POST /api/sessions`), taken through this renderer's own client so the pod URL
 * and the token come from the same configuration every other request uses — no
 * same-origin assumption anywhere.
 */

import * as React from 'react'
import * as Prim from '../../elements/primitives/index'
import { ReplChatView } from '../../chat'
import type { ChatSection } from '../types'
import { resolveOptional, type Scope } from '../bind'
import { stringify } from '../format'
import { useViewRuntime } from '../runtime'
import { ErrorState, LoadingState } from '../states'

const HEIGHTS = { sm: 240, md: 360, lg: 520, full: 720 } as const

/**
 * The `spaceRef`/`agentSlug` split the sessions route takes.
 *
 * A bare slug is the project's own top-level agent — the SAME THING the `/chat` surface
 * talks to, scoped to this project, with its full authoring capability. That is what makes
 * an app a living surface rather than a read-only one, and it is why the section's `agent`
 * is not always qualified.
 */
export function sessionBody(agent: string, space: string | undefined, projectId: string): Record<string, string> {
  const ref = space ? `${space}/${agent}` : agent
  return ref.includes('/') ? { spaceRef: ref, projectId } : { agentSlug: ref, projectId }
}

export function ChatSectionView({ section, scope }: { section: ChatSection; scope: Scope }): React.ReactElement {
  const { client } = useViewRuntime()
  const [sessionId, setSessionId] = React.useState<string | null>(null)
  const [error, setError] = React.useState<string | null>(null)
  const [token, setToken] = React.useState<string>('')
  const started = React.useRef(false)

  React.useEffect(() => {
    if (started.current) return
    started.current = true
    void (async () => {
      try {
        const bearer = (await client.getToken?.()) ?? ''
        setToken(bearer)
        const res = await fetch(`${client.baseUrl}/api/sessions`, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            ...(bearer ? { authorization: `Bearer ${bearer}` } : {}),
          },
          body: JSON.stringify(sessionBody(section.agent, section.space, client.projectId ?? '')),
        })
        if (!res.ok) throw new Error(`session create failed (${res.status})`)
        const body = (await res.json()) as { sessionId: string }
        setSessionId(body.sessionId)
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err))
      }
    })()
  }, [client, section.agent, section.space])

  const height = HEIGHTS[section.height ?? 'md']
  const greeting = stringify(resolveOptional(section.greeting, scope) ?? '')

  return (
    <Prim.Col gap="$2" width="100%">
      {greeting ? (
        <Prim.Text fontSize="$sm" color="$muted-foreground">
          {greeting}
        </Prim.Text>
      ) : null}
      <Prim.Box
        height={height}
        borderWidth={1}
        borderColor="$border"
        borderRadius="$radius-lg"
        backgroundColor="$card"
        overflow="hidden"
      >
        {error ? (
          <ErrorState title="The assistant is unavailable" message={error} />
        ) : sessionId ? (
          <ReplChatView baseUrl={client.baseUrl} sessionId={sessionId} accessToken={token} />
        ) : (
          <Prim.Box padding="$4">
            <LoadingState shape="block" />
          </Prim.Box>
        )}
      </Prim.Box>
    </Prim.Col>
  )
}
