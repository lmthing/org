import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import * as React from 'react'
import { TamaguiProvider } from '@tamagui/core'
import {
  MarkdownFrame,
  MarkdownH1Frame,
  MarkdownCodeFrame,
  MarkdownPreFrame,
  MarkdownBlockquoteFrame,
  MarkdownThFrame,
  StyledMarkdown,
} from './markdown.styled'
import { tamaguiWebConfig } from '../../theme/tamagui-web.config'

const P = ({ children }: { children: React.ReactNode }) => (
  <TamaguiProvider config={tamaguiWebConfig} defaultTheme="app">
    {children}
  </TamaguiProvider>
)

const md = (MarkdownFrame as unknown as { staticConfig: any }).staticConfig
const h1 = (MarkdownH1Frame as unknown as { staticConfig: any }).staticConfig
const code = (MarkdownCodeFrame as unknown as { staticConfig: any }).staticConfig
const pre = (MarkdownPreFrame as unknown as { staticConfig: any }).staticConfig
const quote = (MarkdownBlockquoteFrame as unknown as { staticConfig: any }).staticConfig
const th = (MarkdownThFrame as unknown as { staticConfig: any }).staticConfig

describe('.lm-markdown → per-element styled() frames', () => {
  it('container carries the foreground/text-sm tokens', () => {
    expect(md.defaultProps).toMatchObject({ color: '$foreground', fontSize: '$sm' })
  })

  it('h1 keeps the shared heading base + its own font-size', () => {
    expect(h1.defaultProps).toMatchObject({ color: '$foreground', fontWeight: '$semibold', fontSize: '$xl' })
  })

  it('code uses the muted surface + rounded-sm', () => {
    expect(code.defaultProps).toMatchObject({ backgroundColor: '$muted', color: '$foreground', borderRadius: '$radius-sm' })
  })

  it('pre is a bordered muted block', () => {
    expect(pre.defaultProps).toMatchObject({ backgroundColor: '$muted', borderColor: '$border', borderWidth: 1 })
  })

  it('blockquote is a muted-foreground left rule', () => {
    expect(quote.defaultProps).toMatchObject({ color: '$muted-foreground', borderLeftWidth: 3 })
  })

  it('th adds the muted header surface + semibold', () => {
    expect(th.defaultProps).toMatchObject({ backgroundColor: '$muted', fontWeight: '$semibold', borderColor: '$border' })
  })
})

describe('StyledMarkdown renders', () => {
  it('renders the container frame', () => {
    const { container } = render(<P><StyledMarkdown /></P>)
    expect(container.querySelector('.is_Markdown')).toBeTruthy()
  })
})
