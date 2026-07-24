/** space.styled.tsx — P2 conversion of libs/css/src/components/space/index.css (docs §4).
 *  One styled() frame per BEM selector; modifiers → variants. Covers the SpaceList, InviteDialog,
 *  SpaceSelector, UserDetailPanel and ConfirmDialog BEM blocks. Every `name:` is globally unique,
 *  prefixed `Space`. Lands alongside the shipped className components; space-styled.test.tsx pins
 *  the load-bearing frames. `white`/`black` are theme-independent literal keywords (not hex/rgb),
 *  used only where the source CSS uses the raw keyword. */
import * as React from 'react'
import { styled, View, Text } from '../../theme/tamagui-web.config'

/* ── SpaceList ────────────────────────────────────────────────────── */

/** `.space-list__search-wrapper` — relative, mt-4 (1rem). */
export const SpaceListSearchWrapperFrame = styled(View, {
  name: 'SpaceListSearchWrapper',
  position: 'relative',
  marginTop: '$4',
})

/** `.space-list__header` — flex, justify-between, items-center. */
export const SpaceListHeaderFrame = styled(View, {
  name: 'SpaceListHeader',
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
})

/** `.space-list__invite-icon` — w-4 h-4 (1rem). */
export const SpaceListInviteIconFrame = styled(View, {
  name: 'SpaceListInviteIcon',
  width: '$4',
  height: '$4',
})

/** `.space-list__search-icon` — w-4 h-4, absolute left-3, top 50% translateY(-50%), text-muted. */
export const SpaceListSearchIconFrame = styled(View, {
  name: 'SpaceListSearchIcon',
  width: '$4',
  height: '$4',
  position: 'absolute',
  left: '$3',
  top: '50%',
  transform: 'translateY(-50%)',
  color: '$muted',
})

/** `.space-list__search-input` — pl-9 (2.25rem). */
export const SpaceListSearchInputFrame = styled(View, {
  name: 'SpaceListSearchInput',
  paddingLeft: '$9',
})

/** `.space-list__body` — flex-1, overflow-y auto. */
export const SpaceListBodyFrame = styled(View, {
  name: 'SpaceListBody',
  flexGrow: 1,
  flexShrink: 1,
  flexBasis: '0%',
  overflowY: 'auto',
})

/** `.space-list__empty` — flex col, items/justify center, h-48 (12rem). */
export const SpaceListEmptyFrame = styled(View, {
  name: 'SpaceListEmpty',
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  height: '$48',
})

/** `.space-list__empty-icon` — w-10 h-10 (2.5rem), opacity 0.5. */
export const SpaceListEmptyIconFrame = styled(View, {
  name: 'SpaceListEmptyIcon',
  width: '$10',
  height: '$10',
  opacity: 0.5,
})

/** `.space-list__user-list` — p-2 (0.5rem). */
export const SpaceListUserListFrame = styled(View, {
  name: 'SpaceListUserList',
  padding: '$2',
})

/** `.space-list__user-btn` — cursor pointer, block, w-full (`all: unset` reset omitted, no prop). */
export const SpaceListUserBtnFrame = styled(View, {
  name: 'SpaceListUserBtn',
  tag: 'button',
  cursor: 'pointer',
  display: 'block',
  width: '100%',
})

/** `.space-list__avatar-wrapper` — relative, shrink-0. */
export const SpaceListAvatarWrapperFrame = styled(View, {
  name: 'SpaceListAvatarWrapper',
  position: 'relative',
  flexShrink: 0,
})

/** `.space-list__avatar-fallback` — agent gradient, white text, semibold. */
export const SpaceListAvatarFallbackFrame = styled(View, {
  name: 'SpaceListAvatarFallback',
  backgroundImage: 'linear-gradient(135deg, var(--agent), color-mix(in srgb, var(--agent) 80%, black))',
  color: 'white',
  fontWeight: '$semibold',
})

/** `.space-list__status-dot` — absolute bottom/right -2px, w-3.5 h-3.5, rounded-full, 2px white border.
 *  `--active`/`--invited`/`--pending` → the `status` variant. */
