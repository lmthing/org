import { useCallback, useState } from 'react'
import { useAuth } from '@lmthing/auth'
import { COMPUTER_BASE_URL } from '@/lib/config'

/**
 * Triggers a pod restart via the compute API, then polls `/api/env` until the
 * pod comes back up and reloads the page.
 */
export function usePodRestart() {
  const { session, authFetch } = useAuth()
  const [restarting, setRestarting] = useState(false)

  const handleRestart = useCallback(async () => {
    if (!session?.accessToken) return
    setRestarting(true)
    try {
      await authFetch(`${COMPUTER_BASE_URL}/api/restart`, { method: 'POST' })
    } catch { /* expected — pod exits */ }
    const poll = async () => {
      try {
        const r = await authFetch(`${COMPUTER_BASE_URL}/api/env`)
        if (r.ok) { setTimeout(() => window.location.reload(), 1500); return }
      } catch { /* still down */ }
      setTimeout(poll, 800)
    }
    setTimeout(poll, 1000)
  }, [session, authFetch])

  return { restarting, handleRestart }
}
