import * as React from 'react'
import * as Prim from '@lmthing/ui/elements/primitives'

/**
 * "You are offline", above everything.
 *
 * `navigator.onLine` plus the two window events, rather than mobile's `expo-network`: this is the
 * browser primitive that library wraps, and the shell is the only place allowed to know which
 * target it is on.
 *
 * `onLine` is a weak signal — it reports a link, not reachability, so a captive portal still reads
 * as online. That is acceptable for a banner whose job is explaining an obvious failure, and it is
 * why nothing branches on it: the surfaces keep trying and their own errors stay authoritative.
 */
export function OfflineBanner() {
  const [offline, setOffline] = React.useState(() => navigator.onLine === false)

  React.useEffect(() => {
    const online = () => setOffline(false)
    const down = () => setOffline(true)
    window.addEventListener('online', online)
    window.addEventListener('offline', down)
    return () => {
      window.removeEventListener('online', online)
      window.removeEventListener('offline', down)
    }
  }, [])

  if (!offline) return null

  return (
    <Prim.Row
      flexShrink={0}
      alignItems="center"
      justifyContent="center"
      paddingVertical="$2"
      paddingHorizontal="$3"
      backgroundColor="$muted"
    >
      <Prim.Text color="$muted-foreground" fontSize="$sm">
        You’re offline — messages will send when the connection returns.
      </Prim.Text>
    </Prim.Row>
  )
}
