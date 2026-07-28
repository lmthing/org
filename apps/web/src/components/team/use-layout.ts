/**
 * How much of the surface fits at once.
 *
 * The channels surface is three columns — sidebar, conversation, rail — and on a
 * phone none of them can be a column. What changes is not the width of things
 * but WHICH ONE IS ON SCREEN, so this is a structural decision the components
 * branch on, not a set of CSS breakpoints they style through.
 *
 * `useMedia` rather than `matchMedia`: it is Tamagui's own, it reads the same
 * breakpoints the style props do (so a `$gtMd` prop and this hook can never
 * disagree), and — the reason it matters here — it works on the native target,
 * where `matchMedia` does not exist. This surface is being shared with
 * `apps/mobile`, so a web-only media hook would have to be replaced immediately.
 */

import { useMedia } from '@tamagui/core'

export interface TeamLayout {
  /** Below `lg` (1024): one pane at a time, sidebar and rail become overlays. */
  compact: boolean
  /** Below `md` (768): a phone. The rail takes the whole screen. */
  phone: boolean
}

export function useTeamLayout(): TeamLayout {
  const media = useMedia()
  return {
    // `gtMd` is ≥1024 — the width at which a 230px sidebar, a readable
    // conversation and a ~380px rail all fit without any of them being cramped.
    compact: !media.gtMd,
    phone: !media.gtSm,
  }
}