export const SpaceListStatusDotFrame = styled(View, {
  name: 'SpaceListStatusDot',
  position: 'absolute',
  bottom: -2,
  right: -2,
  width: '$3.5',
  height: '$3.5',
  borderRadius: '$radius-full',
  borderWidth: 2,
  borderStyle: 'solid',
  borderColor: 'white',

  variants: {
    status: {
      active: { backgroundColor: '$brand-2' },
      invited: { backgroundColor: '$brand-2' },
      pending: { backgroundColor: '$neutral' },
    },
  } as const,
})

/** `.space-list__role-badge` — text-[10px], py-0.5 px-1.5 (0.125rem 0.375rem).
 *  `--admin`/`--editor`/`--viewer` → the `role` variant (alphas via web color-mix). */
export const SpaceListRoleBadgeFrame = styled(Text, {
  name: 'SpaceListRoleBadge',
  fontSize: 10,
  paddingVertical: '$0.5',
  paddingHorizontal: '$1.5',

  variants: {
    role: {
      admin: {
        color: '$brand-3',
        backgroundColor: 'color-mix(in srgb, var(--brand-3) 10%, transparent)',
        borderColor: 'color-mix(in srgb, var(--brand-3) 30%, transparent)',
      },
      editor: {
        color: '$brand-2',
        backgroundColor: 'color-mix(in srgb, var(--brand-2) 10%, transparent)',
        borderColor: 'color-mix(in srgb, var(--brand-2) 30%, transparent)',
      },
      viewer: {
        color: '$muted-foreground',
        backgroundColor: '$muted',
        borderColor: '$border',
      },
    },
  } as const,
})

/** `.space-list__user-info` — flex-1, min-w-0, text-left. */
export const SpaceListUserInfoFrame = styled(View, {
  name: 'SpaceListUserInfo',
  flexGrow: 1,
  flexShrink: 1,
  flexBasis: '0%',
  minWidth: 0,
  textAlign: 'left',
})

/** `.space-list__user-name` — medium, truncate. */
export const SpaceListUserNameFrame = styled(Text, {
  name: 'SpaceListUserName',
  fontWeight: '$medium',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
})

/** `.space-list__user-name-row` — flex, items-center, gap-1. */
export const SpaceListUserNameRowFrame = styled(View, {
  name: 'SpaceListUserNameRow',
  display: 'flex',
  alignItems: 'center',
  gap: '$1',
})

/** `.space-list__email-row` — flex, items-center, gap-1, mt-0.5 (0.125rem). */
export const SpaceListEmailRowFrame = styled(View, {
  name: 'SpaceListEmailRow',
  display: 'flex',
  alignItems: 'center',
  gap: '$1',
  marginTop: '$0.5',
})

/** `.space-list__email` — truncate. */
export const SpaceListEmailFrame = styled(Text, {
  name: 'SpaceListEmail',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
})

/** `.space-list__email-icon` — w-3 h-3, shrink-0, opacity 0.5. */
export const SpaceListEmailIconFrame = styled(View, {
  name: 'SpaceListEmailIcon',
  width: '$3',
  height: '$3',
  flexShrink: 0,
  opacity: 0.5,
})

/** `.space-list__last-active-icon` — w-3 h-3. */
export const SpaceListLastActiveIconFrame = styled(View, {
  name: 'SpaceListLastActiveIcon',
  width: '$3',
  height: '$3',
})

/** `.space-list__status-col` — flex col, items-end, gap-1. */
export const SpaceListStatusColFrame = styled(View, {
  name: 'SpaceListStatusCol',
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'flex-end',
  gap: '$1',
})

/** `.space-list__status-badge` — text-[10px]. */
export const SpaceListStatusBadgeFrame = styled(Text, {
  name: 'SpaceListStatusBadge',
  fontSize: 10,
})

/** `.space-list__last-active` — flex, items-center, gap-1, text-[11px]. */
export const SpaceListLastActiveFrame = styled(View, {
  name: 'SpaceListLastActive',
  display: 'flex',
  alignItems: 'center',
  gap: '$1',
  fontSize: 11,
})

