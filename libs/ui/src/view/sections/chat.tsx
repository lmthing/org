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
import { podOrigin } from '../client'
import * as Prim from '../../elements/primitives/index'
import { ReplChatView } from '../../chat'
import type { ChatSection } from '../types'
import { resolveOptional, type Scope } from '../bind'
import { stringify } from '../format'
import { useViewRuntime } from '../runtime'
import { ErrorState, LoadingState } from '../states'
import { getWindowSize, subscribeWindowSize } from '../../platform/dimensions'

const HEIGHTS = { sm: 240, md: 360, lg: 520, full: 720 } as const

// A preset is an UPPER bound, not a fixed size: on a short viewport (a phone, or a laptop
// window well under 900px tall) a literal `HEIGHTS.full` (720) pushes the composer and
// suggestion chips below the fold — the reader can never reach them without knowing to
// scroll the whole page. `CHROME_ALLOWANCE` is a rough budget for whatever sits above/below
// the dock (nav bar, page title, greeting, margins); it does not need to be exact — it only
// needs to guarantee the box never exceeds the space actually available. Measured via the
// `platform/dimensions` seam (not a CSS media query / `vh` unit) so the SAME clamp applies
// on the native target, which has no CSS viewport units at all.
//
// This is the FALLBACK path — used for `sm`/`md`/`lg` (a small widget dropped mid-page,
// which should stay compact, only ever shrinking to avoid overflow) and for `full` wherever
// there is no DOM to measure (native). On the web, `full` gets an EXACT fit instead (below):
// a rough allowance still leaves either a sliver of page scroll or dead space beneath the
// dock, and "a fresh project's chat should not have to scroll" needs the real number, not a
// budget guess.
const CHROME_ALLOWANCE = 320
const MIN_DOCK_HEIGHT = 240
// Breathing room below the dock when its height is measured exactly (web `full` only).
const BOTTOM_GUTTER = 16

/** `preset` clamped to fit `viewportHeight`, leaving `CHROME_ALLOWANCE` for surrounding chrome. */
export function clampDockHeight(preset: number, viewportHeight: number): number {
  if (viewportHeight <= 0) return preset
  return Math.max(MIN_DOCK_HEIGHT, Math.min(preset, viewportHeight - CHROME_ALLOWANCE))
}

/** Height that puts the dock's bottom edge exactly at `bottomEdge` (the bottom of whatever
 *  region actually bounds it — see {@link findScrollBoundBottom}), given where its top landed
 *  (`topOffset`, from a DOM measurement) — so the page never has to scroll to reach the
 *  composer, and there is no dead space below it either. */
export function exactDockHeight(bottomEdge: number, topOffset: number): number {
  return Math.max(MIN_DOCK_HEIGHT, bottomEdge - topOffset - BOTTOM_GUTTER)
}

/**
 * The bottom edge of the nearest scrollable ancestor (`overflow-y: auto|scroll`) — the
 * `ViewShell`'s own `<Prim.Scroll flexGrow={1} minHeight={0}>` around every page's content,
 * sized by flexbox against WHATEVER ELSE shares that flex column (a top bar, a bottom tab bar
 * on a phone, an "Assistant" strip — none of which this section can enumerate). That makes it
 * the right answer to "how much vertical room do I actually have", not `window.innerHeight`:
 * the raw window height ignores a bottom tab bar entirely (it sits in NORMAL flow, past the
 * scroll region, not as a `position: fixed` overlay), so subtracting only a small fixed gutter
 * from it let the dock's own computed height run past the scroll region's real bottom and the
 * composer land UNDER the tab bar — present, in the accessibility tree, un-clickable, and
 * invisible, exactly the kind of failure `shell-height.test.tsx` documents for a collapsed
 * shell. Falls back to `null` (→ `window.innerHeight` at the call site) if no such ancestor is
 * found, so an unusual embedding still gets a reasonable clamp rather than throwing.
 */
export function findScrollBoundBottom(el: HTMLElement | null): number | null {
  let cur = el?.parentElement ?? null
  while (cur) {
    const overflowY = window.getComputedStyle(cur).overflowY
    if (overflowY === 'auto' || overflowY === 'scroll') return cur.getBoundingClientRect().bottom
    cur = cur.parentElement
  }
  return null
}

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
  const [viewportHeight, setViewportHeight] = React.useState(() => getWindowSize().height)
  const boxRef = React.useRef<HTMLElement | null>(null)
  const [topOffset, setTopOffset] = React.useState<number | null>(null)
  const [scrollBoundBottom, setScrollBoundBottom] = React.useState<number | null>(null)
  const greeting = stringify(resolveOptional(section.greeting, scope) ?? '')

  React.useEffect(() => subscribeWindowSize(({ height: h }) => setViewportHeight(h)), [])

  // Web-only exact fit for the `full` preset: measure where the dock's top actually landed
  // (whatever the page puts above it — nav bar, title, greeting — reflows independently of a
  // window resize, e.g. a longer greeting wrapping to more lines) and where the bottom of its
  // enclosing scroll region actually is (`findScrollBoundBottom` — NOT `window.innerHeight`,
  // which knows nothing about a bottom tab bar sharing the shell's flex column), then set the
  // dock's height so its bottom lands exactly there — no page scroll, no dead space below it,
  // and the composer never lands underneath a tab bar. `document` is undefined on the native
  // target, which has no such DOM to measure — it keeps using the `CHROME_ALLOWANCE` estimate
  // in `clampDockHeight` below.
  React.useLayoutEffect(() => {
    if (typeof document === 'undefined' || (section.height ?? 'md') !== 'full') return
    const measure = () => {
      const el = boxRef.current
      const top = el?.getBoundingClientRect().top
      if (typeof top !== 'number') return
      setTopOffset(top)
      setScrollBoundBottom(findScrollBoundBottom(el))
    }
    // Synchronous, pre-paint — the greeting's actual wrapped line count (and therefore the
    // dock's top) is already settled by the time this runs, so the FIRST paint gets the real
    // height with no flash of a wrong size.
    measure()
    window.addEventListener('resize', measure)
    return () => window.removeEventListener('resize', measure)
  }, [section.height, greeting])

  React.useEffect(() => {
    if (started.current) return
    started.current = true
    void (async () => {
      try {
        const bearer = (await client.getToken?.()) ?? ''
        setToken(bearer)
        // A POD route, not an app route — see podOrigin. `client.baseUrl` is the APP base on web.
        const res = await fetch(`${podOrigin(client.baseUrl)}/api/sessions`, {
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

  const height = topOffset !== null
    ? exactDockHeight(scrollBoundBottom ?? viewportHeight, topOffset)
    : clampDockHeight(HEIGHTS[section.height ?? 'md'], viewportHeight)

  return (
    <Prim.Col gap="$2" width="100%">
      {greeting ? (
        <Prim.Text fontSize="$sm" color="$muted-foreground">
          {greeting}
        </Prim.Text>
      ) : null}
      <Prim.Box
        ref={boxRef}
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
          <ReplChatView baseUrl={podOrigin(client.baseUrl)} sessionId={sessionId} accessToken={token} suggestions={section.suggestions} />
        ) : (
          <Prim.Box padding="$4">
            <LoadingState shape="block" />
          </Prim.Box>
        )}
      </Prim.Box>
    </Prim.Col>
  )
}
