import * as React from 'react'
import * as Prim from '@lmthing/ui/elements/primitives'
import { browserSession, type BrowserState } from './browser-session'
import type { Frame } from './cdp'
import { addressBarUrl, cdpKeyEvent, modifiersOf, paneToPage, wheelDeltas } from './browser-input'

/**
 * The live browser, inside the app.
 *
 * ## What this actually is
 *
 * A real Chromium is running with no window of its own, streaming JPEG frames over CDP
 * (`Page.startScreencast`). This pane draws those frames and sends the person's mouse and keyboard
 * back the other way as `Input.dispatchMouseEvent` / `dispatchKeyEvent`. It is not an embedded
 * webview and not an iframe: it is a picture of a browser you can reach into.
 *
 * That sounds like a compromise, and in one way it is — JPEG frames are not native-feeling
 * scrolling, and an OS file picker cannot appear inside a picture, which is what the "Open in a
 * window" button is for. But it is the only design that satisfies the actual requirement, because
 * it keeps **one browser, one DOM, one cookie jar** between the person and the agent. A split
 * design — a webview for the person, a headless browser for the agent — has two of each, and no
 * amount of shared cookies makes "click the button I am looking at" mean the same thing to both.
 *
 * The webview itself could not have done this job in any case: WKWebView and WebKitGTK do not
 * speak CDP at all, so on macOS and Linux there would be no protocol to drive.
 *
 * ## Why the frame is a plain `<img>`
 *
 * Each frame is already a complete JPEG. Decoding it into a canvas would mean doing by hand what
 * the browser's image pipeline does natively, on every frame, to arrive at the same pixels.
 */

