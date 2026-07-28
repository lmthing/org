/**
 * The icons this surface uses, drawn with the SVG primitives.
 *
 * Not `lucide-react`: that renders DOM `<svg>` and cannot run on native. Not
 * `@tamagui/lucide-icons-2` either — it is declared in this package's manifest
 * but is not actually installed, so importing it fails to resolve today.
 *
 * The SVG primitives were built for exactly this ("inline icons then render on
 * native too", `elements/primitives/svg.tsx`): the web components are named to
 * mirror `react-native-svg`'s, and the native fork re-exports them directly, so
 * one definition draws on both targets with no per-platform branch here.
 *
 * Paths are Lucide's, at its 24×24 grid and 2px stroke, so an icon here is the
 * same glyph the rest of the app draws.
 */

import * as React from 'react'
import * as Prim from '../elements/primitives/index'

export interface IconProps {
  size?: number
  /** Any design-system color; defaults to the surrounding text colour. */
  color?: string
}

function Icon({
  size = 16,
  color = 'currentColor',
  children,
}: IconProps & { children: React.ReactNode }) {
  return (
    <Prim.Svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden={true}
    >
      {children}
    </Prim.Svg>
  )
}

export const HashIcon = (p: IconProps) => (
  <Icon {...p}>
    <Prim.Line x1="4" y1="9" x2="20" y2="9" />
    <Prim.Line x1="4" y1="15" x2="20" y2="15" />
    <Prim.Line x1="10" y1="3" x2="8" y2="21" />
    <Prim.Line x1="16" y1="3" x2="14" y2="21" />
  </Icon>
)

export const PlusIcon = (p: IconProps) => (
  <Icon {...p}>
    <Prim.Path d="M5 12h14" />
    <Prim.Path d="M12 5v14" />
  </Icon>
)

export const CloseIcon = (p: IconProps) => (
  <Icon {...p}>
    <Prim.Path d="M18 6 6 18" />
    <Prim.Path d="m6 6 12 12" />
  </Icon>
)

export const MenuIcon = (p: IconProps) => (
  <Icon {...p}>
    <Prim.Line x1="4" y1="6" x2="20" y2="6" />
    <Prim.Line x1="4" y1="12" x2="20" y2="12" />
    <Prim.Line x1="4" y1="18" x2="20" y2="18" />
  </Icon>
)

export const ChevronDownIcon = (p: IconProps) => (
  <Icon {...p}>
    <Prim.Path d="m6 9 6 6 6-6" />
  </Icon>
)

export const ChevronRightIcon = (p: IconProps) => (
  <Icon {...p}>
    <Prim.Path d="m9 18 6-6-6-6" />
  </Icon>
)

export const MoreVerticalIcon = (p: IconProps) => (
  <Icon {...p}>
    <Prim.Circle cx="12" cy="12" r="1" />
    <Prim.Circle cx="12" cy="5" r="1" />
    <Prim.Circle cx="12" cy="19" r="1" />
  </Icon>
)

export const SendIcon = (p: IconProps) => (
  <Icon {...p}>
    <Prim.Path d="m22 2-7 20-4-9-9-4Z" />
    <Prim.Path d="M22 2 11 13" />
  </Icon>
)

export const ThreadIcon = (p: IconProps) => (
  <Icon {...p}>
    <Prim.Path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
  </Icon>
)

export const AppIcon = (p: IconProps) => (
  <Icon {...p}>
    <Prim.Rect x="2" y="4" width="20" height="16" rx="2" />
    <Prim.Path d="M2 9h20" />
  </Icon>
)

export const ExternalLinkIcon = (p: IconProps) => (
  <Icon {...p}>
    <Prim.Path d="M15 3h6v6" />
    <Prim.Path d="M10 14 21 3" />
    <Prim.Path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
  </Icon>
)
