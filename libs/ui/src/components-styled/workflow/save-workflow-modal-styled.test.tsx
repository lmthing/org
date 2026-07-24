import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import * as React from 'react'
import { TamaguiProvider } from '@tamagui/core'
import {
  SaveWorkflowModalDialogFrame,
  SaveWorkflowModalBodyFrame,
  SaveWorkflowModalFooterFrame,
  StyledSaveWorkflowModal,
} from './save-workflow-modal.styled'
import { tamaguiWebConfig } from '../../theme/tamagui-web.config'

const P = ({ children }: { children: React.ReactNode }) => (
  <TamaguiProvider config={tamaguiWebConfig} defaultTheme="app">
    {children}
  </TamaguiProvider>
)

const dialog = (SaveWorkflowModalDialogFrame as unknown as { staticConfig: any }).staticConfig
const body = (SaveWorkflowModalBodyFrame as unknown as { staticConfig: any }).staticConfig
const footer = (SaveWorkflowModalFooterFrame as unknown as { staticConfig: any }).staticConfig

describe('.save-workflow-modal → styled()', () => {
  it('__dialog caps its width', () => {
    expect(dialog.defaultProps).toMatchObject({ maxWidth: '28rem' })
  })
  it('__body carries the padding', () => {
    expect(body.defaultProps).toMatchObject({ padding: '$6' })
  })
  it('__footer is an end-justified flex row', () => {
    expect(footer.defaultProps).toMatchObject({ display: 'flex', justifyContent: 'flex-end', gap: '$3' })
  })
})

describe('StyledSaveWorkflowModal renders', () => {
  it('renders the frame', () => {
    const { container } = render(<P><StyledSaveWorkflowModal /></P>)
    expect(container.querySelector('.is_SaveWorkflowModalDialog')).toBeTruthy()
  })
})
