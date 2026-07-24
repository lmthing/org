/**
 * shell.styled.tsx — P2 conversion of the shell component CSS
 * (docs/tamagui-idiomatic-migration.md §4). Converts libs/css/src/components/shell/index.css — the
 * `.spaces-layout`, `.studios-layout`, `.settings-view` and `.studio-sidebar` BEM families — into
 * idiomatic Tamagui `styled()` frames. One exported `*Frame` per BEM selector; BEM `--modifier`s
 * become variants applied by the component. Frame names are `Shell`-prefixed and globally unique so
 * they never collide with the sibling StudioShell* proof.
 *
 * Lands alongside the shipped className shell; shell-styled.test.tsx pins a representative subset.
 * `transition: opacity 0.15s` on the studios create-card awaits the animation driver (§5/P4).
 */
import * as React from 'react'
import { styled, View, Text } from '../../theme/tamagui-web.config'

/* ── SpacesLayout ─────────────────────────────────────────────────── */

/** `.spaces-layout` — the h-100vh root. */
export const ShellSpacesLayoutFrame = styled(View, {
  name: 'ShellSpacesLayout',
  height: '100vh',
})

/** `.spaces-layout__sidebar-header` — zero-padded, bottom-bordered header. */
export const ShellSpacesSidebarHeaderFrame = styled(View, {
  name: 'ShellSpacesSidebarHeader',
  padding: '$0',
  borderBottomWidth: 1,
  borderBottomColor: '$border',
})

/** `.spaces-layout__sidebar-header-inner` — flex row, items-center, gap-0.5rem. */
export const ShellSpacesSidebarHeaderInnerFrame = styled(View, {
  name: 'ShellSpacesSidebarHeaderInner',
  display: 'flex',
  alignItems: 'center',
  gap: '$2',
})

/** `.spaces-layout__home-btn` — 3rem square centered button, no chrome. */
export const ShellSpacesHomeBtnFrame = styled(View, {
  name: 'ShellSpacesHomeBtn',
  tag: 'button',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: '$12',
  height: '$12',
  flexShrink: 0,
  backgroundColor: 'transparent',
  borderWidth: 0,
  cursor: 'pointer',
})

/** `.spaces-layout__sidebar-title` — text-sm, semibold. */
export const ShellSpacesSidebarTitleFrame = styled(Text, {
  name: 'ShellSpacesSidebarTitle',
  fontSize: '$sm',
  fontWeight: '$semibold',
})

/** `.spaces-layout__sidebar-search-section` — padded, bottom-bordered flex-col. */
export const ShellSpacesSidebarSearchSectionFrame = styled(View, {
  name: 'ShellSpacesSidebarSearchSection',
  padding: '$3',
  borderBottomWidth: 1,
  borderBottomColor: '$border',
  display: 'flex',
  flexDirection: 'column',
  gap: '$2',
})

/** `.spaces-layout__search-wrapper` — relative positioning context. */
export const ShellSpacesSearchWrapperFrame = styled(View, {
  name: 'ShellSpacesSearchWrapper',
  position: 'relative',
})

/** `.spaces-layout__search-icon` — absolute, vertically-centered 14px icon. */
export const ShellSpacesSearchIconFrame = styled(View, {
  name: 'ShellSpacesSearchIcon',
  position: 'absolute',
  left: '$2.5',
  top: '50%',
  transform: 'translateY(-50%)',
  width: 14,
  height: 14,
  opacity: 0.5,
})

/** `.spaces-layout__search-input` — left-padded for the icon. */
export const ShellSpacesSearchInputFrame = styled(View, {
  name: 'ShellSpacesSearchInput',
  paddingLeft: '$8',
})

/** `.spaces-layout__new-space-btn` — full-width dashed-border button. */
export const ShellSpacesNewSpaceBtnFrame = styled(View, {
  name: 'ShellSpacesNewSpaceBtn',
  width: '100%',
  borderWidth: 1,
  borderStyle: 'dashed',
  borderColor: '$border',
})

/** `.spaces-layout__icon-sm` — 14px icon. */
export const ShellSpacesIconSmFrame = styled(View, {
  name: 'ShellSpacesIconSm',
  width: 14,
  height: 14,
})

/** `.spaces-layout__sidebar-list` — flex-1 scroll region. */
export const ShellSpacesSidebarListFrame = styled(View, {
  name: 'ShellSpacesSidebarList',
  flexGrow: 1,
  flexShrink: 1,
  flexBasis: '0%',
  overflowY: 'auto',
  padding: '$3',
})

/** `.spaces-layout__space-btn` — full-width, left-aligned. */
export const ShellSpacesSpaceBtnFrame = styled(View, {
  name: 'ShellSpacesSpaceBtn',
  width: '100%',
  textAlign: 'left',
})

