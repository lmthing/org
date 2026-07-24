import * as React from 'react'
import * as Prim from '../../primitives/index'

/**
 * CozyThingText — the idiomatic `.cozy-text`. Renders `Prim.Text` (real `<span>`s via
 * `createComponent`) with the per-letter brand colors as `$`-token PROPS from cozy-text.styled.tsx
 * (`.cozy-text--neutral`/`--brand-1..5` → the `tone` map). CSS deleted.
 */
export interface CozyThingTextProps {
  text?: string
  className?: string
}

type Tone = 'neutral' | 'brand-1' | 'brand-2' | 'brand-3' | 'brand-4' | 'brand-5'
const TONE_COLOR: Record<Tone, string> = {
  neutral: '$foreground',
  'brand-1': '$brand-1',
  'brand-2': '$brand-2',
  'brand-3': '$brand-3',
  'brand-4': '$brand-4',
  'brand-5': '$brand-5',
}

const Toned = ({ tone, children }: { tone: Tone; children: React.ReactNode }) => (
  <Prim.Text color={TONE_COLOR[tone]}>{children}</Prim.Text>
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

// The `.cozy-text` wrapper — a semibold span; `className` passes through (surface spacing/size).
const Wrapper = ({ className, children }: { className?: string; children: React.ReactNode }) => (
  <Prim.Text fontWeight="$semibold" className={className}>{children}</Prim.Text>
)

export function CozyThingText({ text = '', className }: CozyThingTextProps) {
  const lowerText = text.toLowerCase().trim()

  if (lowerText === 'lmt') return <Wrapper className={className}><LmtBrand /></Wrapper>
  if (lowerText === 'lmthing') return <Wrapper className={className}><LmthingBrand /></Wrapper>
  if (lowerText === 'thing') return <Wrapper className={className}><ThingBrand /></Wrapper>

  if (lowerText.startsWith('lmthing.')) {
    const suffix = text.trim().slice(8) // preserve original casing of suffix
    return (
      <Wrapper className={className}>
        <LmthingBrand />
        <Toned tone="neutral">.{suffix}</Toned>
      </Wrapper>
    )
  }
  if (lowerText.startsWith('lmt.')) {
    const suffix = text.trim().slice(4)
    return (
      <Wrapper className={className}>
        <LmtBrand />
        <Toned tone="neutral">.{suffix}</Toned>
      </Wrapper>
    )
  }

  return <Prim.Text className={className}>{text}</Prim.Text>
}

export default CozyThingText
