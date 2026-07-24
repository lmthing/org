import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import * as React from 'react'
import { TamaguiProvider } from '@tamagui/core'
import {
  ComputerBootProgressFrame,
  ComputerBootProgressSpinnerFrame,
  ComputerBootProgressLabelFrame,
  ComputerBootProgressStepsFrame,
  ComputerBootProgressStepFrame,
  StyledComputerBootProgress,
} from './boot-progress.styled'
import { tamaguiWebConfig } from '../../theme/tamagui-web.config'

const P = ({ children }: { children: React.ReactNode }) => (
  <TamaguiProvider config={tamaguiWebConfig} defaultTheme="app">
    {children}
  </TamaguiProvider>
)

const root = (ComputerBootProgressFrame as unknown as { staticConfig: any }).staticConfig
const spinner = (ComputerBootProgressSpinnerFrame as unknown as { staticConfig: any }).staticConfig
const label = (ComputerBootProgressLabelFrame as unknown as { staticConfig: any }).staticConfig
const steps = (ComputerBootProgressStepsFrame as unknown as { staticConfig: any }).staticConfig
const step = (ComputerBootProgressStepFrame as unknown as { staticConfig: any }).staticConfig

describe('.computer-boot-progress → styled()', () => {
  it('base is a centered column with a min height', () => {
    expect(root.defaultProps).toMatchObject({ flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '$4', minHeight: 300 })
  })
  it('__spinner uses a color-mix ring with a primary top', () => {
    expect(spinner.defaultProps).toMatchObject({
      borderWidth: 2,
      borderColor: 'color-mix(in srgb, var(--muted-foreground) 30%, transparent)',
      borderTopColor: '$primary',
      borderRadius: '$radius-full',
    })
  })
  it('__label is a medium muted caption', () => {
    expect(label.defaultProps).toMatchObject({ fontSize: '$sm', fontWeight: '$medium', color: '$muted-foreground' })
  })
  it('__steps dims the muted color via color-mix', () => {
    expect(steps.defaultProps).toMatchObject({ color: 'color-mix(in srgb, var(--muted-foreground) 60%, transparent)' })
  })
  it('__step exposes done/active states', () => {
    expect(step.variants.state.done).toMatchObject({ color: '$success' })
    expect(step.variants.state.active).toMatchObject({ color: '$foreground' })
  })
})

describe('StyledComputerBootProgress renders', () => {
  it('renders the frame', () => {
    const { container } = render(<P><StyledComputerBootProgress /></P>)
    expect(container.querySelector('.is_ComputerBootProgress')).toBeTruthy()
  })
})