/** Repainting a hidden pane costs the same as repainting a visible one, so it is stopped instead. */
export function BrowserPane({
  visible,
  agentReach,
  onConnect,
}: {
  visible: boolean
  /** Whether an agent in this workspace can reach this browser — i.e. the host bridge is attached. */
  agentReach: 'connected' | 'connecting' | 'off'
  onConnect: () => void
}) {
  const [state, setState] = React.useState<BrowserState>(browserSession.current())
  const [frame, setFrame] = React.useState<Frame | null>(null)
  const [address, setAddress] = React.useState('')
  const [editing, setEditing] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const viewportRef = React.useRef<HTMLDivElement | null>(null)
  const frameRef = React.useRef<Frame | null>(null)
  frameRef.current = frame

  React.useEffect(() => browserSession.subscribe(setState), [])
  React.useEffect(() => browserSession.onFrame(setFrame), [])

  // The address bar follows the page EXCEPT while it is being typed into — otherwise a background
  // navigation (or the agent) overwrites what the person is halfway through typing.
  React.useEffect(() => {
    if (!editing) setAddress(state.url)
  }, [state.url, editing])

  /**
   * Start the browser when the person opens this pane, and stream only while they are looking.
   *
   * Opening the pane IS the explicit act that starts a browser — the same standard the bridge
   * holds itself to. Nothing launches at app start.
   */
  React.useEffect(() => {
    if (!visible) {
      void browserSession.stopScreencast().catch(() => {})
      return
    }
    let cancelled = false
    void browserSession
      .ensure()
      .then(async () => {
        if (cancelled) return
        const el = viewportRef.current
        if (el) await browserSession.setViewport(Math.round(el.clientWidth), Math.round(el.clientHeight))
        await browserSession.startScreencast()
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)))
    return () => {
      cancelled = true
    }
  }, [visible])

  /**
   * Keep the page's idea of its size equal to the pane's.
   *
   * Without this the page lays out for whatever window Chromium created and the pane shows a
   * scaled picture of a differently-shaped document — every click then lands somewhere other than
   * where the person pointed, and no error is raised anywhere.
   */
  React.useEffect(() => {
    const el = viewportRef.current
    if (!el || !visible) return
    const ro = new ResizeObserver(() => {
      const w = Math.round(el.clientWidth)
      const h = Math.round(el.clientHeight)
      if (w > 0 && h > 0) void browserSession.setViewport(w, h).catch(() => {})
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [visible, state.status])

  const pointAt = React.useCallback((e: React.MouseEvent): { x: number; y: number } | null => {
    const el = viewportRef.current
    const f = frameRef.current
    if (!el || !f) return null
    const r = el.getBoundingClientRect()
    return paneToPage(e.clientX, e.clientY, r, { width: f.deviceWidth, height: f.deviceHeight })
  }, [])

  const mouse = React.useCallback(
    (type: 'mouseMoved' | 'mousePressed' | 'mouseReleased') => (e: React.MouseEvent) => {
      const at = pointAt(e)
      if (!at) return
      void browserSession
        .send('Input.dispatchMouseEvent', {
          type,
          x: at.x,
          y: at.y,
          button: type === 'mouseMoved' ? 'none' : 'left',
          buttons: type === 'mousePressed' ? 1 : 0,
          clickCount: type === 'mouseMoved' ? 0 : e.detail || 1,
          modifiers: modifiersOf(e),
        })
        .catch(() => {})
    },
    [pointAt],
  )

  const onWheel = React.useCallback(
    (e: React.WheelEvent) => {
      const at = pointAt(e)
      if (!at) return
      const d = wheelDeltas(e)
      void browserSession
        .send('Input.dispatchMouseEvent', {
          type: 'mouseWheel',
          x: at.x,
          y: at.y,
          deltaX: d.deltaX,
          deltaY: d.deltaY,
          modifiers: modifiersOf(e),
        })
        .catch(() => {})
    },
    [pointAt],
  )

  const key = React.useCallback(
    (type: 'keyDown' | 'keyUp') => (e: React.KeyboardEvent) => {
      // Tab and the arrows would otherwise move focus around the APP while the person believes
      // they are typing into the page.
      if (e.key === 'Tab' || e.key.startsWith('Arrow') || e.key === ' ') e.preventDefault()
      void browserSession.send('Input.dispatchKeyEvent', cdpKeyEvent(e, type)).catch(() => {})
    },
    [],
  )

  const go = React.useCallback(() => {
    setEditing(false)
    setError(null)
    void browserSession.navigate(addressBarUrl(address)).catch((e: unknown) => {
      setError(e instanceof Error ? e.message : String(e))
    })
  }, [address])

  const agentDriving = state.agentActivity !== null

  return (
    <Prim.Col flex={1} minHeight={0}>
      <TabStrip state={state} />

      <Prim.Row
        flexShrink={0}
        alignItems="center"
        gap="$2"
        paddingHorizontal="$3"
        paddingVertical="$2"
        borderBottomWidth={1}
        borderColor="$border"
      >
        <NavButton label="Back" glyph="←" onPress={() => void browserSession.goBack()} />
        <NavButton label="Forward" glyph="→" onPress={() => void browserSession.goForward()} />
        <NavButton
          label={state.loading ? 'Stop' : 'Reload'}
          glyph={state.loading ? '×' : '⟳'}
          onPress={() => void browserSession.reload()}
        />
        <Prim.TextField
          flex={1}
          value={address}
          placeholder="Search, or enter an address"
          onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
            setEditing(true)
            setAddress(e.target.value)
          }}
          onKeyDown={(e: React.KeyboardEvent) => {
            if (e.key === 'Enter') go()
            if (e.key === 'Escape') {
              setEditing(false)
              setAddress(state.url)
            }
          }}
          onBlur={() => setEditing(false)}
          minHeight="$8"
          paddingHorizontal="$3"
          borderWidth={1}
          borderColor="$border"
          borderRadius="$radius-md"
          backgroundColor="$background"
          color="$foreground"
          aria-label="Address"
        />
        {agentDriving && (
          <Prim.Row
            alignItems="center"
            gap="$1"
            paddingHorizontal="$2"
            paddingVertical="$1"
            borderRadius="$radius-md"
            backgroundColor="$accent"
          >
            {/* The point of this indicator is that a person watching can tell whether the page
                changed because THEY did something or because the agent did. Naming the operation
                is what makes it an answer rather than a light. */}
            <Prim.Text fontSize="$xs" color="$accent-foreground">
              agent: {state.agentActivity?.op}
            </Prim.Text>
          </Prim.Row>
        )}
        <NavButton
          label={state.headless ? 'Open in a window' : 'Bring back into the app'}
          glyph={state.headless ? '⧉' : '⧈'}
          onPress={() => {
            void browserSession.setPoppedOut(state.headless).catch((e: unknown) => {
              setError(e instanceof Error ? e.message : String(e))
            })
          }}
        />
      </Prim.Row>

      {/* Whether the agent can reach this browser is not something to leave a person to infer from
          an agent's apology. The pane opening attaches the bridge on its own, so this is normally
          only ever seen for the moment it takes to connect — or when the person has deliberately
          disconnected, which is exactly when they need telling that this browser is theirs alone. */}
      {agentReach !== 'connected' && (
        <Prim.Row
          flexShrink={0}
          alignItems="center"
          gap="$2"
          paddingHorizontal="$3"
          paddingVertical="$2"
          backgroundColor="$muted"
        >
          <Prim.Text fontSize="$sm" color="$muted-foreground" flex={1}>
            {agentReach === 'connecting'
              ? 'Connecting this browser to your workspace…'
              : 'Agents cannot see this browser — this desktop is disconnected from your workspace.'}
          </Prim.Text>
          {agentReach === 'off' && (
            <Prim.Pressable
              onClick={onConnect}
              minHeight="$8"
              paddingHorizontal="$3"
              display="flex"
              alignItems="center"
              justifyContent="center"
              borderRadius="$radius-md"
              aria-label="Connect this desktop"
            >
              <Prim.Text fontSize="$sm" color="$primary" fontWeight="$medium">
                Connect
              </Prim.Text>
            </Prim.Pressable>
          )}
        </Prim.Row>
      )}

      {(error || state.detail) && (
        <Prim.Box flexShrink={0} paddingHorizontal="$3" paddingVertical="$2" backgroundColor="$muted">
          <Prim.Text fontSize="$sm" color="$destructive">
            {error ?? state.detail}
          </Prim.Text>
        </Prim.Box>
      )}

      {/*
        A plain host element, deliberately. This is the one place in the app that needs raw pointer
        and key events with `preventDefault`, a live `getBoundingClientRect` and a `ResizeObserver`
        target — the same justification `AppView`'s `<iframe>` carries in `@lmthing/ui`. Colours are
        still design tokens; only the element is raw.
      */}
      <div
        ref={viewportRef}
        tabIndex={0}
        role="application"
        aria-label="Browser"
        style={{
          flex: 1,
          minHeight: 0,
          position: 'relative',
          overflow: 'hidden',
          outline: 'none',
          background: 'var(--muted)',
          cursor: 'default',
        }}
        onMouseMove={mouse('mouseMoved')}
        onMouseDown={mouse('mousePressed')}
        onMouseUp={mouse('mouseReleased')}
        onWheel={onWheel}
        onKeyDown={key('keyDown')}
        onKeyUp={key('keyUp')}
      >
        {frame ? (
          <img
            src={`data:image/jpeg;base64,${frame.data}`}
            alt=""
            draggable={false}
            style={{
              width: '100%',
              height: '100%',
              // `contain` and not `fill`: a stretched frame would make every coordinate wrong in a
              // way that looks like the page is merely slightly off, which is the hardest kind to
              // notice. `paneToPage` assumes exactly this.
              objectFit: 'contain',
              // Every event belongs to the container, which owns the coordinate mapping. An image
              // that swallowed its own clicks would report them in its own space, not the page's.
              pointerEvents: 'none',
              userSelect: 'none',
            }}
          />
        ) : (
          <Prim.Col flex={1} alignItems="center" justifyContent="center" padding="$6">
            <Prim.Text color="$muted-foreground">
              {state.status === 'starting'
                ? 'Starting the browser…'
                : state.status === 'error'
                  ? 'The browser could not start.'
                  : state.headless
                    ? 'Waiting for the first frame…'
                    : 'The browser is open in a window of its own.'}
            </Prim.Text>
          </Prim.Col>
        )}
      </div>
    </Prim.Col>
  )
}

