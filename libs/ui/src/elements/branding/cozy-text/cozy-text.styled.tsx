/**
 * cozy-text.styled.tsx — P2 leaf conversion of the `.cozy-text` block
 * (docs/tamagui-idiomatic-migration.md §4). Converts libs/css/src/elements/branding/cozy-text/index.css
 * — the `.cozy-text` base (font-semibold) + the per-letter color modifiers (`--neutral`, `--brand-1..5`)
 * — into idiomatic Tamagui `styled()` frames. The colors are the runtime-themed brand tokens (the CSS
 * used `color: var(--brand-N)` directly; here they are `$` tokens, SPIKE-A1 var-backed).
 *
 * The brand-splitting logic (which letters get which tone) is unchanged from the shipped className
 * CozyThingText (index.tsx). Lands alongside it; cozy-text-styled.test.tsx pins the tone table.
 */
import * as React from 'react'
import { styled, Text } from '../../../theme/tamagui-web.config'

/** `.cozy-text` — the semibold wrapper. */
export const CozyTextFrame = styled(Text, {
  name: 'CozyText',
  tag: 'span',
  fontWeight: '$semibold',
})

/**
 * A single toned letter/segment. Each `tone` mirrors a `.cozy-text--*` color modifier:
 *   neutral → --foreground · brand-1..5 → --brand-1..5 (the runtime-themed brand palette).
 */
export const CozyTextSpanFrame = styled(Text, {
  name: 'CozyTextSpan',
  tag: 'span',

  variants: {
    tone: {
      neutral: { color: '$foreground' },
      'brand-1': { color: '$brand-1' },
      'brand-2': { color: '$brand-2' },
      'brand-3': { color: '$brand-3' },
      'brand-4': { color: '$brand-4' },
      'brand-5': { color: '$brand-5' },
    },
  } as const,
})

export type CozyTone = 'neutral' | 'brand-1' | 'brand-2' | 'brand-3' | 'brand-4' | 'brand-5'

const Wrapper = CozyTextFrame as unknown as React.ComponentType<any>
const Span = CozyTextSpanFrame as unknown as React.ComponentType<any>

const Toned = ({ tone, children }: { tone: CozyTone; children: React.ReactNode }) => (
  <Span tone={tone}>{children}</Span>
)

const LmtBrand = () => (
  <>
    <Toned tone="neutral">lm</Toned>
    <Toned tone="brand-1">t</Toned>
  </>
)

const ThingBrand = () => (
  <>
    <Toned tone="brand-1">t</Toned>
    <Toned tone="brand-2">h</Toned>
    <Toned tone="brand-3">i</Toned>
    <Toned tone="brand-4">n</Toned>
    <Toned tone="brand-5">g</Toned>
  </>
)

const LmthingBrand = () => (
  <>
    <Toned tone="neutral">lm</Toned>
    <ThingBrand />
  </>
)

export interface StyledCozyThingTextProps {
  text?: string
  className?: string
}

/** Idiomatic CozyThingText — same brand-splitting behaviour as the shipped className version. */
export function StyledCozyThingText({ text = '' }: StyledCozyThingTextProps) {
  const lower = text.toLowerCase().trim()

  if (lower === 'lmt') return <Wrapper><LmtBrand /></Wrapper>
  if (lower === 'lmthing') return <Wrapper><LmthingBrand /></Wrapper>
  if (lower === 'thing') return <Wrapper><ThingBrand /></Wrapper>

  if (lower.startsWith('lmthing.')) {
    const suffix = text.trim().slice(8)
    return <Wrapper><LmthingBrand /><Toned tone="neutral">.{suffix}</Toned></Wrapper>
  }
  if (lower.startsWith('lmt.')) {
    const suffix = text.trim().slice(4)
    return <Wrapper><LmtBrand /><Toned tone="neutral">.{suffix}</Toned></Wrapper>
  }

  return <Wrapper tone={undefined}>{text}</Wrapper>
}
