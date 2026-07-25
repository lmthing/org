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
    // These were `unavailable-on-mobile*` classNames that NO stylesheet ever defined — the
    // "themed" empty state above rendered completely unstyled, on web and native alike. Style
    // props fix that and are the only form that works on native at all.
    <Box
      role="note"
      display="flex"
      flexDirection="column"
      gap="$2"
      alignItems="center"
      justifyContent="center"
      padding="$6"
      height="100%"
      backgroundColor="$background"
      borderRadius="$radius-lg"
    >
      <Text as="strong" fontSize="$base" fontWeight="$semibold" color="$foreground" textAlign="center">
        {feature} is available on the web app
      </Text>
      <Text block fontSize="$sm" color="$muted-foreground" textAlign="center">
        Open this workspace in a desktop browser to use the {feature.toLowerCase()}.
      </Text>
    </Box>
  )
}