/** `.spaces-layout__space-icon-wrapper` — 1.5rem rounded centered square. */
export const ShellSpacesSpaceIconWrapperFrame = styled(View, {
  name: 'ShellSpacesSpaceIconWrapper',
  width: '$6',
  height: '$6',
  flexShrink: 0,
  borderRadius: '$radius-md',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
})

/** `.spaces-layout__space-name` — truncating flex-1 label. */
export const ShellSpacesSpaceNameFrame = styled(Text, {
  name: 'ShellSpacesSpaceName',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
  flexGrow: 1,
  flexShrink: 1,
  flexBasis: '0%',
})

/** `.spaces-layout__sidebar-footer` — padded, top-bordered footer. */
export const ShellSpacesSidebarFooterFrame = styled(View, {
  name: 'ShellSpacesSidebarFooter',
  padding: '$3',
  borderTopWidth: 1,
  borderTopColor: '$border',
})

/** `.spaces-layout__footer-btn` — full-width. */
export const ShellSpacesFooterBtnFrame = styled(View, {
  name: 'ShellSpacesFooterBtn',
  width: '100%',
})

/** `.spaces-layout__footer-label` — text-sm, medium. */
export const ShellSpacesFooterLabelFrame = styled(Text, {
  name: 'ShellSpacesFooterLabel',
  fontSize: '$sm',
  fontWeight: '$medium',
})

/** `.spaces-layout__github-icon` — 20px icon, no shrink. */
export const ShellSpacesGithubIconFrame = styled(View, {
  name: 'ShellSpacesGithubIcon',
  width: 20,
  height: 20,
  flexShrink: 0,
})

/** `.spaces-layout__collapse-icon` — 20px icon. */
export const ShellSpacesCollapseIconFrame = styled(View, {
  name: 'ShellSpacesCollapseIcon',
  width: 20,
  height: 20,
})

/** `.spaces-layout__detail` — max-w-4xl (56rem) detail column. */
export const ShellSpacesDetailFrame = styled(View, {
  name: 'ShellSpacesDetail',
  maxWidth: 896, // 56rem — no size token
})

/** `.spaces-layout__detail-header` — flex row, items-center, gap-1rem, mb-2rem. */
export const ShellSpacesDetailHeaderFrame = styled(View, {
  name: 'ShellSpacesDetailHeader',
  display: 'flex',
  alignItems: 'center',
  gap: '$4',
  marginBottom: '$8',
})

/** `.spaces-layout__detail-icon-wrapper` — 3.5rem rounded-2xl centered square. */
export const ShellSpacesDetailIconWrapperFrame = styled(View, {
  name: 'ShellSpacesDetailIconWrapper',
  width: '$14',
  height: '$14',
  borderRadius: 16, // 1rem (rounded-2xl) — no radius token
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
})

/** `.spaces-layout__detail-icon` — 1.75rem icon. */
export const ShellSpacesDetailIconFrame = styled(View, {
  name: 'ShellSpacesDetailIcon',
  width: '$7',
  height: '$7',
})

/** `.spaces-layout__detail-info` — flex-1. */
export const ShellSpacesDetailInfoFrame = styled(View, {
  name: 'ShellSpacesDetailInfo',
  flexGrow: 1,
  flexShrink: 1,
  flexBasis: '0%',
})

/** `.spaces-layout__grid-container` — max-w-2xl (42rem). */
export const ShellSpacesGridContainerFrame = styled(View, {
  name: 'ShellSpacesGridContainer',
  maxWidth: 672, // 42rem — no size token
})

/** `.spaces-layout__grid-caption` — mb-2rem. */
export const ShellSpacesGridCaptionFrame = styled(View, {
  name: 'ShellSpacesGridCaption',
  marginBottom: '$8',
})

/** `.spaces-layout__grid` — auto-fill CSS grid, gap-1rem. */
export const ShellSpacesGridFrame = styled(View, {
  name: 'ShellSpacesGrid',
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))',
  gap: '$4',
})

/** `.spaces-layout__grid-btn` — reset button rendered as a block. */
export const ShellSpacesGridBtnFrame = styled(View, {
  name: 'ShellSpacesGridBtn',
  tag: 'button',
  all: 'unset',
  cursor: 'pointer',
  display: 'block',
})

/** `.spaces-layout__grid-card` — p-1.25rem. */
export const ShellSpacesGridCardFrame = styled(View, {
  name: 'ShellSpacesGridCard',
  padding: '$5',
})

/** `.spaces-layout__grid-card-header` — flex row, items-center, gap-0.75rem, mb-0.75rem. */
export const ShellSpacesGridCardHeaderFrame = styled(View, {
  name: 'ShellSpacesGridCardHeader',
  display: 'flex',
  alignItems: 'center',
  gap: '$3',
  marginBottom: '$3',
})

/** `.spaces-layout__grid-icon-wrapper` — 2.5rem rounded-lg centered square. */
export const ShellSpacesGridIconWrapperFrame = styled(View, {
  name: 'ShellSpacesGridIconWrapper',
  width: '$10',
  height: '$10',
  borderRadius: '$radius-lg',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
})

