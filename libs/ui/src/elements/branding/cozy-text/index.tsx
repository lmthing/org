import * as React from 'react'
import * as Prim from '../../primitives/index'

/**
 * CozyThingText — the idiomatic `.cozy-text`. Renders `Prim.Text` (real `<span>`s via
 * `createComponent`) with the per-letter brand colors as `$`-token PROPS transcribed from its retired `styled()` proof
 * (`.cozy-text--neutral`/`--brand-1..5` → the `tone` map). CSS deleted.
 */
export interface CozyThingTextProps extends Omit<Prim.TextProps, 'children'> {
  text?: string
}

type Tone = 'neutral' | 'brand-1' | 'brand-2' | 'brand-3' | 'brand-4' | 'brand-5'
// `$logo-1..5`, NOT `$brand-1..5`. The two used to be one set, which meant the palette could not be
// restyled without restyling the logo — section accents, avatars and the `--spectrum-*` ramp all
// read the same five hues the wordmark did. `logo-*` is frozen at the mark's colours; `brand-*` is
// free to follow the palette. The `lm` prefix is grey so the coloured `thing` carries the mark.
const TONE_COLOR: Record<Tone, string> = {
  neutral: '$muted-foreground',
  'brand-1': '$logo-1',
  'brand-2': '$logo-2',
  'brand-3': '$logo-3',
  'brand-4': '$logo-4',
  'brand-5': '$logo-5',
}

/**
 * The face the LETTERS must render in, handed down from `Wrapper`.
 *
 * The mark is one `Prim.Text` wrapping one `Prim.Text` per letter, because each letter carries its
 * own `$logo-N` colour. On web the letters are `<span>`s with only a colour, so they INHERIT
 * `font-family` from the wrapper and the wordmark face applies to all of them for free.
 *
 * **Native has no inheritance to rely on here.** `primitives/_native.tsx#NativeText` sets
 * `fontFamily: '$body'` as a styled default — it has to, or a `$`-token `fontSize` has no scale to
 * resolve against and is dropped silently. A styled default is unconditional, so it lands on every
 * letter as an EXPLICIT family, which beats whatever the wrapper set. The wordmark therefore rendered
 * in Manrope on the phone while the wrapper truthfully claimed `$brand`, and because the letter
 * colours were right it read as a weight glitch rather than as the wrong typeface.
 *
 * So the face is passed down instead of inherited. It carries the wrapper's EFFECTIVE values, not
 * the defaults, so a caller that restyles the mark restyles the letters with it.
 */
type Face = Pick<Prim.TextProps, 'fontFamily' | 'fontWeight'>
const FaceContext = React.createContext<Face | null>(null)

const Toned = ({ tone, children }: { tone: Tone; children: React.ReactNode }) => {
  const face = React.useContext(FaceContext)
  return (
    <Prim.Text color={TONE_COLOR[tone]} {...face}>
      {children}
    </Prim.Text>
  )
}

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

// The `.cozy-text` wrapper — a semibold span. Callers' props pass through AFTER the default weight,
// so a surface can restyle the brand mark (font face, size, line-height) with plain style props —
// which is how `elements/nav/app-sidebar` carries what used to be `.app-sidebar__brand`.
const Wrapper = ({ children, ...rest }: Prim.TextProps) => {
  // The same precedence the spread below expresses, computed so the LETTERS get it too — see
  // `FaceContext`. `useMemo` keeps the provider's value stable across renders that change nothing.
  const face = React.useMemo<Face>(
    () => ({
      fontFamily: rest.fontFamily ?? '$brand',
      fontWeight: rest.fontWeight ?? '$semibold',
    }),
    [rest.fontFamily, rest.fontWeight],
  )
  return (
    <FaceContext.Provider value={face}>
      <Prim.Text fontFamily="$brand" fontWeight="$semibold" {...rest}>{children}</Prim.Text>
    </FaceContext.Provider>
  )
}

export function CozyThingText({ text = '', ...rest }: CozyThingTextProps) {
  const lowerText = text.toLowerCase().trim()

  if (lowerText === 'lmt') return <Wrapper {...rest}><LmtBrand /></Wrapper>
  if (lowerText === 'lmthing') return <Wrapper {...rest}><LmthingBrand /></Wrapper>
  if (lowerText === 'thing') return <Wrapper {...rest}><ThingBrand /></Wrapper>

  if (lowerText.startsWith('lmthing.')) {
    const suffix = text.trim().slice(8) // preserve original casing of suffix
    return (
      <Wrapper {...rest}>
        <LmthingBrand />
        <Toned tone="neutral">.{suffix}</Toned>
      </Wrapper>
    )
  }
  if (lowerText.startsWith('lmt.')) {
    const suffix = text.trim().slice(4)
    return (
      <Wrapper {...rest}>
        <LmtBrand />
        <Toned tone="neutral">.{suffix}</Toned>
      </Wrapper>
    )
  }

  return <Prim.Text {...rest}>{text}</Prim.Text>
}

export default CozyThingText
