import * as Prim from '../../elements/primitives/index.js';
import { colors } from './constants'
import { CozyThingText } from '@lmthing/ui/elements/branding/cozy-text'

export default function Slide1Cover() {
  return (
    <Prim.Col
      height="100%" width="100%" justifyContent="center" alignItems="center"
      style={{ background: colors.bg }}
    >
      {/* Hackathon badge */}
      <Prim.Text
        borderRadius="$radius-full" borderWidth={2} paddingHorizontal="$5" paddingVertical="$1.5" fontSize="$sm" fontWeight="$semibold" letterSpacing="$wide" marginBottom="2.5rem"
        style={{ borderColor: colors.brand, color: colors.brand }}
      >
        AI Hackathon
      </Prim.Text>

      {/* Headline */}
      <Prim.Text as="h1" className="text-center text-6xl font-bold leading-tight tracking-tight sm:text-7xl" style={{ color: colors.text }}>
        Your Knowledge. Your AI.
        <Prim.Br />
        Your Rules.
      </Prim.Text>

      {/* Subtitle */}
      <Prim.Text as="p" textAlign="center" fontSize="$xl" marginTop="1.5rem" style={{ color: colors.textSecondary }}>
        A no-code platform to turn domain expertise into specialized AI agents
      </Prim.Text>

      {/* Product tag */}
      <Prim.Row marginTop="$16" gap="$2" fontSize="$lg" alignItems="center" style={{ lineHeight: '1.75rem' }}>
        <Prim.Text fontWeight="$bold" style={{ color: colors.brand }}>Matilda</Prim.Text>
        <Prim.Text style={{ color: colors.muted }}>powered by</Prim.Text>
        <Prim.Text fontSize="$lg" fontWeight="$bold">
          lm<CozyThingText text="thing" className="text-lg font-bold" />
        </Prim.Text>
      </Prim.Row>
    </Prim.Col>
  )
}