/** `.spaces-layout__grid-icon` — 20px icon. */
export const ShellSpacesGridIconFrame = styled(View, {
  name: 'ShellSpacesGridIcon',
  width: 20,
  height: 20,
})

/** `.spaces-layout__grid-name` — semibold. */
export const ShellSpacesGridNameFrame = styled(Text, {
  name: 'ShellSpacesGridName',
  fontWeight: '$semibold',
})

/** `.spaces-layout__empty` — centered, py-5rem empty state. */
export const ShellSpacesEmptyFrame = styled(View, {
  name: 'ShellSpacesEmpty',
  textAlign: 'center',
  paddingVertical: '$20',
  paddingHorizontal: '$0',
})

/** `.spaces-layout__empty-icon` — 32px faded icon, centered, mb-1rem. */
export const ShellSpacesEmptyIconFrame = styled(View, {
  name: 'ShellSpacesEmptyIcon',
  width: 32,
  height: 32,
  opacity: 0.3,
  marginTop: '$0',
  marginHorizontal: 'auto',
  marginBottom: '$4',
})

/** `.spaces-layout__empty-create-btn` — mt-1.5rem. */
export const ShellSpacesEmptyCreateBtnFrame = styled(View, {
  name: 'ShellSpacesEmptyCreateBtn',
  marginTop: '$6',
})

/** `.spaces-layout__empty-create-icon` — 16px icon. */
export const ShellSpacesEmptyCreateIconFrame = styled(View, {
  name: 'ShellSpacesEmptyCreateIcon',
  width: 16,
  height: 16,
})

/** `.spaces-layout__modal-backdrop` — fixed full-screen scrim, centered. */
export const ShellSpacesModalBackdropFrame = styled(View, {
  name: 'ShellSpacesModalBackdrop',
  position: 'fixed',
  top: 0,
  right: 0,
  bottom: 0,
  left: 0,
  zIndex: 50,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  backgroundColor: 'rgba(0,0,0,0.5)', // half-opaque black scrim
})

/** `.spaces-layout__modal` — rounded-lg surface panel. */
export const ShellSpacesModalFrame = styled(View, {
  name: 'ShellSpacesModal',
  backgroundColor: '$background',
  borderRadius: '$radius-lg',
  padding: '$6',
  maxWidth: 448, // 28rem — no size token
  width: '100%',
  borderWidth: 1,
  borderColor: '$border',
})

/** `.spaces-layout__modal-title` — text-lg, semibold, mb-0.25rem. */
export const ShellSpacesModalTitleFrame = styled(Text, {
  name: 'ShellSpacesModalTitle',
  fontSize: '$lg',
  fontWeight: '$semibold',
  marginBottom: '$1',
})

/** `.spaces-layout__modal-desc` — text-sm, faded, mb-1rem. */
export const ShellSpacesModalDescFrame = styled(Text, {
  name: 'ShellSpacesModalDesc',
  fontSize: '$sm',
  opacity: 0.7,
  marginBottom: '$4',
})

/** `.spaces-layout__modal-fields` — flex-col, gap-0.75rem. */
export const ShellSpacesModalFieldsFrame = styled(View, {
  name: 'ShellSpacesModalFields',
  display: 'flex',
  flexDirection: 'column',
  gap: '$3',
})

/** `.spaces-layout__modal-actions` — flex row, justify-end, gap-0.5rem. */
export const ShellSpacesModalActionsFrame = styled(View, {
  name: 'ShellSpacesModalActions',
  display: 'flex',
  justifyContent: 'flex-end',
  gap: '$2',
})

/* ── StudiosLayout ────────────────────────────────────────────────── */

/** `.studios-layout` — min-h-screen background surface. */
export const ShellStudiosLayoutFrame = styled(View, {
  name: 'ShellStudiosLayout',
  minHeight: '100vh',
  backgroundColor: '$background',
})

/** `.studios-layout__topbar` — bottom-bordered flex row, py-1rem px-2rem, space-between. */
export const ShellStudiosTopbarFrame = styled(View, {
  name: 'ShellStudiosTopbar',
  borderBottomWidth: 1,
  borderBottomColor: '$border',
  paddingVertical: '$4',
  paddingHorizontal: '$8',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
})

/** `.studios-layout__topbar-left` — flex row, items-center, gap-0.75rem. */
export const ShellStudiosTopbarLeftFrame = styled(View, {
  name: 'ShellStudiosTopbarLeft',
  display: 'flex',
  alignItems: 'center',
  gap: '$3',
})

/** `.studios-layout__home-btn` — chromeless text-lg, semibold button. */
export const ShellStudiosHomeBtnFrame = styled(View, {
  name: 'ShellStudiosHomeBtn',
  tag: 'button',
  backgroundColor: 'transparent',
  borderWidth: 0,
  cursor: 'pointer',
  fontSize: '$lg',
  fontWeight: '$semibold',
})

