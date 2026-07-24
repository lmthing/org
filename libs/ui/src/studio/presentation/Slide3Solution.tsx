import * as Prim from '../../elements/primitives/index.js';
import { colors } from './constants'
import { CozyThingText } from '@lmthing/ui/elements/branding/cozy-text'
import screenshotUrl from '../../../../docs/presentation/localhost_3000_studio_local%2Fgreek-cooking.png'

const pills = ['No code', 'Any domain', 'Your knowledge', 'Any AI model']

export default function Slide3Solution() {
  return (
    <Prim.Row
      className="relative h-full w-full px-16 py-12" alignItems="center"
      style={{ background: colors.bg }}
    >
      {/* Left column */}
      <Prim.Col className="w-1/2 gap-6 pr-12">
        <Prim.Box className="text-2xl font-bold tracking-widest" style={{ color: colors.brand }}>
          THE SOLUTION
        </Prim.Box>

        <Prim.Box className="text-4xl font-bold">
          lm<CozyThingText text="thing" className="text-4xl font-bold" />
        </Prim.Box>

        <Prim.Text as="h2" className="text-6xl font-bold leading-tight" style={{ color: colors.text }}>
          The no-code studio for
          <Prim.Br />
          <Prim.Text style={{ color: colors.brand }}>domain experts.</Prim.Text>
        </Prim.Text>

        <Prim.Text as="p" className="text-2xl leading-relaxed" style={{ color: colors.textSecondary }}>
          lm<CozyThingText text="thing" className="text-2xl font-semibold" /> lets Dimitris &mdash; and anyone like him &mdash; build a specialized AI agent
          with just their knowledge. No engineers required.
        </Prim.Text>

        <Prim.Row className="flex-wrap gap-4">
          {pills.map((pill) => (
            <Prim.Text
              key={pill}
              className="rounded-full border-2 px-6 py-3 text-lg font-medium"
              style={{ borderColor: colors.brand, color: colors.brand }}
            >
              {pill}
            </Prim.Text>
          ))}
        </Prim.Row>
      </Prim.Col>

      {/* Right column */}
      <Prim.Row className="w-1/2 justify-center" alignItems="center">
        <Prim.Box
          className="rounded-2xl border p-2"
          style={{
            background: colors.white,
            borderColor: colors.cardBorder,
            boxShadow: '0 8px 32px rgba(0,0,0,0.08)',
          }}
        >
          <Prim.Image src={screenshotUrl} alt="lmthing studio screenshot" className="w-full rounded-2xl" />
        </Prim.Box>
      </Prim.Row>

    </Prim.Row>
  )
}
