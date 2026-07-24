import * as Prim from '../elements/primitives/index.js';
import { Button } from '../elements/forms/button'

export type ConnectionState = 'connected' | 'error' | 'booting'

export interface ConnectionBannerProps {
  state: ConnectionState
  error?: string | null
  onRetry?: () => void
}

// .computer-connection-banner--error / --booting tinted-surface modifiers → conditional props
// (connection-banner.styled.tsx proof `state` variant). Alphas via web color-mix over runtime vars.
const BANNER_STATE = {
  error: {
    backgroundColor: 'color-mix(in srgb, var(--destructive) 10%, transparent)',
    color: '$destructive',
    borderBottomWidth: 1,
    borderBottomColor: 'color-mix(in srgb, var(--destructive) 20%, transparent)',
  },
  booting: {
    backgroundColor: 'color-mix(in srgb, var(--warning) 10%, transparent)',
    color: '$warning',
    borderBottomWidth: 1,
    borderBottomColor: 'color-mix(in srgb, var(--warning) 20%, transparent)',
  },
} as const

// .computer-connection-banner__dot--error / --booting background modifiers → conditional prop.
// The dot's `animate-pulse` is a Tailwind builtin (not from this component's CSS) so it stays a
// residual className until the P4 animation driver.
const DOT_BG = { error: '$destructive', booting: '$warning' } as const

function ConnectionBanner({ state, error, onRetry }: ConnectionBannerProps) {
  if (state === 'connected') return null

  const isError = state === 'error'
  const bannerState: 'error' | 'booting' = isError ? 'error' : 'booting'

  return (
    <Prim.Box
      display="flex"
      alignItems="center"
      justifyContent="space-between"
      gap="$3"
      paddingHorizontal="$4"
      paddingVertical="$2"
      fontSize="$sm"
      {...BANNER_STATE[bannerState]}
    >
      <Prim.Text display="flex" alignItems="center" gap="$2" flexGrow={1} flexShrink={1} flexBasis="0%">
        <Prim.Text
          width="$2"
          height="$2"
          borderRadius="$radius-full"
          flexShrink={0}
          backgroundColor={DOT_BG[bannerState]}
          className="animate-pulse"
        />
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