/** `.studios-layout__breadcrumb-sep` — faded separator. */
export const ShellStudiosBreadcrumbSepFrame = styled(Text, {
  name: 'ShellStudiosBreadcrumbSep',
  opacity: 0.3,
})

/** `.studios-layout__username` — text-sm, medium. */
export const ShellStudiosUsernameFrame = styled(Text, {
  name: 'ShellStudiosUsername',
  fontSize: '$sm',
  fontWeight: '$medium',
})

/** `.studios-layout__topbar-right` — flex row, items-center, gap-0.5rem. */
export const ShellStudiosTopbarRightFrame = styled(View, {
  name: 'ShellStudiosTopbarRight',
  display: 'flex',
  alignItems: 'center',
  gap: '$2',
})

/** `.studios-layout__topbar-icon` — 16px icon. */
export const ShellStudiosTopbarIconFrame = styled(View, {
  name: 'ShellStudiosTopbarIcon',
  width: 16,
  height: 16,
})

/** `.studios-layout__content` — max-w-5xl (64rem), centered, p-2rem. */
export const ShellStudiosContentFrame = styled(View, {
  name: 'ShellStudiosContent',
  maxWidth: 1024, // 64rem — no size token
  marginVertical: '$0',
  marginHorizontal: 'auto',
  padding: '$8',
})

/** `.studios-layout__header-row` — flex row, items-center, space-between. */
export const ShellStudiosHeaderRowFrame = styled(View, {
  name: 'ShellStudiosHeaderRow',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
})

/** `.studios-layout__grid` — auto-fill CSS grid, gap-1rem, mt-1.5rem. */
export const ShellStudiosGridFrame = styled(View, {
  name: 'ShellStudiosGrid',
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
  gap: '$4',
  marginTop: '$6',
})

/** `.studios-layout__card` — p-1.5rem relative pointer card. */
export const ShellStudiosCardFrame = styled(View, {
  name: 'ShellStudiosCard',
  padding: '$6',
  cursor: 'pointer',
  position: 'relative',
})

/** `.studios-layout__card-header` — flex row, items-start, space-between. */
export const ShellStudiosCardHeaderFrame = styled(View, {
  name: 'ShellStudiosCardHeader',
  display: 'flex',
  alignItems: 'flex-start',
  justifyContent: 'space-between',
})

/** `.studios-layout__card-icon-wrapper` — 3rem rounded-xl centered square, mb-1rem. */
export const ShellStudiosCardIconWrapperFrame = styled(View, {
  name: 'ShellStudiosCardIconWrapper',
  width: '$12',
  height: '$12',
  borderRadius: '$radius-xl',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  marginBottom: '$4',
})

/** `.studios-layout__card-icon` — 24px icon. */
export const ShellStudiosCardIconFrame = styled(View, {
  name: 'ShellStudiosCardIcon',
  width: 24,
  height: 24,
})

/** `.studios-layout__card-delete-btn` — half-opacity action. */
export const ShellStudiosCardDeleteBtnFrame = styled(View, {
  name: 'ShellStudiosCardDeleteBtn',
  opacity: 0.5,
})

/** `.studios-layout__card-delete-icon` — 14px icon. */
export const ShellStudiosCardDeleteIconFrame = styled(View, {
  name: 'ShellStudiosCardDeleteIcon',
  width: 14,
  height: 14,
})

/** `.studios-layout__card-id` — mt-0.25rem. */
export const ShellStudiosCardIdFrame = styled(Text, {
  name: 'ShellStudiosCardId',
  marginTop: '$1',
})

/** `.studios-layout__card-arrow` — flex row, items-center, justify-end, mt-1rem, faded. */
export const ShellStudiosCardArrowFrame = styled(View, {
  name: 'ShellStudiosCardArrow',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'flex-end',
  marginTop: '$4',
  opacity: 0.5,
})

/** `.studios-layout__card-arrow-icon` — 16px icon. */
export const ShellStudiosCardArrowIconFrame = styled(View, {
  name: 'ShellStudiosCardArrowIcon',
  width: 16,
  height: 16,
})

/**
 * `.studios-layout__create-card` — reset dashed-border centered add-card.
 * `transition: opacity 0.15s` awaits the animation driver (§5/P4). Hover → full opacity.
 */
export const ShellStudiosCreateCardFrame = styled(View, {
  name: 'ShellStudiosCreateCard',
  tag: 'button',
  all: 'unset',
  cursor: 'pointer',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  minHeight: '$40',
  borderRadius: '$radius-xl',
  borderWidth: 2,
  borderStyle: 'dashed',
  borderColor: '$border',
  opacity: 0.6,
  hoverStyle: { opacity: 1 },
})

/** `.studios-layout__create-card-inner` — centered content. */
export const ShellStudiosCreateCardInnerFrame = styled(View, {
  name: 'ShellStudiosCreateCardInner',
  textAlign: 'center',
})

