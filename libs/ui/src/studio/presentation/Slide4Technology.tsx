import * as Prim from '../../elements/primitives/index.js';
import { colors } from './constants'
import { CozyThingText } from '@lmthing/ui/elements/branding/cozy-text'

const flowNodes = [
  { label: 'You', sub: 'Domain expert' },
  { label: 'THING', sub: 'Organises \u00b7 Routes \u00b7 Controls', hero: true, isThing: true },
  { label: 'Structured Knowledge', sub: 'Fields \u00b7 Topics \u00b7 Verified files' },
  { label: 'Specialist Agent', sub: 'Grounded in your domain' },
  { label: 'Grounded Response', sub: 'No hallucinations' },
]

const techniques = ['RAG', 'Structured Prompt Engineering', 'Multi-Agent Orchestration']

function Arrow() {
  return (
    <Prim.Row className="px-5" alignItems="center" style={{ height: 76 }}>
      <Prim.Svg
        width="38"
        height="38"
        viewBox="0 0 24 24"
        fill="none"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        style={{ stroke: colors.brand, opacity: 0.7 }}
      >
        <Prim.Path d="M5 12h14M13 6l6 6-6 6" />
      </Prim.Svg>
    </Prim.Row>
  )
}

export default function Slide4Technology() {
  return (
    <Prim.Col
      className="relative h-full w-full justify-center" alignItems="center"
      style={{ background: colors.bg, padding: '60px 80px 56px' }}
    >
      {/* TOP: headline */}
      <Prim.Col className="mb-16" alignItems="center">
        <Prim.Box
          className="mb-5 text-xl font-bold uppercase tracking-[0.16em]"
          style={{ color: colors.brand }}
        >
          How it works
        </Prim.Box>
        <Prim.Text as="h1"
          className="text-center text-6xl font-extrabold leading-[1.3]"
          style={{ color: colors.text, letterSpacing: '-0.025em' }}
        >
          <CozyThingText text="THING" className="text-6xl font-extrabold leading-[1.3]" /> turns your knowledge into agents
          <Prim.Br />
          that <Prim.Text as="em" className="not-italic" style={{ color: colors.brand }}>actually know your domain.</Prim.Text>
        </Prim.Text>
      </Prim.Col>

      {/* MIDDLE: flow strip */}
      <Prim.Row className="mb-16 w-full justify-center" alignItems="flex-start">
        {flowNodes.map((node, i) => (
          <Prim.Row key={node.label} alignItems="flex-start">
            <Prim.Col className="gap-2.5" alignItems="center">
              <Prim.Row
                className="justify-center whitespace-nowrap rounded-2xl border-2 text-xl font-semibold"
                alignItems="center"
                style={{
                  lineHeight: '1.75rem',
                  ...(node.hero
                    ? {
                        background: colors.bgSection,
                        borderColor: colors.cardBorder,
                        color: colors.white,
                        fontSize: 26,
                        fontWeight: 800,
                        padding: '24px 40px',
                        borderRadius: 20,
                        boxShadow: '0 8px 32px rgba(0,0,0,0.12)',
                        letterSpacing: '0.02em',
                        height: 76,
                      }
                    : {
                        background: colors.bgCard,
                        borderColor: colors.cardBorder,
                        color: colors.text,
                        padding: '0 32px',
                        height: 76,
                      }
                  ) }}
              >
                {node.isThing ? <CozyThingText text={node.label} className="font-extrabold text-4xl" /> : node.label}
              </Prim.Row>
              <Prim.Box
                className="max-w-[160px] text-center text-base leading-snug"
                style={
                  node.hero
                    ? {
                        color: colors.brand,
                        fontWeight: 600,
                        fontSize: 15,
                        letterSpacing: '0.06em',
                        textTransform: 'uppercase' as const,
                      }
                    : { color: colors.muted }
                }
              >
                {node.sub}
              </Prim.Box>
            </Prim.Col>
            {i < flowNodes.length - 1 && <Arrow />}
          </Prim.Row>
        ))}
      </Prim.Row>

      {/* Divider */}
      <Prim.Box className="mb-9 h-px w-full" style={{ background: colors.cardBorder }} />

      {/* BOTTOM: technique badges */}
      <Prim.Row className="gap-5" alignItems="center">
        {techniques.map((t) => (
          <Prim.Text
            key={t}
            className="rounded-full border-2 bg-card px-7 py-3.5 text-lg font-semibold"
            style={{ borderColor: colors.brand, color: colors.text }}
          >
            {t}
          </Prim.Text>
        ))}
      </Prim.Row>
    </Prim.Col>
  )
}
