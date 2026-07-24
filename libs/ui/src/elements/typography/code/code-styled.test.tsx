import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import * as React from 'react'
import { TamaguiProvider } from '@tamagui/core'
import { CodeInlineFrame, CodeBlockFrame, StyledCode } from './code.styled'
import { tamaguiWebConfig } from '../../../theme/tamagui-web.config'

const P = ({ children }: { children: React.ReactNode }) => (
  <TamaguiProvider config={tamaguiWebConfig} defaultTheme="app">
    {children}
  </TamaguiProvider>
)

/** P2 proof gate (leaf) — `.code-inline`/`.code-block` ⇄ styled() (docs §4). */
const inline = (CodeInlineFrame as unknown as { staticConfig: any }).staticConfig
const block = (CodeBlockFrame as unknown as { staticConfig: any }).staticConfig

describe('.code → styled() structure', () => {
  it('.code-inline is mono, muted-bg, padded, rounded', () => {
    expect(inline.defaultProps).toMatchObject({
      fontFamily: '$mono',
      fontSize: '$sm',
      backgroundColor: '$muted',
      paddingHorizontal: '$1.5',
      paddingVertical: '$0.5',
      borderRadius: '$radius',
      color: '$foreground',
    })
  })

  it('.code-block is mono, p-4, overflow-x auto, leading-relaxed', () => {
    expect(block.defaultProps).toMatchObject({
      fontFamily: '$mono',
      padding: '$4',
      borderRadius: '$radius-md',
      overflowX: 'auto',
      color: '$foreground',
    })
    expect(block.defaultProps.lineHeight).toBe('1.625')
  })
})

describe('StyledCode renders', () => {
  it('renders inline by default and pre for block', () => {
    const { container: inlineC } = render(<P><StyledCode>x</StyledCode></P>)
    expect(inlineC.querySelector('.is_CodeInline')).toBeTruthy()
    const { container: blockC } = render(<P><StyledCode block>x</StyledCode></P>)
    expect(blockC.querySelector('.is_CodeBlock')).toBeTruthy()
    expect(blockC.querySelector('.is_CodeBlockInner')).toBeTruthy()
  })
})