function TabStrip({ state }: { state: BrowserState }) {
  return (
    <Prim.Row
      flexShrink={0}
      alignItems="center"
      gap="$1"
      paddingHorizontal="$2"
      paddingTop="$2"
      overflow="hidden"
    >
      {state.tabs.map((t) => {
        const current = t.targetId === state.currentTargetId
        return (
          <Prim.Row
            key={t.targetId}
            alignItems="center"
            maxWidth="$48"
            borderTopLeftRadius="$radius-md"
            borderTopRightRadius="$radius-md"
            backgroundColor={current ? '$background' : '$muted'}
            borderWidth={1}
            borderBottomWidth={0}
            borderColor="$border"
          >
            <Prim.Pressable
              onClick={() => void browserSession.selectTab(t.targetId)}
              paddingHorizontal="$3"
              minHeight="$8"
              display="flex"
              alignItems="center"
              aria-label={`Tab: ${t.title || t.url}`}
            >
              <Prim.Text
                fontSize="$sm"
                whiteSpace="nowrap"
                overflow="hidden"
                textOverflow="ellipsis"
                color={current ? '$foreground' : '$muted-foreground'}
              >
                {t.title || t.url || 'New tab'}
              </Prim.Text>
            </Prim.Pressable>
            <Prim.Pressable
              onClick={() => void browserSession.closeTab(t.targetId)}
              paddingHorizontal="$2"
              minHeight="$8"
              display="flex"
              alignItems="center"
              aria-label={`Close tab: ${t.title || t.url}`}
            >
              <Prim.Text fontSize="$sm" color="$muted-foreground">
                ×
              </Prim.Text>
            </Prim.Pressable>
          </Prim.Row>
        )
      })}
      <Prim.Pressable
        onClick={() => void browserSession.newTab('about:blank')}
        width="$8"
        height="$8"
        display="flex"
        alignItems="center"
        justifyContent="center"
        borderRadius="$radius-md"
        hoverStyle={{ backgroundColor: '$muted' }}
        aria-label="New tab"
      >
        <Prim.Text color="$muted-foreground">+</Prim.Text>
      </Prim.Pressable>
    </Prim.Row>
  )
}

function NavButton({ label, glyph, onPress }: { label: string; glyph: string; onPress: () => void }) {
  return (
    <Prim.Pressable
      onClick={onPress}
      width="$8"
      height="$8"
      display="flex"
      alignItems="center"
      justifyContent="center"
      borderRadius="$radius-md"
      hoverStyle={{ backgroundColor: '$muted' }}
      aria-label={label}
      title={label}
    >
      <Prim.Text color="$muted-foreground">{glyph}</Prim.Text>
    </Prim.Pressable>
  )
}
