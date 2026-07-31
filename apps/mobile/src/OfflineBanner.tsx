import * as React from 'react'
import * as Prim from '@lmthing/ui/elements/primitives'
import { useConnectivity } from './connectivity'

/**
 * The one thing missing from this app: nothing ever told the user they were offline. A dropped
 * chat/team socket and a quiet channel look identical — both are silence — so without this a
 * member could not tell "nobody has said anything" from "my phone lost the network".
 *
 * Deliberately a slim, non-modal strip rather than a full-screen takeover or an `Alert`: it must
 * say one true thing and get out of the way, not read as an error the member has to dismiss. It
 * renders NOTHING for `'unknown'` (native module still loading, or not linked in this build) —
 * an indicator that might be lying is worse than no indicator, per `./connectivity.ts#useConnectivity`.
 *
 * Mounted once, at the root of the app (`App.tsx`), above the tab content — connectivity is a
 * property of the DEVICE, not of whichever of Home/Chat/Teams happens to be open, and it is exactly
 * as relevant on the login screen (you cannot sign in offline either) and the pod-boot screen (that
 * IS a network call) as it is once a conversation is open.
 */
export function OfflineBanner() {
  const status = useConnectivity()
  if (status !== 'offline') return null

  return (
    <Prim.Row
      alignItems="center"
      justifyContent="center"
      gap="$2"
      paddingVertical="$1.5"
      paddingHorizontal="$3"
      backgroundColor="$warning"
      flexShrink={0}
      aria-label="You are offline"
    >
      <Prim.Text color="$warning-foreground" fontSize="$xs" fontWeight="$medium" textAlign="center">
        You’re offline — messages will send once you’re back online
      </Prim.Text>
    </Prim.Row>
  )
}
