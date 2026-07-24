import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import * as React from 'react'
import { TamaguiProvider } from '@tamagui/core'
import {
  ShellSpacesLayoutFrame,
  ShellSpacesHomeBtnFrame,
  ShellSpacesModalBackdropFrame,
  ShellSpacesModalFrame,
  ShellStudiosLayoutFrame,
  ShellStudiosCreateCardFrame,
  ShellStudiosModalFrame,
  ShellStudiosModalDescFrame,
  ShellStudiosDeleteBtnFrame,
  ShellSettingsTabFrame,
  ShellSettingsPanelContainerFrame,
  ShellSettingsStatusFrame,
  ShellSettingsEnvTextareaFrame,
  ShellSidebarSectionHeaderFrame,
  ShellSidebarItemIconFrame,
  ShellSidebarDeviceCodeFrame,
  ShellSidebarDeviceCodeCodeFrame,
  StyledShellSpacesLayout,
  StyledShellStudiosModal,
  StyledShellSettingsTab,
  StyledShellSettingsStatus,
  StyledShellSidebarItemIcon,
} from './shell.styled'
import { tamaguiWebConfig } from '../../theme/tamagui-web.config'

const P = ({ children }: { children: React.ReactNode }) => (
  <TamaguiProvider config={tamaguiWebConfig} defaultTheme="app">
    {children}
  </TamaguiProvider>
)

const cfg = (f: unknown) => (f as { staticConfig: any }).staticConfig

/** P2 proof gate — the shell BEM families ⇄ styled() + variants (docs §4). */
describe('.spaces-layout → styled()', () => {
  it('root carries h-100vh', () => {
    expect(cfg(ShellSpacesLayoutFrame).defaultProps).toMatchObject({ height: '100vh' })
  })
  it('home-btn is a 3rem chromeless centered button', () => {
    expect(cfg(ShellSpacesHomeBtnFrame).defaultProps).toMatchObject({
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      width: '$12',
      height: '$12',
      backgroundColor: 'transparent',
      borderWidth: 0,
    })
  })
  it('modal-backdrop is a fixed centered half-opaque scrim', () => {
    expect(cfg(ShellSpacesModalBackdropFrame).defaultProps).toMatchObject({
      position: 'fixed',
      zIndex: 50,
      backgroundColor: 'rgba(0,0,0,0.5)',
    })
  })
  it('modal is a rounded-lg bordered surface panel', () => {
    expect(cfg(ShellSpacesModalFrame).defaultProps).toMatchObject({
      backgroundColor: '$background',
      borderRadius: '$radius-lg',
      padding: '$6',
      width: '100%',
      borderColor: '$border',
    })
  })
})

describe('.studios-layout → styled()', () => {
  it('root is a min-h-screen background surface', () => {
    expect(cfg(ShellStudiosLayoutFrame).defaultProps).toMatchObject({
      minHeight: '100vh',
      backgroundColor: '$background',
    })
  })
  it('create-card carries a hover opacity (transition awaits the driver)', () => {
    expect(cfg(ShellStudiosCreateCardFrame).defaultProps).toMatchObject({
      borderStyle: 'dashed',
      borderWidth: 2,
      opacity: 0.6,
    })
    expect(cfg(ShellStudiosCreateCardFrame).defaultProps.hoverStyle).toMatchObject({ opacity: 1 })
  })
  it('modal exposes a `size` sm variant (max-w-sm)', () => {
    expect(cfg(ShellStudiosModalFrame).defaultProps).toMatchObject({ borderRadius: '$radius-xl' })
    expect(cfg(ShellStudiosModalFrame).variants.size.sm).toMatchObject({ maxWidth: 384 })
  })
  it('modal-desc exposes an `lg` variant (mb-1.5rem)', () => {
    expect(cfg(ShellStudiosModalDescFrame).defaultProps).toMatchObject({ marginBottom: '$4' })
    expect(cfg(ShellStudiosModalDescFrame).variants.lg.true).toMatchObject({ marginBottom: '$6' })
  })
  it('delete-btn is a destructive surface with literal-white text', () => {
    expect(cfg(ShellStudiosDeleteBtnFrame).defaultProps).toMatchObject({
      backgroundColor: '$destructive',
      color: 'white',
    })
  })
})