/* ── InviteDialog ────────────────────────────────────────────────── */

/** `.space-list__invite-dialog` — max-w-[448px] (28rem). */
export const SpaceListInviteDialogFrame = styled(View, {
  name: 'SpaceListInviteDialog',
  maxWidth: 448,
})

/** `.space-list__invite-form-body` — p-6 (1.5rem). */
export const SpaceListInviteFormBodyFrame = styled(View, {
  name: 'SpaceListInviteFormBody',
  padding: '$6',
})

/** `.space-list__invite-role-item` — cursor pointer. */
export const SpaceListInviteRoleItemFrame = styled(View, {
  name: 'SpaceListInviteRoleItem',
  cursor: 'pointer',
})

/** `.space-list__invite-role-radio` — mr-3 (0.75rem). */
export const SpaceListInviteRoleRadioFrame = styled(View, {
  name: 'SpaceListInviteRoleRadio',
  marginRight: '$3',
})

/** `.space-list__invite-actions` — pt-2 (0.5rem). */
export const SpaceListInviteActionsFrame = styled(View, {
  name: 'SpaceListInviteActions',
  paddingTop: '$2',
})

/** `.space-list__invite-action-btn` — flex-1. */
export const SpaceListInviteActionBtnFrame = styled(View, {
  name: 'SpaceListInviteActionBtn',
  flexGrow: 1,
  flexShrink: 1,
  flexBasis: '0%',
})

/* ── SpaceSelector ────────────────────────────────────────────────── */

/** `.space-selector` — relative. */
export const SpaceSelectorFrame = styled(View, {
  name: 'SpaceSelector',
  position: 'relative',
})

/** `.space-selector__trigger` — w-full, justify-between. */
export const SpaceSelectorTriggerFrame = styled(View, {
  name: 'SpaceSelectorTrigger',
  width: '100%',
  justifyContent: 'space-between',
})

/** `.space-selector__trigger-label` — truncate. */
export const SpaceSelectorTriggerLabelFrame = styled(Text, {
  name: 'SpaceSelectorTriggerLabel',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
})

/** `.space-selector__chevron` — w-4 h-4, shrink-0, opacity 0.5. */
export const SpaceSelectorChevronFrame = styled(View, {
  name: 'SpaceSelectorChevron',
  width: '$4',
  height: '$4',
  flexShrink: 0,
  opacity: 0.5,
})

/** `.space-selector__dropdown` — absolute top-full left/right-0, z-50, mt-1 (0.25rem). */
export const SpaceSelectorDropdownFrame = styled(View, {
  name: 'SpaceSelectorDropdown',
  position: 'absolute',
  top: '100%',
  left: 0,
  right: 0,
  zIndex: 50,
  marginTop: '$1',
})

/** `.space-selector__search-section` — p-2, border-b border. */
export const SpaceSelectorSearchSectionFrame = styled(View, {
  name: 'SpaceSelectorSearchSection',
  padding: '$2',
  borderBottomWidth: 1,
  borderBottomColor: '$border',
})

/** `.space-selector__search-wrapper` — relative. */
export const SpaceSelectorSearchWrapperFrame = styled(View, {
  name: 'SpaceSelectorSearchWrapper',
  position: 'relative',
})

/** `.space-selector__search-icon` — w-4 h-4, absolute left-2, top 50% translateY(-50%), opacity 0.5. */
export const SpaceSelectorSearchIconFrame = styled(View, {
  name: 'SpaceSelectorSearchIcon',
  width: '$4',
  height: '$4',
  position: 'absolute',
  left: '$2',
  top: '50%',
  transform: 'translateY(-50%)',
  opacity: 0.5,
})

/** `.space-selector__search-input` — pl-8 (2rem). */
export const SpaceSelectorSearchInputFrame = styled(View, {
  name: 'SpaceSelectorSearchInput',
  paddingLeft: '$8',
})

