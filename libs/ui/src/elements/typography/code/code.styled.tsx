/**
 * code.styled.tsx — P2 leaf conversion of the `.code-inline`/`.code-block` blocks
 * (docs/tamagui-idiomatic-migration.md §4). Converts libs/css/src/elements/typography/code/index.css
 * into two idiomatic Tamagui `styled()` frames using the SPIKE-A1 var-backed `$` colors, the `$mono`
 * font, and SPIKE-B scales.
 *
 * `leading-relaxed` has no named lineHeight token, so its Tailwind multiplier (1.625) is emitted as a
 * unitless string. Lands alongside the shipped className Code (index.tsx); code-styled.test.tsx pins it.
 */
import * as React from 'react'
import { styled, Text } from '../../../theme/tamagui-web.config'

/** `.code-inline` — font-mono, text-sm, bg-muted, px-1.5, py-0.5, rounded, text-foreground. */
export const CodeInlineFrame = styled(Text, {
  name: 'CodeInline',
  tag: 'code',
  fontFamily: '$mono',
  fontSize: '$sm',
  backgroundColor: '$muted',
  paddingHorizontal: '$1.5',
  paddingVertical: '$0.5',
  borderRadius: '$radius', // Tailwind `rounded` → the base radius token
  color: '$foreground',
})

/** `.code-block` — font-mono, text-sm, bg-muted, p-4, rounded-md, overflow-x-auto, leading-relaxed. */
export const CodeBlockFrame = styled(Text, {
  name: 'CodeBlock',
  tag: 'pre',
  fontFamily: '$mono',
  fontSize: '$sm',
  backgroundColor: '$muted',
  padding: '$4',
  borderRadius: '$radius-md',
  overflowX: 'auto', // overflow-x-auto (web-only style; passed through by Tamagui web)
  color: '$foreground',
  lineHeight: '1.625' as unknown as number, // leading-relaxed (unitless multiplier)
})

/**
 * The `<code>` nested inside a `.code-block` `<pre>` carries no box styling of its own — it inherits
 * the pre's mono font (matching the shipped `<pre class="code-block"><code/></pre>`).
 */
export const CodeBlockInnerFrame = styled(Text, {
  name: 'CodeBlockInner',
  tag: 'code',
})

export interface StyledCodeProps extends React.ComponentProps<'code'> {
  block?: boolean
}

const Inline = CodeInlineFrame as unknown as React.ComponentType<any>
const Block = CodeBlockFrame as unknown as React.ComponentType<any>
const BlockInner = CodeBlockInnerFrame as unknown as React.ComponentType<any>

/** Idiomatic Code — same public API as the shipped className Code (`block?: boolean`). */
export function StyledCode({ block, children, ...props }: StyledCodeProps) {
  if (block) {
    return (
      <Block>
        <BlockInner {...props}>{children}</BlockInner>
      </Block>
    )
  }
  return <Inline {...props}>{children}</Inline>
}
