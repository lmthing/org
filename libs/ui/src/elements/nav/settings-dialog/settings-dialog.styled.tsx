/**
 * settings-dialog.styled.tsx — P2 conversion of the `.settings-dialog` BEM block
 * (docs/tamagui-idiomatic-migration.md §4). Converts libs/css/src/elements/nav/settings-dialog/index.css —
 * the widened dialog frame (`.dialog.settings-dialog`), its `__body` split, the left `__tabs` rail
 * (+ `__tab`/`--active`/`__tab-icon`) and the scrollable right `__panel`/`__section` — into idiomatic
 * Tamagui `styled()` frames using the SPIKE-A1 var-backed `$` colors and SPIKE-B scales.
 *
 * `transition-colors` awaits the animation driver (§5/P4). The stylesheet's `@media (max-width:640px)`
 * mobile overrides for `__body`/`__tabs` are NOT applied here: the shared media config
 * (libs/css/.../tokens.generated.ts) exposes only MIN-width breakpoints ($gtXs…), so a max-width query
 * has no matching media prop — the desktop base is kept faithfully and the mobile stack is documented
 * per frame (see report). Lands alongside the shipped className SettingsDialog (index.tsx);
 * settings-dialog-styled.test.tsx pins the frames.
 */
import * as React from 'react'
import { styled, View } from '../../../theme/tamagui-web.config'

/**
 * `.dialog.settings-dialog` — the compound selector widens the base `.dialog`: w-full plus raw
 * `max-width: min(96vw, 72rem)` and `max-height: 88vh`. This frame carries only that widening; it is
 * meant to compose over the base OverlayDialog chrome (overlays/dialog).
 */
export const SettingsDialogFrame = styled(View, {
  name: 'SettingsDialog',
  width: '100%',
  maxWidth: 'min(96vw, 72rem)',
  maxHeight: '88vh',
})

/**
 * `.settings-dialog__body` — flex! gap-6 min-h-0 (desktop base). Mobile (@media max-width:640px):
 * flex-col gap-3 — not representable without a max-width media prop (see file header).
 */
export const SettingsDialogBodyFrame = styled(View, {
  name: 'SettingsDialogBody',
  display: 'flex',
  gap: '$6',
  minHeight: 0,
})

/**
 * `.settings-dialog__tabs` — flex! flex-col gap-1 shrink-0 w-48 border-r border-border pr-3 (desktop
 * base). Mobile (@media max-width:640px): flex-row flex-wrap w-full border-r-0 border-b pr-0 pb-3 —
 * not representable without a max-width media prop (see file header).
 */
export const SettingsDialogTabsFrame = styled(View, {
  name: 'SettingsDialogTabs',
  display: 'flex',
  flexDirection: 'column',
  gap: '$1',
  flexShrink: 0,
  width: '$48',
  borderRightWidth: 1,
  borderRightColor: '$border',
  paddingRight: '$3',
})

/** `.settings-dialog__tab` — w-full flex! items-center gap-2 px-3 py-2 rounded-lg text-sm text-left
 * muted-fg + hover; `--active` (bg-muted text-foreground font-medium) boolean variant. */
export const SettingsDialogTabFrame = styled(View, {
  name: 'SettingsDialogTab',
  width: '100%',
  display: 'flex',
  alignItems: 'center',
  gap: '$2',
  paddingHorizontal: '$3',
  paddingVertical: '$2',
  borderRadius: '$radius-lg',
  fontSize: '$sm',
  textAlign: 'left',
  color: '$muted-foreground',
  cursor: 'pointer',
  // transition-colors awaits the animation driver (§5/P4)
  hoverStyle: { backgroundColor: 'color-mix(in srgb, var(--muted) 60%, transparent)', color: '$foreground' },

  variants: {
    active: {
      true: { backgroundColor: '$muted', color: '$foreground', fontWeight: '$medium' },
    },
  } as const,
})

/** `.settings-dialog__tab-icon` — w-4 h-4 shrink-0. */
export const SettingsDialogTabIconFrame = styled(View, {
  name: 'SettingsDialogTabIcon',
  width: '$4',
  height: '$4',
  flexShrink: 0,
})

/** `.settings-dialog__panel` — flex-1 min-w-0 overflow-y-auto pr-1 + raw max-height:74vh. */
export const SettingsDialogPanelFrame = styled(View, {
  name: 'SettingsDialogPanel',
  flexGrow: 1,
  flexShrink: 1,
  flexBasis: '0%',
  minWidth: 0,
  overflowY: 'auto',
  paddingRight: '$1',
  maxHeight: '74vh',
})

/** `.settings-dialog__section` — flex! flex-col gap-2. */
export const SettingsDialogSectionFrame = styled(View, {
  name: 'SettingsDialogSection',
  display: 'flex',
  flexDirection: 'column',
  gap: '$2',
})

export interface StyledSettingsDialogProps extends React.ComponentProps<'div'> {}

const Frame = SettingsDialogFrame as unknown as React.ComponentType<any>

/** Idiomatic SettingsDialog widening frame — composes over the base OverlayDialog chrome. */
export function StyledSettingsDialog({ ...props }: StyledSettingsDialogProps) {
  return <Frame {...props} />
}