/** `.space-selector__list` — max-h-64 (16rem), overflow-y auto. */
export const SpaceSelectorListFrame = styled(View, {
  name: 'SpaceSelectorList',
  maxHeight: '$64',
  overflowY: 'auto',
})

/** `.space-selector__empty` — p-4, text-center, block. */
export const SpaceSelectorEmptyFrame = styled(Text, {
  name: 'SpaceSelectorEmpty',
  padding: '$4',
  textAlign: 'center',
  display: 'block',
})

/** `.space-selector__item` — w-full, text-left. */
export const SpaceSelectorItemFrame = styled(View, {
  name: 'SpaceSelectorItem',
  width: '100%',
  textAlign: 'left',
})

/** `.space-selector__item-icon` — w-4 h-4, shrink-0, opacity 0.6. */
export const SpaceSelectorItemIconFrame = styled(View, {
  name: 'SpaceSelectorItemIcon',
  width: '$4',
  height: '$4',
  flexShrink: 0,
  opacity: 0.6,
})

/** `.space-selector__new-icon` — w-4 h-4. */
export const SpaceSelectorNewIconFrame = styled(View, {
  name: 'SpaceSelectorNewIcon',
  width: '$4',
  height: '$4',
})

/** `.space-selector__avatar` — w-4 h-4, rounded-full, shrink-0. */
export const SpaceSelectorAvatarFrame = styled(View, {
  name: 'SpaceSelectorAvatar',
  width: '$4',
  height: '$4',
  borderRadius: '$radius-full',
  flexShrink: 0,
})

/** `.space-selector__item-name` — truncate. */
export const SpaceSelectorItemNameFrame = styled(Text, {
  name: 'SpaceSelectorItemName',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
})

/** `.space-selector__footer` — border-t border, p-2. */
export const SpaceSelectorFooterFrame = styled(View, {
  name: 'SpaceSelectorFooter',
  borderTopWidth: 1,
  borderTopColor: '$border',
  padding: '$2',
})

/** `.space-selector__create-form` — p-1 (0.25rem). */
export const SpaceSelectorCreateFormFrame = styled(View, {
  name: 'SpaceSelectorCreateForm',
  padding: '$1',
})

/** `.space-selector__create-btn` — flex-1. */
export const SpaceSelectorCreateBtnFrame = styled(View, {
  name: 'SpaceSelectorCreateBtn',
  flexGrow: 1,
  flexShrink: 1,
  flexBasis: '0%',
})

/** `.space-selector__new-btn` — w-full. */
export const SpaceSelectorNewBtnFrame = styled(View, {
  name: 'SpaceSelectorNewBtn',
  width: '100%',
})

/* ── UserDetailPanel ──────────────────────────────────────────────── */

/** `.user-detail__empty` — flex, items/justify center, h-full. */
export const SpaceUserDetailEmptyFrame = styled(View, {
  name: 'SpaceUserDetailEmpty',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  height: '100%',
})

/** `.user-detail__empty-inner` — text-center. */
export const SpaceUserDetailEmptyInnerFrame = styled(View, {
  name: 'SpaceUserDetailEmptyInner',
  textAlign: 'center',
})

/** `.user-detail__empty-avatar` — mx-auto mb-4 (margin 0 auto 1rem), muted surface. */
export const SpaceUserDetailEmptyAvatarFrame = styled(View, {
  name: 'SpaceUserDetailEmptyAvatar',
  marginTop: 0,
  marginHorizontal: 'auto',
  marginBottom: '$4',
  backgroundColor: '$muted',
})

/** `.user-detail__empty-icon` — w-7 h-7 (1.75rem), opacity 0.5. */
export const SpaceUserDetailEmptyIconFrame = styled(View, {
  name: 'SpaceUserDetailEmptyIcon',
  width: '$7',
  height: '$7',
  opacity: 0.5,
})

/** `.user-detail__empty-caption` — max-w-[320px] (20rem). */
export const SpaceUserDetailEmptyCaptionFrame = styled(Text, {
  name: 'SpaceUserDetailEmptyCaption',
  maxWidth: 320,
})

