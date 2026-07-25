import * as Prim from '../../elements/primitives/index.js';
import { colors } from './constants'
import { CozyThingText } from '@lmthing/ui/elements/branding/cozy-text'
import screenshotUrl from '../../../../docs/presentation/localhost_3000_studio_local%2Fgreek-cooking.png'

const pills = ['No code', 'Any domain', 'Your knowledge', 'Any AI model']

export default function Slide3Solution() {
  return (
    <Prim.Row
      position="relative" height="100%" width="100%" paddingHorizontal="$16" paddingVertical="$12" alignItems="center"
      style={{ background: colors.bg }}
    >
      {/* Left column */}
      <Prim.Col width="50%" gap="$6" paddingRight="$12">
        <Prim.Box fontSize="$2xl" fontWeight="$bold" letterSpacing="$widest" style={{ color: colors.brand }}>
          THE SOLUTION
        </Prim.Box>

        <Prim.Box fontSize="$4xl" fontWeight="$bold">
          lm<CozyThingText text="thing" className="text-4xl font-bold" />
        </Prim.Box>

        <Prim.Text as="h2" fontSize="$6xl" fontWeight="$bold" lineHeight={1.25} style={{ color: colors.text }}>
          The no-code studio for
          <Prim.Br />
          <Prim.Text style={{ color: colors.brand }}>domain experts.</Prim.Text>
        </Prim.Text>

        <Prim.Text as="p" fontSize="$2xl" lineHeight={1.625} style={{ color: colors.textSecondary }}>
          lm<CozyThingText text="thing" className="text-2xl font-semibold" /> lets Dimitris &mdash; and anyone like him &mdash; build a specialized AI agent
          with just their knowledge. No engineers required.
        </Prim.Text>

        <Prim.Row flexWrap="wrap" gap="$4">
          {pills.map((pill) => (
            <Prim.Text
              key={pill}
              borderRadius="$radius-full" borderWidth={2} paddingHorizontal="$6" paddingVertical="$3" fontSize="$lg" fontWeight="$medium"
              style={{ borderColor: colors.brand, color: colors.brand }}
            >
              {pill}
            </Prim.Text>
          ))}
        </Prim.Row>
      </Prim.Col>

      {/* Right column */}
      <Prim.Row width="50%" justifyContent="center" alignItems="center">
        <Prim.Box
          borderRadius="$radius-xl" borderWidth={1} padding="$2"
          style={{
            background: colors.white,
            borderColor: colors.cardBorder,
            boxShadow: '0 8px 32px rgba(0,0,0,0.08)',
          }}
        >
          <Prim.Image src={screenshotUrl} alt="lmthing studio screenshot" width="100%" borderRadius="$radius-xl" />
        </Prim.Box>
      </Prim.Row>

    </Prim.Row>
  )
}
