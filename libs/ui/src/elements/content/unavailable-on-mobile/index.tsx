import * as React from 'react'
import { Box, Text } from '../../primitives/index'

/**
 * UnavailableOnMobile — the native fallback for the two irreducibly-web IDE widgets
 * (Monaco editor, xterm terminal). Rendered by their `.native.tsx` seams; on web those seams
 * are never bundled, so this only ever shows in the Expo app. A themed empty-state built on the
 * passthrough primitives (Box/Text), so it renders natively once Phase 1 swaps their internals.
 *
 * See docs/react-native-tamagui-migration.md §1.6.
 */
export interface UnavailableOnMobileProps {
  /** Name of the web-only feature, e.g. "Code editor" or "Terminal". */
  feature: string
}

export function UnavailableOnMobile({ feature }: UnavailableOnMobileProps) {
  return (
    <Box className="unavailable-on-mobile" role="note">
      <Text as="strong" className="unavailable-on-mobile__title">
        {feature} is available on the web app
      </Text>
      <Text block className="unavailable-on-mobile__body">
        Open this workspace in a desktop browser to use the {feature.toLowerCase()}.
      </Text>
    </Box>
  )
}