/** `.user-detail__panel` — h-full, flex col, overflow hidden. */
export const SpaceUserDetailPanelFrame = styled(View, {
  name: 'SpaceUserDetailPanel',
  height: '100%',
  display: 'flex',
  flexDirection: 'column',
  overflow: 'hidden',
})

/** `.user-detail__header-row` — flex, items-start, gap-4 (1rem). */
export const SpaceUserDetailHeaderRowFrame = styled(View, {
  name: 'SpaceUserDetailHeaderRow',
  display: 'flex',
  alignItems: 'flex-start',
  gap: '$4',
})

/** `.user-detail__avatar-col` — shrink-0. */
export const SpaceUserDetailAvatarColFrame = styled(View, {
  name: 'SpaceUserDetailAvatarCol',
  flexShrink: 0,
})

/** `.user-detail__avatar-fallback` — agent gradient, white text, bold, text-2xl (1.5rem). */
export const SpaceUserDetailAvatarFallbackFrame = styled(View, {
  name: 'SpaceUserDetailAvatarFallback',
  backgroundImage: 'linear-gradient(135deg, var(--agent), color-mix(in srgb, var(--agent) 80%, black))',
  color: 'white',
  fontWeight: '$bold',
  fontSize: '$2xl',
})

/** `.user-detail__header-info` — flex-1, min-w-0. */
export const SpaceUserDetailHeaderInfoFrame = styled(View, {
  name: 'SpaceUserDetailHeaderInfo',
  flexGrow: 1,
  flexShrink: 1,
  flexBasis: '0%',
  minWidth: 0,
})

/** `.user-detail__name` — truncate. */
export const SpaceUserDetailNameFrame = styled(Text, {
  name: 'SpaceUserDetailName',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
})

/** `.user-detail__role-badge` — mt-2, inline-flex, items-center, gap-1.5 (0.375rem), py-1.5 px-3.
 *  `--admin`/`--editor`/`--viewer` → the `role` variant. */
export const SpaceUserDetailRoleBadgeFrame = styled(View, {
  name: 'SpaceUserDetailRoleBadge',
  marginTop: '$2',
  display: 'inline-flex',
  alignItems: 'center',
  gap: '$1.5',
  paddingVertical: '$1.5',
  paddingHorizontal: '$3',

  variants: {
    role: {
      // .--admin — bg-gradient-to-r from/to brand-3, text-primary-foreground, shadow-lg tinted brand-3/25
      admin: {
        backgroundImage: 'linear-gradient(to right, var(--brand-3), var(--brand-3))',
        color: '$primary-foreground',
        shadowColor: 'color-mix(in srgb, var(--brand-3) 25%, transparent)',
        shadowOffset: { width: 0, height: 10 },
        shadowRadius: 15,
      },
      // .--editor — bg-gradient-to-r from/to brand-2, text-primary-foreground, shadow-lg tinted brand-2/25
      editor: {
        backgroundImage: 'linear-gradient(to right, var(--brand-2), var(--brand-2))',
        color: '$primary-foreground',
        shadowColor: 'color-mix(in srgb, var(--brand-2) 25%, transparent)',
        shadowOffset: { width: 0, height: 10 },
        shadowRadius: 15,
      },
      // .--viewer — bg-muted, text-muted-foreground, border border
      viewer: {
        backgroundColor: '$muted',
        color: '$muted-foreground',
        borderWidth: 1,
        borderColor: '$border',
      },
    },
  } as const,
})

/** `.user-detail__body` — flex-1, overflow-y auto, py-6 px-8 (1.5rem 2rem). */
export const SpaceUserDetailBodyFrame = styled(View, {
  name: 'SpaceUserDetailBody',
  flexGrow: 1,
  flexShrink: 1,
  flexBasis: '0%',
  overflowY: 'auto',
  paddingVertical: '$6',
  paddingHorizontal: '$8',
})

