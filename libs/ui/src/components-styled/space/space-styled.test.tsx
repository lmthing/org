import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import * as React from 'react'
import { TamaguiProvider } from '@tamagui/core'
import {
  SpaceListHeaderFrame,
  SpaceListStatusDotFrame,
  SpaceListRoleBadgeFrame,
  SpaceListBodyFrame,
  SpaceSelectorDropdownFrame,
  SpaceUserDetailPanelFrame,
  SpaceUserDetailRoleBadgeFrame,
  SpaceUserDetailInfoGridFrame,
  SpaceConfirmDialogIconWrapperFrame,
  StyledSpaceListHeader,
  StyledSpaceListStatusDot,
  StyledSpaceListRoleBadge,
  StyledSpaceSelector,
  StyledSpaceUserDetailPanel,
  StyledSpaceUserDetailRoleBadge,
  StyledSpaceConfirmDialogIconWrapper,
} from './space.styled'
import { tamaguiWebConfig } from '../../theme/tamagui-web.config'

const P = ({ children }: { children: React.ReactNode }) => (
  <TamaguiProvider config={tamaguiWebConfig} defaultTheme="app">
    {children}
  </TamaguiProvider>
)

/** P2 proof gate — `space/index.css` BEM blocks ⇄ styled() + variants (docs §4). */
const header = (SpaceListHeaderFrame as unknown as { staticConfig: any }).staticConfig
const dot = (SpaceListStatusDotFrame as unknown as { staticConfig: any }).staticConfig
const roleBadge = (SpaceListRoleBadgeFrame as unknown as { staticConfig: any }).staticConfig
const body = (SpaceListBodyFrame as unknown as { staticConfig: any }).staticConfig
const dropdown = (SpaceSelectorDropdownFrame as unknown as { staticConfig: any }).staticConfig
const panel = (SpaceUserDetailPanelFrame as unknown as { staticConfig: any }).staticConfig
const detailRoleBadge = (SpaceUserDetailRoleBadgeFrame as unknown as { staticConfig: any }).staticConfig
const infoGrid = (SpaceUserDetailInfoGridFrame as unknown as { staticConfig: any }).staticConfig
const confirmIcon = (SpaceConfirmDialogIconWrapperFrame as unknown as { staticConfig: any }).staticConfig

describe('SpaceList base + variants', () => {
  it('__header is a justify-between items-center flex row', () => {
    expect(header.defaultProps).toMatchObject({
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center',
    })
  })

  it('__body is a flex-1 scroll column', () => {
    expect(body.defaultProps).toMatchObject({ flexGrow: 1, overflowY: 'auto' })
  })

  it('__status-dot carries the rounded white-bordered base + status fills', () => {
    expect(dot.defaultProps).toMatchObject({
      position: 'absolute',
      borderRadius: '$radius-full',
      borderWidth: 2,
      borderColor: 'white',
    })
    expect(dot.variants.status.active).toMatchObject({ backgroundColor: '$brand-2' })
    expect(dot.variants.status.invited).toMatchObject({ backgroundColor: '$brand-2' })
    expect(dot.variants.status.pending).toMatchObject({ backgroundColor: '$neutral' })
  })

  it('__role-badge exposes admin/editor/viewer with color-mix alphas', () => {
    expect(roleBadge.variants.role.admin).toMatchObject({
      color: '$brand-3',
      backgroundColor: 'color-mix(in srgb, var(--brand-3) 10%, transparent)',
      borderColor: 'color-mix(in srgb, var(--brand-3) 30%, transparent)',
    })
    expect(roleBadge.variants.role.editor).toMatchObject({ color: '$brand-2' })
    expect(roleBadge.variants.role.viewer).toMatchObject({
      color: '$muted-foreground',
      backgroundColor: '$muted',
      borderColor: '$border',
    })
  })
})

describe('SpaceSelector', () => {
  it('__dropdown is an absolute z-50 top-full overlay', () => {
    expect(dropdown.defaultProps).toMatchObject({
      position: 'absolute',
      top: '100%',
      zIndex: 50,
      marginTop: '$1',
    })
  })
})

describe('UserDetailPanel', () => {
  it('__panel is a full-height flex column that hides overflow', () => {
    expect(panel.defaultProps).toMatchObject({
      height: '100%',
      display: 'flex',
      flexDirection: 'column',
      overflow: 'hidden',
    })
  })

  it('__info-grid is a real CSS grid with an auto-fit template', () => {
    expect(infoGrid.defaultProps).toMatchObject({
      display: 'grid',
      gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
    })
  })

  it('__role-badge admin/editor tint the shadow with the brand color; viewer is bordered muted', () => {
    expect(detailRoleBadge.variants.role.admin).toMatchObject({
      color: '$primary-foreground',
      shadowColor: 'color-mix(in srgb, var(--brand-3) 25%, transparent)',
    })
    expect(detailRoleBadge.variants.role.editor).toMatchObject({
      shadowColor: 'color-mix(in srgb, var(--brand-2) 25%, transparent)',
    })
    expect(detailRoleBadge.variants.role.viewer).toMatchObject({
      backgroundColor: '$muted',
      color: '$muted-foreground',
      borderColor: '$border',
    })
  })
})

describe('ConfirmDialog', () => {
  it('__icon-wrapper is a rounded destructive-tinted centered circle', () => {
    expect(confirmIcon.defaultProps).toMatchObject({
      borderRadius: '$radius-full',
      backgroundColor: 'color-mix(in srgb, var(--destructive) 12%, transparent)',
      marginHorizontal: 'auto',
    })
  })
})

describe('Styled wrappers render', () => {
  it('render their frames with the expected `.is_<Name>` marker', () => {
    const { container } = render(
      <P>
        <StyledSpaceListHeader />
        <StyledSpaceListStatusDot status="active" />
        <StyledSpaceListRoleBadge role="admin" />
        <StyledSpaceSelector />
        <StyledSpaceUserDetailPanel />
        <StyledSpaceUserDetailRoleBadge role="editor" />
        <StyledSpaceConfirmDialogIconWrapper />
      </P>,
    )
    expect(container.querySelector('.is_SpaceListHeader')).toBeTruthy()
    expect(container.querySelector('.is_SpaceListStatusDot')).toBeTruthy()
    expect(container.querySelector('.is_SpaceListRoleBadge')).toBeTruthy()
    expect(container.querySelector('.is_SpaceSelector')).toBeTruthy()
    expect(container.querySelector('.is_SpaceUserDetailPanel')).toBeTruthy()
    expect(container.querySelector('.is_SpaceUserDetailRoleBadge')).toBeTruthy()
    expect(container.querySelector('.is_SpaceConfirmDialogIconWrapper')).toBeTruthy()
  })
})
