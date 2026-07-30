/**
 * The named icon set — 32 glyphs, drawn with the SVG primitives.
 *
 * **Not lucide.** `lucide-react` renders a DOM `<svg>` and mounts nothing at all on React
 * Native, and `@tamagui/lucide-icons-2` is declared in this package's manifest but is not
 * installed. `elements/primitives/svg.tsx` exists for exactly this case: the web
 * components mirror `react-native-svg`'s names and the native fork re-exports that library
 * directly, so one definition draws on both targets with no branch here. The team surface
 * (`src/team/icons.tsx`) is the precedent and `metro/suites/team.tsx` is the proof.
 *
 * Paths are Lucide's, at its 24×24 grid and 2px stroke, so a spec icon is the same glyph
 * the rest of the app draws.
 *
 * **An unknown name surfaces the menu, never a blank.** The set is finite by design; the
 * point of a menu is that a wrong choice is legible. A name outside {@link ICON_NAMES}
 * draws the `alert` glyph and — where a text label fits — names the offender, which is the
 * same menu-shaped-error philosophy the writers use, applied at render time for a spec
 * that somehow reached a device unvalidated.
 */

import * as React from 'react'
import { useTheme } from '@tamagui/core'
import * as Prim from '../elements/primitives/index'
import { ICON_NAMES, type IconName, type Tone } from './types'
import { toneTokens } from './format'

/**
 * Resolve a `$token` colour to a concrete value, because **only web can resolve one itself.**
 *
 * `Prim.Svg` is a styled Tamagui component on web, so `stroke="$foreground"` becomes a CSS var and
 * works. On native `elements/primitives/svg.native.tsx` is a **bare re-export of
 * `react-native-svg`** — deliberately, so inline icons need no surface edits — and RNSVG has no
 * token layer: it parses the string as a colour, fails, and draws NOTHING. Measured on the emulator
 * against the first model-built app: 25× `"$foreground" is not a valid color or brush` from RNSVG's
 * `extractBrush`, and every toned icon silently missing — the `check` glyphs on each row action
 * existed as `PathView` nodes and painted nothing. Only untoned icons survived, because
 * `'currentColor'` happens to be valid in RNSVG too.
 *
 * Resolving here rather than in a `.native.tsx` fork of this file is deliberate: a fork would
 * duplicate the 32-glyph path table, which this module exists to keep in one place. A resolved
 * `rgb()`/hex is valid on BOTH targets, so one code path serves both.
 *
 * A token that is not in the theme falls back to `currentColor` — valid on both targets — never to
 * the unresolved `$name`, which is the failure being fixed.
 */
function useColorValue(color: string): string {
  const theme = useTheme()
  if (!color.startsWith('$')) return color
  const entry = (theme as unknown as Record<string, { get?: () => unknown } | undefined>)[color.slice(1)]
  const value = entry && typeof entry.get === 'function' ? entry.get() : undefined
  return typeof value === 'string' && value !== '' ? value : 'currentColor'
}

/** The three sizes a spec may name, in px. */
export const ICON_SIZES = { sm: 14, md: 16, lg: 20 } as const
export type IconSize = keyof typeof ICON_SIZES

export interface ViewIconProps {
  /** A name from the closed set. Anything else draws the fallback glyph. */
  name: string
  size?: IconSize | number
  /** Semantic tone. `auto` is settled by the caller; here it reads as neutral. */
  tone?: Exclude<Tone, 'auto'>
  /** Overrides `tone` — used where the icon must inherit a surrounding colour. */
  color?: string
}

function Glyph({
  size,
  color,
  children,
}: {
  size: number
  color: string
  children: React.ReactNode
}) {
  const stroke = useColorValue(color)
  return (
    <Prim.Svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={stroke}
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden={true}
    >
      {children}
    </Prim.Svg>
  )
}

const P = (d: string, key?: string) => <Prim.Path key={key} d={d} />

/**
 * The glyph table. One entry per {@link ICON_NAMES} member — the `Record<IconName, …>`
 * type is what makes a name added to the contract and not drawn here a `pnpm typecheck`
 * failure rather than an empty square on a phone.
 */