/** `.user-detail__info-grid` — grid, auto-fit minmax(200px,1fr), gap-4, mb-8 (2rem). */
export const SpaceUserDetailInfoGridFrame = styled(View, {
  name: 'SpaceUserDetailInfoGrid',
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
  gap: '$4',
  marginBottom: '$8',
})

/** `.user-detail__info-icon` — w-4 h-4, opacity 0.6. */
export const SpaceUserDetailInfoIconFrame = styled(View, {
  name: 'SpaceUserDetailInfoIcon',
  width: '$4',
  height: '$4',
  opacity: 0.6,
})

/** `.user-detail__info-card-row` — flex, items-center, gap-1. */
export const SpaceUserDetailInfoCardRowFrame = styled(View, {
  name: 'SpaceUserDetailInfoCardRow',
  display: 'flex',
  alignItems: 'center',
  gap: '$1',
})

/** `.user-detail__section` — mb-8 (2rem). */
export const SpaceUserDetailSectionFrame = styled(View, {
  name: 'SpaceUserDetailSection',
  marginBottom: '$8',
})

/** `.user-detail__permissions-heading` — flex, items-center, gap-2, mb-4 (1rem). */
export const SpaceUserDetailPermissionsHeadingFrame = styled(View, {
  name: 'SpaceUserDetailPermissionsHeading',
  display: 'flex',
  alignItems: 'center',
  gap: '$2',
  marginBottom: '$4',
})

/** `.user-detail__role-icon` — w-5 h-5 (1.25rem), shrink-0. */
export const SpaceUserDetailRoleIconFrame = styled(View, {
  name: 'SpaceUserDetailRoleIcon',
  width: '$5',
  height: '$5',
  flexShrink: 0,
})

/** `.user-detail__role-btn` — cursor pointer, block, w-full (`all: unset` reset omitted, no prop). */
export const SpaceUserDetailRoleBtnFrame = styled(View, {
  name: 'SpaceUserDetailRoleBtn',
  tag: 'button',
  cursor: 'pointer',
  display: 'block',
  width: '100%',
})

/** `.user-detail__role-info` — flex-1. */
export const SpaceUserDetailRoleInfoFrame = styled(View, {
  name: 'SpaceUserDetailRoleInfo',
  flexGrow: 1,
  flexShrink: 1,
  flexBasis: '0%',
})

/** `.user-detail__role-check` — w-6 h-6 (1.5rem), rounded-full, agent surface, white text,
 *  flex items/justify center, shrink-0. */
export const SpaceUserDetailRoleCheckFrame = styled(View, {
  name: 'SpaceUserDetailRoleCheck',
  width: '$6',
  height: '$6',
  borderRadius: '$radius-full',
  backgroundColor: '$agent',
  color: 'white',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  flexShrink: 0,
})

/** `.user-detail__status-heading` — mb-4 (1rem). */
export const SpaceUserDetailStatusHeadingFrame = styled(View, {
  name: 'SpaceUserDetailStatusHeading',
  marginBottom: '$4',
})

/** `.user-detail__role-check-icon` — w-4 h-4. */
export const SpaceUserDetailRoleCheckIconFrame = styled(View, {
  name: 'SpaceUserDetailRoleCheckIcon',
  width: '$4',
  height: '$4',
})

/** `.user-detail__icon-sm` — w-4 h-4. */
export const SpaceUserDetailIconSmFrame = styled(View, {
  name: 'SpaceUserDetailIconSm',
  width: '$4',
  height: '$4',
})

/* ── ConfirmDialog ────────────────────────────────────────────────── */

/** `.confirm-dialog__content` — p-6 (1.5rem), text-center. */
export const SpaceConfirmDialogContentFrame = styled(View, {
  name: 'SpaceConfirmDialogContent',
  padding: '$6',
  textAlign: 'center',
})

/** `.confirm-dialog__icon-wrapper` — w-12 h-12 (3rem), rounded-full, destructive/12 surface,
 *  flex items/justify center, mx-auto. */
