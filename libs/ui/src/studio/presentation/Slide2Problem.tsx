import * as Prim from '../../elements/primitives/index.js';
import { colors } from './constants'

const domains = [
  ['⚖️ Legal', '📚 Education', '🏥 Health'],
  ['💼 Consulting', '🏋️ Fitness', '💰 Finance'],
]

const chips = ['Structuring knowledge', 'Connecting it to the model']

function Arrow() {
  return (
    <Prim.Svg width="72" height="32" viewBox="0 0 72 32" fill="none" className="shrink-0">
      <Prim.Line x1="0" y1="16" x2="56" y2="16" style={{ stroke: colors.brand }} strokeWidth="3" />
      <Prim.Polyline points="50,8 62,16 50,24" style={{ stroke: colors.brand }} strokeWidth="3" fill="none" />
    </Prim.Svg>
  )
}

export default function Slide2Problem() {
  return (
    <Prim.Box
      className="flex h-full w-full flex-col"
      style={{ background: colors.bgSection, padding: '3rem 4rem 3rem' }}
    >
      {/* Slide title — top-left */}
      {/* <h2 style={{ color: colors.text, fontSize: '4.5rem', fontWeight: 700, margin: 0, lineHeight: 1.1 }}>
        The Problem
      </h2> */}

      {/* Three sections — each gets equal flex so they own 1/3 of remaining height */}
      <Prim.Box style={{ flex: 1, display: 'flex', flexDirection: 'column', paddingTop: '2rem' }}>
        {/* Top — The Opportunity */}
        <Prim.Box style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '1.75rem' }}>
          <Prim.Box
            className="font-bold uppercase"
            style={{ color: colors.brand, fontSize: '2rem', letterSpacing: '0.15em' }}
          >
            The Problem
          </Prim.Box>

          {/* Flow diagram */}
          <Prim.Box className="flex items-center" style={{ gap: '1.5rem' }}>
            <Prim.Box
              className="rounded-full border"
              style={{
                background: colors.bgCard,
                borderColor: colors.cardBorder,
                color: colors.text,
                fontSize: '1.4rem',
                padding: '0.85rem 1.75rem',
              }}
            >
              Domain Expert
            </Prim.Box>
            <Arrow />
            <Prim.Box
              className="rounded-full border-2"
              style={{
                background: colors.bgCard,
                borderColor: colors.brand,
                color: colors.text,
                fontSize: '1.4rem',
                padding: '0.85rem 1.75rem',
              }}
            >
              🧱 Engineering Wall
            </Prim.Box>
            <Arrow />
            <Prim.Box
              className="rounded-full border"
              style={{
                background: colors.bgCard,
                borderColor: colors.cardBorder,
                color: colors.text,
                fontSize: '1.4rem',
                padding: '0.85rem 1.75rem',
              }}
            >
              ❌ Can't Build
            </Prim.Box>
          </Prim.Box>

          {/* Chips */}
          <Prim.Box className="flex" style={{ gap: '1rem' }}>
            {chips.map((chip) => (
              <Prim.Box
                key={chip}
                className="rounded-lg"
                style={{
                  background: `linear-gradient(135deg, color-mix(in srgb, ${colors.brand} 8%, transparent), color-mix(in srgb, ${colors.brand} 15%, transparent))`,
                  color: colors.brandDark,
                  fontSize: '1.25rem',
                  fontWeight: 700,
                  padding: '0.65rem 1.4rem',
                  borderLeft: `4px solid ${colors.brand}`,
                  letterSpacing: '0.02em',
                }}
              >
                {chip}
              </Prim.Box>
            ))}
          </Prim.Box>
        </Prim.Box>


        {/* Center — Dividing Statement (hero line) */}
        <Prim.Box
          style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', textAlign: 'center', fontWeight: 700, fontSize: '4rem', lineHeight: 1.15, color: colors.text }}
        >
          The knowledge exists. The tools don't.
        </Prim.Box>

        {/* Bottom — The Wall */}
        <Prim.Box style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '1.5rem' }}>
          <Prim.Box
            className="font-bold uppercase"
            style={{ color: colors.brand, fontSize: '2rem', letterSpacing: '0.15em' }}
          >
            The Opportunity
          </Prim.Box>
          <Prim.Box className="flex flex-col items-center" style={{ gap: '1.1rem' }}>
            {domains.map((row, ri) => (
              <Prim.Box
                key={ri}
                className="flex"
                style={{ gap: '1.1rem' }}
              >
                {row.map((label) => (
                  <Prim.Box
                    key={label}
                    className="rounded-full border"
                    style={{
                      background: colors.bgCard,
                      borderColor: colors.cardBorder,
                      color: colors.text,
                      fontSize: '1.3rem',
                      fontWeight: 400,
                      padding: '0.6rem 1.5rem',
                    }}
                  >
                    {label}
                  </Prim.Box>
                ))}
              </Prim.Box>
            ))}
          </Prim.Box>
        </Prim.Box>

      </Prim.Box>
    </Prim.Box>
  )
}
