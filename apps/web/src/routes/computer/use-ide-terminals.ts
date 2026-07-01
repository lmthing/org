import { useCallback, useEffect, useRef, useState } from 'react'
import type { TerminalTab } from '@lmthing/ui/computer'
import type { PodTransport } from '@lmthing/state'
import type { TerminalSession, RuntimeStatus } from '@/lib/runtime/types'

const CLI_LOG_COMMAND = 'tail -n 100 -f /tmp/lmthing-server.log 2>/dev/null || sleep 9999'

/**
 * Owns the IDE's terminal tabs: the always-on `cli`/`bash` pair (created once
 * the pod is running) plus any user-added `bash-*` tabs.
 */
export function useIdeTerminals(status: RuntimeStatus, transport: PodTransport | null) {
  const [tabs, setTabs] = useState<TerminalTab[]>([
    { id: 'cli', label: 'process', session: null, readonly: true },
    { id: 'bash', label: 'bash', session: null },
  ])
  const [activeTabId, setActiveTabId] = useState<string>('bash')

  const sessionsRef = useRef<Map<string, TerminalSession>>(new Map())

  // Create both terminal sessions when pod is running via transport
  useEffect(() => {
    if (status !== 'running' || !transport) return

    const cliSession = transport.connectTerminal(CLI_LOG_COMMAND)
    const bashSession = transport.connectTerminal()

    sessionsRef.current.set('cli', cliSession)
    sessionsRef.current.set('bash', bashSession)
    setTabs((prev) => prev.map((t) => {
      if (t.id === 'cli') return { ...t, session: cliSession }
      if (t.id === 'bash') return { ...t, session: bashSession }
      return t
    }))

    return () => {
      cliSession.dispose()
      bashSession.dispose()
      sessionsRef.current.delete('cli')
      sessionsRef.current.delete('bash')
      setTabs((prev) => prev.map((t) =>
        (t.id === 'cli' || t.id === 'bash') ? { ...t, session: null } : t
      ))
    }
  }, [status, transport])

  const handleAddTab = useCallback(() => {
    if (!transport) return
    const id = `bash-${Date.now()}`
    setTabs((prev) => [...prev, { id, label: 'bash', session: null }])
    setActiveTabId(id)
    const session = transport.connectTerminal()
    sessionsRef.current.set(id, session)
    setTabs((prev) => prev.map((t) => t.id === id ? { ...t, session } : t))
  }, [transport])

  const handleCloseTab = useCallback((id: string) => {
    sessionsRef.current.get(id)?.dispose()
    sessionsRef.current.delete(id)
    setTabs((prev) => prev.filter((t) => t.id !== id))
    setActiveTabId((prev) => {
      if (prev !== id) return prev
      const remaining = tabs.filter((t) => t.id !== id)
      return remaining[remaining.length - 1]?.id ?? 'bash'
    })
  }, [tabs])

  return { tabs, activeTabId, setActiveTabId, handleAddTab, handleCloseTab }
}