/** `.studios-layout__create-card-icon` — 24px icon, centered, mb-0.5rem. */
export const ShellStudiosCreateCardIconFrame = styled(View, {
  name: 'ShellStudiosCreateCardIcon',
  width: 24,
  height: 24,
  marginTop: '$0',
  marginHorizontal: 'auto',
  marginBottom: '$2',
})

/** `.studios-layout__empty` — centered, py-5rem empty state. */
export const ShellStudiosEmptyFrame = styled(View, {
  name: 'ShellStudiosEmpty',
  textAlign: 'center',
  paddingVertical: '$20',
  paddingHorizontal: '$0',
})

/** `.studios-layout__empty-icon` — 48px faded icon, centered, mb-1.5rem. */
export const ShellStudiosEmptyIconFrame = styled(View, {
  name: 'ShellStudiosEmptyIcon',
  width: 48,
  height: 48,
  opacity: 0.2,
  marginTop: '$0',
  marginHorizontal: 'auto',
  marginBottom: '$6',
})

/** `.studios-layout__empty-caption` — mt-0.5rem, max-w-sm, horizontally centered. */
export const ShellStudiosEmptyCaptionFrame = styled(Text, {
  name: 'ShellStudiosEmptyCaption',
  marginTop: '$2',
  maxWidth: 384, // 24rem — no size token
  marginLeft: 'auto',
  marginRight: 'auto',
})

/** `.studios-layout__empty-create-btn` — mt-1.5rem. */
export const ShellStudiosEmptyCreateBtnFrame = styled(View, {
  name: 'ShellStudiosEmptyCreateBtn',
  marginTop: '$6',
})

/** `.studios-layout__empty-create-icon` — 16px icon. */
export const ShellStudiosEmptyCreateIconFrame = styled(View, {
  name: 'ShellStudiosEmptyCreateIcon',
  width: 16,
  height: 16,
})

/** `.studios-layout__modal-backdrop` — fixed full-screen scrim, centered. */
export const ShellStudiosModalBackdropFrame = styled(View, {
  name: 'ShellStudiosModalBackdrop',
  position: 'fixed',
  top: 0,
  right: 0,
  bottom: 0,
  left: 0,
  zIndex: 50,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  backgroundColor: 'rgba(0,0,0,0.5)', // half-opaque black scrim
})

/**
 * `.studios-layout__modal` — rounded-xl surface panel + the `--sm` modifier (max-w-sm).
 */
export const ShellStudiosModalFrame = styled(View, {
  name: 'ShellStudiosModal',
  backgroundColor: '$background',
  borderRadius: '$radius-xl',
  padding: '$6',
  maxWidth: 448, // 28rem — no size token
  width: '100%',
  borderWidth: 1,
  borderColor: '$border',

  variants: {
    size: {
      sm: { maxWidth: 384 }, // .studios-layout__modal--sm = max-w-sm (24rem)
    },
  } as const,
})

/** `.studios-layout__modal-title` — text-lg, semibold, mb-0.25rem. */
export const ShellStudiosModalTitleFrame = styled(Text, {
  name: 'ShellStudiosModalTitle',
  fontSize: '$lg',
  fontWeight: '$semibold',
  marginBottom: '$1',
})

/**
 * `.studios-layout__modal-desc` — text-sm faded, mb-1rem + the `--lg` modifier (mb-1.5rem).
 */
export const ShellStudiosModalDescFrame = styled(Text, {
  name: 'ShellStudiosModalDesc',
  fontSize: '$sm',
  opacity: 0.7,
  marginBottom: '$4',

  variants: {
    lg: {
      true: { marginBottom: '$6' }, // .studios-layout__modal-desc--lg
    },
  } as const,
})

/** `.studios-layout__modal-fields` — flex-col, gap-0.75rem. */
export const ShellStudiosModalFieldsFrame = styled(View, {
  name: 'ShellStudiosModalFields',
  display: 'flex',
  flexDirection: 'column',
  gap: '$3',
})

/** `.studios-layout__modal-actions` — flex row, justify-end, gap-0.5rem. */
export const ShellStudiosModalActionsFrame = styled(View, {
  name: 'ShellStudiosModalActions',
  display: 'flex',
  justifyContent: 'flex-end',
  gap: '$2',
})

/** `.studios-layout__delete-btn` — destructive surface, literal-white text. */
export const ShellStudiosDeleteBtnFrame = styled(View, {
  name: 'ShellStudiosDeleteBtn',
  backgroundColor: '$destructive',
  color: 'white', // literal `color: white`, theme-independent (not $destructive-foreground)
})

/* ── SettingsView ─────────────────────────────────────────────────── */

/** `.settings-view__header` — full-width flex row, space-between, items-center. */
export const ShellSettingsHeaderFrame = styled(View, {
  name: 'ShellSettingsHeader',
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  width: '100%',
})

