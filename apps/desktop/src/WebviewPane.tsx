import * as React from 'react'
import * as Prim from '@lmthing/ui/elements/primitives'
import { invoke } from '@tauri-apps/api/core'

/**
 * The browser pane — a real webview, positioned by the OS inside this window.
 *
 * ## How this is put together, and why it looks odd
 *
 * The toolbar below is ordinary React in the app's document. The area under it is EMPTY: a `<div>`
 * that renders nothing and exists only to be measured. Rust puts an actual second webview over
 * that rectangle (`src-tauri/src/browser_view.rs`).
 *
 * So the page you see is not in this document and cannot be reached from it. That is the point —
 * it is a real browser view, with real scrolling, real text rendering, real form controls, real
 * file pickers and real video, none of which survive being streamed as JPEG frames (which is what
 * this pane used to do).
 *
 * ## The one rule that follows from it
 *
 * A child webview is an OS rectangle, not an element, so **the app cannot draw on top of it**.
 * Nothing in this document — a drawer, a dialog, a menu — will appear over the page; it will be
 * painted underneath and be invisible. Anything that must cover the pane has to HIDE it first,
 * which is why `visible` drives `browserview_hide`/`show` rather than a CSS property.
 */

interface Bounds {
  x: number
  y: number
  width: number
  height: number
}

/** Ask Rust to keep the page pinned to this rectangle. */
async function place(url: string, rect: Bounds): Promise<void> {
  await invoke('browserview_open', { url, rect })
}

/**
 * Run JavaScript in the page and parse what comes back.
 *
 * `eval_with_callback` serialises the expression's value to JSON, so anything the page can express
 * as JSON comes back intact. This is the whole read path — and the reason a webview pane is
 * possible at all, since a plain `eval` in Tauri returns nothing.
 */
async function pageEval<T>(js: string): Promise<T | null> {
  try {
    const raw = await invoke<string>('browserview_eval', { js })
    return JSON.parse(raw) as T
  } catch {
    return null
  }
}

const HOME = 'https://duckduckgo.com'

export function WebviewPane({ visible }: { visible: boolean }) {
  const hostRef = React.useRef<HTMLDivElement | null>(null)
  const [address, setAddress] = React.useState('')
  const [editing, setEditing] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const opened = React.useRef(false)

  /** The pane's rectangle in window coordinates — what Rust needs to place the webview. */
  const measure = React.useCallback((): Bounds | null => {
    const el = hostRef.current
    if (!el) return null
    const r = el.getBoundingClientRect()
    if (r.width < 1 || r.height < 1) return null
    return { x: r.left, y: r.top, width: r.width, height: r.height }
  }, [])

  // Open on first show; hide (never close) afterwards. Hiding keeps the page, the scroll position
  // and anything half-typed — closing would throw all three away every time someone glanced at
  // another surface.
  React.useEffect(() => {
    let cancelled = false
    const run = async () => {
      if (!visible) {
        if (opened.current) await invoke('browserview_hide').catch(() => {})
        return
      }
      const rect = measure()
      if (!rect) return
      try {
        await place(opened.current ? address || HOME : HOME, rect)
        if (!cancelled) opened.current = true
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e))
      }
    }
    void run()
    return () => {
      cancelled = true
    }
  }, [visible, measure, address])

  // Hide it on the way out. A CSS-hidden pane still shows its webview: the view is an OS rectangle
  // over the window, not an element in this document, so unmounting the React tree — switching to a
  // project app, or to Local access, both of which render a different tree entirely — would leave a
  // page floating over the app with no way to reach it.
  React.useEffect(() => () => void invoke('browserview_hide').catch(() => {}), [])

  // Follow the divider and the window. The webview is positioned in window coordinates, so it does
  // NOT move with the layout on its own — without this it stays where it was first put while the
  // pane slides out from under it.
  React.useEffect(() => {
    const el = hostRef.current
    if (!el || !visible) return undefined
    const sync = () => {
      const rect = measure()
      if (rect) void invoke('browserview_bounds', { rect }).catch(() => {})
    }
    const ro = new ResizeObserver(sync)
    ro.observe(el)
    window.addEventListener('resize', sync)
    return () => {
      ro.disconnect()
      window.removeEventListener('resize', sync)
    }
  }, [visible, measure])

  // Follow the page's own navigation, so the address bar is not a stale record of what was typed.
  React.useEffect(() => {
    if (!visible) return undefined
    const tick = async () => {
      const info = await pageEval<{ url: string }>('window.__lmthing && window.__lmthing.info()')
      if (info?.url && !editing) setAddress(info.url)
    }
    void tick()
    const timer = setInterval(() => void tick(), 1_000)
    return () => clearInterval(timer)
  }, [visible, editing])

  const go = React.useCallback(async () => {
    setEditing(false)
    try {
      await invoke('browserview_navigate', { url: address })
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }, [address])

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
        <NavButton label="Back" glyph="←" onPress={() => void pageEval('history.back()')} />
        <NavButton label="Forward" glyph="→" onPress={() => void pageEval('history.forward()')} />
        <NavButton label="Reload" glyph="⟳" onPress={() => void pageEval('location.reload()')} />
        <Prim.TextField
          flex={1}
          value={address}
          placeholder="Search, or enter an address"
          onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
            setEditing(true)
            setAddress(e.target.value)
          }}
          onKeyDown={(e: React.KeyboardEvent) => {
            if (e.key === 'Enter') void go()
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
      </Prim.Row>

      {error && (
        <Prim.Box flexShrink={0} paddingHorizontal="$3" paddingVertical="$2" backgroundColor="$muted">
          <Prim.Text fontSize="$sm" color="$destructive">
            {error}
          </Prim.Text>
        </Prim.Box>
      )}

      {/* Measured, never drawn into. The page is an OS-level view sitting exactly here. */}
      <div ref={hostRef} style={{ flex: 1, minHeight: 0 }} aria-label="Browser" />
    </Prim.Col>
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
      color="$muted-foreground"
      hoverStyle={{ backgroundColor: '$muted' }}
      aria-label={label}
    >
      <Prim.Text>{glyph}</Prim.Text>
    </Prim.Pressable>
  )
}