export const SpaceConfirmDialogIconWrapperFrame = styled(View, {
  name: 'SpaceConfirmDialogIconWrapper',
  width: '$12',
  height: '$12',
  borderRadius: '$radius-full',
  backgroundColor: 'color-mix(in srgb, var(--destructive) 12%, transparent)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  marginHorizontal: 'auto',
})

/** `.confirm-dialog__icon` — w-6 h-6 (1.5rem), text-destructive. */
export const SpaceConfirmDialogIconFrame = styled(View, {
  name: 'SpaceConfirmDialogIcon',
  width: '$6',
  height: '$6',
  color: '$destructive',
})

/** `.confirm-dialog__action-btn` — flex-1. */
export const SpaceConfirmDialogActionBtnFrame = styled(View, {
  name: 'SpaceConfirmDialogActionBtn',
  flexGrow: 1,
  flexShrink: 1,
  flexBasis: '0%',
})

/* ── Styled wrappers (representative public surface) ──────────────── */

export type SpaceStatus = 'active' | 'invited' | 'pending'
export type SpaceRole = 'admin' | 'editor' | 'viewer'

export interface StyledSpaceListHeaderProps extends React.ComponentProps<'div'> {}
export interface StyledSpaceListStatusDotProps extends React.ComponentProps<'div'> {
  status?: SpaceStatus
}
export interface StyledSpaceListRoleBadgeProps extends React.ComponentProps<'span'> {
  role?: SpaceRole
}
export interface StyledSpaceSelectorProps extends React.ComponentProps<'div'> {}
export interface StyledSpaceUserDetailPanelProps extends React.ComponentProps<'div'> {}
export interface StyledSpaceUserDetailRoleBadgeProps extends React.ComponentProps<'div'> {
  role?: SpaceRole
}
export interface StyledSpaceConfirmDialogIconWrapperProps extends React.ComponentProps<'div'> {}

const Header = SpaceListHeaderFrame as unknown as React.ComponentType<any>
const StatusDot = SpaceListStatusDotFrame as unknown as React.ComponentType<any>
const RoleBadge = SpaceListRoleBadgeFrame as unknown as React.ComponentType<any>
const Selector = SpaceSelectorFrame as unknown as React.ComponentType<any>
const DetailPanel = SpaceUserDetailPanelFrame as unknown as React.ComponentType<any>
const DetailRoleBadge = SpaceUserDetailRoleBadgeFrame as unknown as React.ComponentType<any>
const ConfirmIconWrapper = SpaceConfirmDialogIconWrapperFrame as unknown as React.ComponentType<any>

/** Idiomatic SpaceList header row. */
export function StyledSpaceListHeader(props: StyledSpaceListHeaderProps) {
  return <Header {...props} />
}
/** Idiomatic member status dot — `status` picks the active/invited/pending fill. */
export function StyledSpaceListStatusDot({ status = 'pending', ...props }: StyledSpaceListStatusDotProps) {
  return <StatusDot status={status} {...props} />
}
/** Idiomatic role badge — `role` picks the admin/editor/viewer tint. */
export function StyledSpaceListRoleBadge({ role = 'viewer', ...props }: StyledSpaceListRoleBadgeProps) {
  return <RoleBadge role={role} {...props} />
}
/** Idiomatic SpaceSelector root. */
export function StyledSpaceSelector(props: StyledSpaceSelectorProps) {
  return <Selector {...props} />
}
/** Idiomatic UserDetail panel column. */
export function StyledSpaceUserDetailPanel(props: StyledSpaceUserDetailPanelProps) {
  return <DetailPanel {...props} />
}
/** Idiomatic UserDetail role badge — `role` picks the admin/editor/viewer treatment. */
export function StyledSpaceUserDetailRoleBadge({ role = 'viewer', ...props }: StyledSpaceUserDetailRoleBadgeProps) {
  return <DetailRoleBadge role={role} {...props} />
}
/** Idiomatic ConfirmDialog icon wrapper. */
export function StyledSpaceConfirmDialogIconWrapper(props: StyledSpaceConfirmDialogIconWrapperProps) {
  return <ConfirmIconWrapper {...props} />
}