/** `.settings-view__tabs` — bottom-bordered flex row of tabs, px-1.5rem, gap-0.25rem. */
export const ShellSettingsTabsFrame = styled(View, {
  name: 'ShellSettingsTabs',
  display: 'flex',
  gap: '$1',
  paddingVertical: '$0',
  paddingHorizontal: '$6',
  borderBottomWidth: 1,
  borderBottomColor: '$border',
})

/**
 * `.settings-view__tab` — square-cornered tab + `--active`/`--inactive` modifiers as a `state`
 * variant (the underline + primary color the active tab carries).
 */
export const ShellSettingsTabFrame = styled(View, {
  name: 'ShellSettingsTab',
  borderRadius: '$0',

  variants: {
    state: {
      active: {
        borderBottomWidth: 2,
        borderBottomColor: '$primary',
        color: '$primary',
      },
      inactive: {
        borderBottomWidth: 2,
        borderBottomColor: 'transparent',
      },
    },
  } as const,
})

/** `.settings-view__tab-icon` — 16px icon. */
export const ShellSettingsTabIconFrame = styled(View, {
  name: 'ShellSettingsTabIcon',
  width: 16,
  height: 16,
})

/**
 * `.settings-view__panel-container` — max-w-5xl centered panel + `--env` modifier (mb-1rem).
 */
export const ShellSettingsPanelContainerFrame = styled(View, {
  name: 'ShellSettingsPanelContainer',
  maxWidth: 1024, // 64rem — no size token
  marginTop: '$0',
  marginBottom: '$0',
  marginHorizontal: 'auto',

  variants: {
    env: {
      true: { marginBottom: '$4' }, // .settings-view__panel-container--env
    },
  } as const,
})

/** `.settings-view__env-grid` — two-column CSS grid, gap-0.75rem, mb-1rem. */
export const ShellSettingsEnvGridFrame = styled(View, {
  name: 'ShellSettingsEnvGrid',
  display: 'grid',
  gridTemplateColumns: '1fr 1fr',
  gap: '$3',
  marginBottom: '$4',
})

/** `.settings-view__env-label` — block text-xs, medium, mb-0.25rem. */
export const ShellSettingsEnvLabelFrame = styled(Text, {
  name: 'ShellSettingsEnvLabel',
  display: 'block',
  fontSize: '$xs',
  fontWeight: '$medium',
  marginBottom: '$1',
})

/** `.settings-view__env-textarea` — 16rem tall monospace, vertically resizable. */
export const ShellSettingsEnvTextareaFrame = styled(View, {
  name: 'ShellSettingsEnvTextarea',
  tag: 'textarea',
  height: '$64',
  fontFamily: 'monospace',
  resize: 'vertical',
})

/** `.settings-view__env-actions` — flex row, gap-0.5rem, mt-0.75rem. */
export const ShellSettingsEnvActionsFrame = styled(View, {
  name: 'ShellSettingsEnvActions',
  display: 'flex',
  gap: '$2',
  marginTop: '$3',
})

/**
 * `.settings-view__status` — mt-0.5rem status line + `--error`/`--success` modifiers (there is no
 * bare `.settings-view__status`; the shared `mt-0.5rem` lives on the base, tone on the variant).
 */
export const ShellSettingsStatusFrame = styled(Text, {
  name: 'ShellSettingsStatus',
  marginTop: '$2',

  variants: {
    status: {
      error: { color: '$destructive' }, // .settings-view__status--error
      success: { color: '$success' }, // .settings-view__status--success
    },
  } as const,
})

/** `.settings-view__pkg-caption` — mb-0.75rem. */
export const ShellSettingsPkgCaptionFrame = styled(Text, {
  name: 'ShellSettingsPkgCaption',
  marginBottom: '$3',
})

/** `.settings-view__pkg-textarea` — min-h-200px monospace, vertically resizable. */
export const ShellSettingsPkgTextareaFrame = styled(View, {
  name: 'ShellSettingsPkgTextarea',
  tag: 'textarea',
  minHeight: 200,
  fontFamily: 'monospace',
  resize: 'vertical',
})

/** `.settings-view__pkg-footer` — flex row, space-between, items-center, mt-0.75rem. */
export const ShellSettingsPkgFooterFrame = styled(View, {
  name: 'ShellSettingsPkgFooter',
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  marginTop: '$3',
})

/** `.settings-view__pkg-error` — destructive text. */
export const ShellSettingsPkgErrorFrame = styled(Text, {
  name: 'ShellSettingsPkgError',
  color: '$destructive',
})

/* ── StudioSidebar ────────────────────────────────────────────────── */

/** `.studio-sidebar__header` — zero-padded, bottom-bordered header. */
export const ShellSidebarHeaderFrame = styled(View, {
  name: 'ShellSidebarHeader',
  padding: '$0',
  borderBottomWidth: 1,
  borderBottomColor: '$border',
})