const PATHS: Record<IconName, React.ReactNode> = {
  home: [P('M3 10.5 12 3l9 7.5', 'a'), P('M5 9.5V21h14V9.5', 'b')],
  search: [<Prim.Circle key="a" cx="11" cy="11" r="7" />, P('m21 21-4.3-4.3', 'b')],
  plus: [P('M12 5v14', 'a'), P('M5 12h14', 'b')],
  edit: [P('M12 20h9', 'a'), P('M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z', 'b')],
  trash: [P('M3 6h18', 'a'), P('M8 6V4h8v2', 'b'), P('M6 6v14h12V6', 'c')],
  check: P('m20 6-11 11-5-5'),
  close: [P('M18 6 6 18', 'a'), P('m6 6 12 12', 'b')],
  'chevron-right': P('m9 18 6-6-6-6'),
  'chevron-down': P('m6 9 6 6 6-6'),
  'arrow-left': [P('M19 12H5', 'a'), P('m12 19-7-7 7-7', 'b')],
  filter: P('M22 3H2l8 9.5V19l4 2v-8.5Z'),
  more: [
    <Prim.Circle key="a" cx="5" cy="12" r="1.4" fill="currentColor" />,
    <Prim.Circle key="b" cx="12" cy="12" r="1.4" fill="currentColor" />,
    <Prim.Circle key="c" cx="19" cy="12" r="1.4" fill="currentColor" />,
  ],
  refresh: [P('M21 12a9 9 0 1 1-3-6.7', 'a'), P('M21 3v6h-6', 'b')],
  calendar: [
    P('M3 6a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v13a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z', 'a'),
    P('M3 10h18', 'b'),
    P('M8 2v4', 'c'),
    P('M16 2v4', 'd'),
  ],
  clock: [<Prim.Circle key="a" cx="12" cy="12" r="9" />, P('M12 7v5l3 2', 'b')],
  user: [<Prim.Circle key="a" cx="12" cy="8" r="4" />, P('M4 21a8 8 0 0 1 16 0', 'b')],
  users: [
    <Prim.Circle key="a" cx="9" cy="8" r="4" />,
    P('M2 21a7 7 0 0 1 14 0', 'b'),
    P('M17 4.5a4 4 0 0 1 0 7.5', 'c'),
    P('M18.5 14.5A7 7 0 0 1 22 21', 'd'),
  ],
  tag: [P('M20.5 12.5 12 21 3 12V3h9Z', 'a'), <Prim.Circle key="b" cx="7.5" cy="7.5" r="1.4" />],
  file: [P('M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8Z', 'a'), P('M14 3v5h5', 'b')],
  'map-pin': [P('M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z', 'a'), <Prim.Circle key="b" cx="12" cy="10" r="3" />],
  alert: [P('M12 3 1.8 20h20.4Z', 'a'), P('M12 9v5', 'b'), P('M12 17.5v.5', 'c')],
  info: [<Prim.Circle key="a" cx="12" cy="12" r="9" />, P('M12 11v5', 'b'), P('M12 7.5V8', 'c')],
  star: P('m12 3 2.9 5.9 6.6.9-4.8 4.6 1.2 6.5-5.9-3.1L6.1 21l1.2-6.6L2.5 9.8l6.6-.9Z'),
  bell: [P('M18 9a6 6 0 1 0-12 0c0 6-3 7-3 7h18s-3-1-3-7', 'a'), P('M10.5 20a2 2 0 0 0 3 0', 'b')],
  chart: [P('M4 20V10', 'a'), P('M10 20V4', 'b'), P('M16 20v-7', 'c'), P('M22 20H2', 'd')],
  list: [P('M8 6h13', 'a'), P('M8 12h13', 'b'), P('M8 18h13', 'c'), P('M3 6h.01', 'd'), P('M3 12h.01', 'e'), P('M3 18h.01', 'f')],
  link: [P('M10 13a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1.5 1.5', 'a'), P('M14 11a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7L12.5 19.5', 'b')],
  'external-link': [P('M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6', 'a'), P('M15 3h6v6', 'b'), P('M10 14 21 3', 'c')],
  download: [P('M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4', 'a'), P('m7 10 5 5 5-5', 'b'), P('M12 15V3', 'c')],
  upload: [P('M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4', 'a'), P('m17 8-5-5-5 5', 'b'), P('M12 3v12', 'c')],
  mail: [P('M3 7a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z', 'a'), P('m3 7 9 6 9-6', 'b')],
  settings: [
    <Prim.Circle key="a" cx="12" cy="12" r="3" />,
    P('M19.4 15a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-2.7 1.1v.3a2 2 0 1 1-4 0v-.2a1.6 1.6 0 0 0-2.8-1.1l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1A1.6 1.6 0 0 0 4.5 15H4a2 2 0 1 1 0-4h.2A1.6 1.6 0 0 0 5.3 8.2l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1A1.6 1.6 0 0 0 11 4.4V4a2 2 0 1 1 4 0v.2a1.6 1.6 0 0 0 2.7 1.1l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0 1.1 2.7H22a2 2 0 1 1 0 4h-.2a1.6 1.6 0 0 0-1.4 1Z', 'b'),
  ],
}

const KNOWN = new Set<string>(ICON_NAMES)

/** True when `name` is a member of the pinned icon set. */
export function isIconName(name: string): name is IconName {
  return KNOWN.has(name)
}

/** The whole menu, for an error message that has to name the finite valid set. */
export const ICON_MENU = ICON_NAMES.join(', ')

/**
 * Draw a named icon.
 *
 * An unknown name draws `alert` — a deliberate, visible wrong-looking glyph — rather than
 * nothing. A silent blank is the failure mode a closed vocabulary exists to prevent.
 */
export function ViewIcon({ name, size = 'md', tone, color }: ViewIconProps): React.ReactElement {
  const px = typeof size === 'number' ? size : ICON_SIZES[size]
  const stroke = color ?? (tone ? toneTokens(tone).fg : 'currentColor')
  const glyph = isIconName(name) ? PATHS[name] : PATHS.alert
  return (
    <Glyph size={px} color={stroke}>
      {glyph}
    </Glyph>
  )
}

/** A star, filled or hollow — the one glyph `rating` needs in two states. */
export function StarGlyph({ filled, size = 16, color }: { filled: boolean; size?: number; color?: string }) {
  // Resolved for the same reason as {@link Glyph}: `$warning` reaches react-native-svg verbatim and
  // draws nothing, so every star in a `rating` element was invisible on a phone.
  const stroke = useColorValue(color ?? '$warning')
  return (
    <Prim.Svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill={filled ? stroke : 'none'}
      stroke={stroke}
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden={true}
    >
      <Prim.Path d="m12 3 2.9 5.9 6.6.9-4.8 4.6 1.2 6.5-5.9-3.1L6.1 21l1.2-6.6L2.5 9.8l6.6-.9Z" />
    </Prim.Svg>
  )
}
