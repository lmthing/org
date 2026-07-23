import * as Prim from '../elements/primitives/index.js';
import '@lmthing/css/components/computer/connection-banner.css'
import { Button } from '../elements/forms/button'
import { cn } from '../lib/utils'

export type ConnectionState = 'connected' | 'error' | 'booting'

export interface ConnectionBannerProps {
  state: ConnectionState
  error?: string | null
  onRetry?: () => void
}

function ConnectionBanner({ state, error, onRetry }: ConnectionBannerProps) {
  if (state === 'connected') return null

  const isError = state === 'error'

  return (
    <Prim.Box className={cn(
      'computer-connection-banner',
      isError && 'computer-connection-banner--error',
      state === 'booting' && 'computer-connection-banner--booting',
    )}>
      <Prim.Text className="computer-connection-banner__message">
        <Prim.Text className={cn(
          'computer-connection-banner__dot',
          isError && 'computer-connection-banner__dot--error',
          state === 'booting' && 'computer-connection-banner__dot--booting',
        )} />
        {isError
          ? (error ?? 'Connection lost. The runtime is not responding.')
          : 'Starting runtime...'}
      </Prim.Text>
      {isError && onRetry && (
        <Button variant="ghost" size="sm" onClick={onRetry}>
          Retry
        </Button>
      )}
    </Prim.Box>
  )
}

export { ConnectionBanner }
