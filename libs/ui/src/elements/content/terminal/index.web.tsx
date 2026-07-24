import '@xterm/xterm/css/xterm.css'
import { useEffect, useRef, useState, useCallback } from 'react'
import { Terminal as XTerm } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { WebLinksAddon } from '@xterm/addon-web-links'
import * as Prim from '../../primitives/index'

export interface TerminalSession {
  write(data: string): void
  onData(cb: (data: string) => void): () => void
  resize(cols: number, rows: number): void
}

export interface TerminalProps {
  session: TerminalSession | null
  className?: string
  fontSize?: number
  readonly?: boolean
}

/**
 * `.terminal` container — flex, flex-col, w-full, h-full, bg-background, overflow-hidden,
 * rounded-md — as `$`-token PROPS from terminal.styled.tsx (docs/tamagui-idiomatic-migration.md §4).
 * `terminal/index.css` is deleted. (The xterm stylesheet is a vendor import and stays.)
 */
const TERMINAL_BASE = {
  display: 'flex',
  flexDirection: 'column',
  width: '100%',
  height: '100%',
  backgroundColor: '$background',
  overflow: 'hidden',
  borderRadius: '$radius-md',
} as const

/** `.terminal--loading` — centres the placeholder while there is no session. */
const TERMINAL_LOADING = { alignItems: 'center', justifyContent: 'center' } as const

/** `.terminal__viewport` — flex-1, min-h-0 (the xterm mount target). */
const TERMINAL_VIEWPORT = { flexGrow: 1, flexShrink: 1, flexBasis: '0%', minHeight: 0 } as const

function Terminal({ session, className, fontSize = 14, readonly }: TerminalProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [xterm, setXterm] = useState<XTerm | null>(null)
  const fitAddonRef = useRef<FitAddon | null>(null)

  // Initialize xterm when container gets dimensions
  const initRef = useCallback((el: HTMLDivElement | null) => {
    containerRef.current = el
  }, [])

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    let disposed = false

    function tryInit() {
      if (disposed || !container) return
      if (container.offsetWidth === 0 || container.offsetHeight === 0) return

      observer.disconnect()

      const instance = new XTerm({
        fontSize,
        fontFamily: 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace',
        cursorBlink: true,
      })

      const fitAddon = new FitAddon()
      instance.loadAddon(fitAddon)
      instance.loadAddon(new WebLinksAddon())
      instance.open(container)

      requestAnimationFrame(() => {
        try { fitAddon.fit() } catch { /* */ }
      })

      fitAddonRef.current = fitAddon
      setXterm(instance)
    }

    const observer = new ResizeObserver(() => tryInit())
    observer.observe(container)
    tryInit()

    return () => {
      disposed = true
      observer.disconnect()
      // xterm cleanup happens in a separate effect since it's state
    }
  }, [fontSize])

  // Cleanup xterm on unmount
  useEffect(() => {
    return () => {
      if (xterm) {
        xterm.dispose()
        setXterm(null)
        fitAddonRef.current = null
      }
    }
  }, [xterm])

  // Wire session I/O — depends on both xterm instance AND session
  useEffect(() => {
    if (!xterm || !session) return

    const unsubData = session.onData((data) => {
      xterm.write(data)
    })

    const disposable = readonly ? null : xterm.onData((data: string) => {
      session.write(data)
    })

    return () => {
      unsubData()
      disposable?.dispose()
    }
  }, [xterm, session, readonly])

  // Handle resize
  useEffect(() => {
    const container = containerRef.current
    const fitAddon = fitAddonRef.current
    if (!container || !fitAddon || !xterm) return

    const observer = new ResizeObserver(() => {
      try {
        fitAddon.fit()
        if (session) {
          session.resize(xterm.cols, xterm.rows)
        }
      } catch { /* */ }
    })

    observer.observe(container)
    return () => observer.disconnect()
  }, [xterm, session])

  return (
    <Prim.Box {...TERMINAL_BASE} {...(!session ? TERMINAL_LOADING : {})} className={className}>
      <Prim.Box ref={initRef} {...TERMINAL_VIEWPORT} />
    </Prim.Box>
  )
}

export { Terminal }