describe('.settings-view → styled()', () => {
  it('tab exposes active/inactive `state` variants', () => {
    expect(cfg(ShellSettingsTabFrame).variants.state.active).toMatchObject({
      borderBottomWidth: 2,
      borderBottomColor: '$primary',
      color: '$primary',
    })
    expect(cfg(ShellSettingsTabFrame).variants.state.inactive).toMatchObject({
      borderBottomColor: 'transparent',
    })
  })
  it('panel-container exposes the `env` variant (mb-1rem)', () => {
    expect(cfg(ShellSettingsPanelContainerFrame).defaultProps).toMatchObject({ marginHorizontal: 'auto' })
    expect(cfg(ShellSettingsPanelContainerFrame).variants.env.true).toMatchObject({ marginBottom: '$4' })
  })
  it('status exposes error/success tone variants over a shared mt-0.5rem', () => {
    expect(cfg(ShellSettingsStatusFrame).defaultProps).toMatchObject({ marginTop: '$2' })
    expect(cfg(ShellSettingsStatusFrame).variants.status.error).toMatchObject({ color: '$destructive' })
    expect(cfg(ShellSettingsStatusFrame).variants.status.success).toMatchObject({ color: '$success' })
  })
  it('env-textarea is a monospace vertically-resizable field', () => {
    expect(cfg(ShellSettingsEnvTextareaFrame).defaultProps).toMatchObject({
      height: '$64',
      fontFamily: 'monospace',
      resize: 'vertical',
    })
  })
})

describe('.studio-sidebar → styled()', () => {
  it('section-header is a 10px uppercase wide-tracked label', () => {
    expect(cfg(ShellSidebarSectionHeaderFrame).defaultProps).toMatchObject({
      fontSize: 10,
      textTransform: 'uppercase',
      letterSpacing: '$wider',
    })
  })
  it('item-icon exposes knowledge/assistant `kind` tone variants', () => {
    expect(cfg(ShellSidebarItemIconFrame).defaultProps).toMatchObject({ width: 16, height: 16 })
    expect(cfg(ShellSidebarItemIconFrame).variants.kind.knowledge).toMatchObject({ color: '$knowledge' })
    expect(cfg(ShellSidebarItemIconFrame).variants.kind.assistant).toMatchObject({ color: '$agent' })
  })
  it('device-code is a bordered rounded callout; nested code is widest-tracked', () => {
    expect(cfg(ShellSidebarDeviceCodeFrame).defaultProps).toMatchObject({
      borderRadius: '$radius-md',
      borderColor: '$border',
      fontSize: '$xs',
    })
    expect(cfg(ShellSidebarDeviceCodeCodeFrame).defaultProps).toMatchObject({ letterSpacing: '$widest' })
  })
})

describe('Styled shell wrappers render', () => {
  it('renders the top-level frames with their `.is_<Name>` classes', () => {
    const { container } = render(
      <P>
        <StyledShellSpacesLayout />
        <StyledShellStudiosModal size="sm" />
        <StyledShellSettingsTab state="active" />
        <StyledShellSettingsStatus status="error" />
        <StyledShellSidebarItemIcon kind="knowledge" />
      </P>,
    )
    expect(container.querySelector('.is_ShellSpacesLayout')).toBeTruthy()
    expect(container.querySelector('.is_ShellStudiosModal')).toBeTruthy()
    expect(container.querySelector('.is_ShellSettingsTab')).toBeTruthy()
    expect(container.querySelector('.is_ShellSettingsStatus')).toBeTruthy()
    expect(container.querySelector('.is_ShellSidebarItemIcon')).toBeTruthy()
  })
})