/** `.studio-sidebar__header-inner` — flex row, items-center, gap-2rem, pl-0.75rem. */
export const ShellSidebarHeaderInnerFrame = styled(View, {
  name: 'ShellSidebarHeaderInner',
  display: 'flex',
  alignItems: 'center',
  gap: '$8',
  paddingLeft: '$3',
})

/** `.studio-sidebar__home-link` — 3rem square centered link. */
export const ShellSidebarHomeLinkFrame = styled(View, {
  name: 'ShellSidebarHomeLink',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: '$12',
  height: '$12',
  flexShrink: 0,
})

/** `.studio-sidebar__space-name` — text-sm semibold truncating flex-1 label. */
export const ShellSidebarSpaceNameFrame = styled(Text, {
  name: 'ShellSidebarSpaceName',
  fontSize: '$sm',
  fontWeight: '$semibold',
  flexGrow: 1,
  flexShrink: 1,
  flexBasis: '0%',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
})

/** `.studio-sidebar__body` — flex-1 scroll region, p-0.75rem with pt-2rem. */
export const ShellSidebarBodyFrame = styled(View, {
  name: 'ShellSidebarBody',
  flexGrow: 1,
  flexShrink: 1,
  flexBasis: '0%',
  overflowY: 'auto',
  overflowX: 'hidden',
  padding: '$3',
  paddingTop: '$8',
})

/** `.studio-sidebar__sections` — flex-col, gap-1.5rem. */
export const ShellSidebarSectionsFrame = styled(View, {
  name: 'ShellSidebarSections',
  display: 'flex',
  flexDirection: 'column',
  gap: '$6',
})

/** `.studio-sidebar__section-header` — 10px uppercase semibold, wide tracking, faded. */
export const ShellSidebarSectionHeaderFrame = styled(Text, {
  name: 'ShellSidebarSectionHeader',
  fontSize: 10, // 0.625rem — no fontSize token
  fontWeight: '$semibold',
  textTransform: 'uppercase',
  letterSpacing: '$wider', // 0.05em
  opacity: 0.7,
})

/** `.studio-sidebar__section-chevron` — 12px chevron. */
export const ShellSidebarSectionChevronFrame = styled(View, {
  name: 'ShellSidebarSectionChevron',
  width: 12,
  height: 12,
})

/** `.studio-sidebar__section-items` — flex-col, gap-2px. */
export const ShellSidebarSectionItemsFrame = styled(View, {
  name: 'ShellSidebarSectionItems',
  display: 'flex',
  flexDirection: 'column',
  gap: 2, // 2px — no space token
})

/**
 * `.studio-sidebar__item-icon` — 16px no-shrink icon + the `--knowledge`/`--assistant` tone
 * modifiers as a `kind` variant (there is no bare `.studio-sidebar__item-icon`).
 */
export const ShellSidebarItemIconFrame = styled(View, {
  name: 'ShellSidebarItemIcon',
  width: 16,
  height: 16,
  flexShrink: 0,

  variants: {
    kind: {
      knowledge: { color: '$knowledge' }, // .studio-sidebar__item-icon--knowledge
      assistant: { color: '$agent' }, // .studio-sidebar__item-icon--assistant
    },
  } as const,
})

/** `.studio-sidebar__item-label` — truncating label. */
export const ShellSidebarItemLabelFrame = styled(Text, {
  name: 'ShellSidebarItemLabel',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
})

/** `.studio-sidebar__create-btn` — faded create action. */
export const ShellSidebarCreateBtnFrame = styled(View, {
  name: 'ShellSidebarCreateBtn',
  opacity: 0.6,
})

/** `.studio-sidebar__create-icon` — 16px no-shrink icon. */
export const ShellSidebarCreateIconFrame = styled(View, {
  name: 'ShellSidebarCreateIcon',
  width: 16,
  height: 16,
  flexShrink: 0,
})

/** `.studio-sidebar__create-label` — medium. */
export const ShellSidebarCreateLabelFrame = styled(Text, {
  name: 'ShellSidebarCreateLabel',
  fontWeight: '$medium',
})

/** `.studio-sidebar__conversations-empty` — faded text-xs default-cursor placeholder. */
export const ShellSidebarConversationsEmptyFrame = styled(Text, {
  name: 'ShellSidebarConversationsEmpty',
  opacity: 0.5,
  fontSize: '$xs',
  cursor: 'default',
})

/** `.studio-sidebar__collapsed-icons` — flex-col, items-center, gap-1rem. */
export const ShellSidebarCollapsedIconsFrame = styled(View, {
  name: 'ShellSidebarCollapsedIcons',
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  gap: '$4',
})

/** `.studio-sidebar__collapsed-icon` — centered content. */
export const ShellSidebarCollapsedIconFrame = styled(View, {
  name: 'ShellSidebarCollapsedIcon',
  justifyContent: 'center',
})

/** `.studio-sidebar__collapsed-icon-inner` — 20px icon. */
export const ShellSidebarCollapsedIconInnerFrame = styled(View, {
  name: 'ShellSidebarCollapsedIconInner',
  width: 20,
  height: 20,
})

/** `.studio-sidebar__footer` — padded, top-bordered footer. */
export const ShellSidebarFooterFrame = styled(View, {
  name: 'ShellSidebarFooter',
  padding: '$3',
  borderTopWidth: 1,
  borderTopColor: '$border',
})

/** `.studio-sidebar__footer-items` — flex-col, gap-0.25rem. */
export const ShellSidebarFooterItemsFrame = styled(View, {
  name: 'ShellSidebarFooterItems',
  display: 'flex',
  flexDirection: 'column',
  gap: '$1',
})

/** `.studio-sidebar__footer-icon` — 20px no-shrink icon. */
export const ShellSidebarFooterIconFrame = styled(View, {
  name: 'ShellSidebarFooterIcon',
  width: 20,
  height: 20,
  flexShrink: 0,
})

/** `.studio-sidebar__footer-label` — text-sm, medium. */
export const ShellSidebarFooterLabelFrame = styled(Text, {
  name: 'ShellSidebarFooterLabel',
  fontSize: '$sm',
  fontWeight: '$medium',
})

/** `.studio-sidebar__device-code` — bordered rounded device-code callout. */
export const ShellSidebarDeviceCodeFrame = styled(View, {
  name: 'ShellSidebarDeviceCode',
  marginVertical: '$1',
  marginHorizontal: '$3',
  padding: '$2.5',
  borderRadius: '$radius-md',
  borderWidth: 1,
  borderColor: '$border',
  fontSize: '$xs',
})

/** `.studio-sidebar__device-code a` — semibold underlined link (descendant selector). */
export const ShellSidebarDeviceCodeLinkFrame = styled(Text, {
  name: 'ShellSidebarDeviceCodeLink',
  tag: 'a',
  fontWeight: '$semibold',
  textDecorationLine: 'underline',
})

/** `.studio-sidebar__device-code code` — widest-tracked code (descendant selector). */
export const ShellSidebarDeviceCodeCodeFrame = styled(Text, {
  name: 'ShellSidebarDeviceCodeCode',
  tag: 'code',
  letterSpacing: '$widest', // 0.1em
})

/** `.studio-sidebar__device-code p` — mt-0.25rem paragraph (descendant selector). */
export const ShellSidebarDeviceCodeTextFrame = styled(Text, {
  name: 'ShellSidebarDeviceCodeText',
  tag: 'p',
  marginTop: '$1',
})

/* ── Styled wrappers (representative subset; every frame is exported above) ── */

export interface StyledShellSpacesLayoutProps extends React.ComponentProps<'div'> {}
export interface StyledShellStudiosModalProps extends React.ComponentProps<'div'> {
  size?: 'sm'
}
export interface StyledShellSettingsTabProps extends React.ComponentProps<'div'> {
  state?: 'active' | 'inactive'
}
export interface StyledShellSettingsStatusProps extends React.ComponentProps<'span'> {
  status?: 'error' | 'success'
}
export interface StyledShellSidebarItemIconProps extends React.ComponentProps<'div'> {
  kind?: 'knowledge' | 'assistant'
}

const SpacesLayout = ShellSpacesLayoutFrame as unknown as React.ComponentType<any>
const StudiosModal = ShellStudiosModalFrame as unknown as React.ComponentType<any>
const SettingsTab = ShellSettingsTabFrame as unknown as React.ComponentType<any>
const SettingsStatus = ShellSettingsStatusFrame as unknown as React.ComponentType<any>
const SidebarItemIcon = ShellSidebarItemIconFrame as unknown as React.ComponentType<any>

/** Idiomatic SpacesLayout root frame. */
export function StyledShellSpacesLayout(props: StyledShellSpacesLayoutProps) {
  return <SpacesLayout {...props} />
}
/** Idiomatic StudiosLayout modal — carries the `size="sm"` modifier. */
export function StyledShellStudiosModal({ size, ...props }: StyledShellStudiosModalProps) {
  return <StudiosModal size={size} {...props} />
}
/** Idiomatic SettingsView tab — carries the active/inactive `state` modifier. */
export function StyledShellSettingsTab({ state, ...props }: StyledShellSettingsTabProps) {
  return <SettingsTab state={state} {...props} />
}
/** Idiomatic SettingsView status line — carries the error/success `status` modifier. */
export function StyledShellSettingsStatus({ status, ...props }: StyledShellSettingsStatusProps) {
  return <SettingsStatus status={status} {...props} />
}
/** Idiomatic StudioSidebar item icon — carries the knowledge/assistant `kind` modifier. */
export function StyledShellSidebarItemIcon({ kind, ...props }: StyledShellSidebarItemIconProps) {
  return <SidebarItemIcon kind={kind} {...props} />
}
