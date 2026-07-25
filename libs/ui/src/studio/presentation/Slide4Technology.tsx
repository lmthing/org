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
    <Prim.Row paddingHorizontal="$5" alignItems="center" style={{ height: 76 }}>
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
      position="relative" height="100%" width="100%" justifyContent="center" alignItems="center"
      style={{ background: colors.bg, padding: '60px 80px 56px' }}
    >
      {/* TOP: headline */}
      <Prim.Col marginBottom="$16" alignItems="center">
        <Prim.Box
          className="text-xl font-bold uppercase tracking-[0.16em]" marginBottom="1.25rem"
          style={{ color: colors.brand }}
        >
          How it works
        </Prim.Box>
        <Prim.Text as="h1"
          textAlign="center" fontSize="$6xl" fontWeight="$extrabold" lineHeight="1.3"
          style={{ color: colors.text, letterSpacing: '-0.025em' }}
        >
          <CozyThingText text="THING" className="text-6xl font-extrabold leading-[1.3]" /> turns your knowledge into agents
          <Prim.Br />
          that <Prim.Text as="em" fontStyle="normal" style={{ color: colors.brand }}>actually know your domain.</Prim.Text>
        </Prim.Text>
      </Prim.Col>

      {/* MIDDLE: flow strip */}
      <Prim.Row marginBottom="$16" width="100%" justifyContent="center" alignItems="flex-start">
        {flowNodes.map((node, i) => (
          <Prim.Row key={node.label} alignItems="flex-start">
            <Prim.Col gap="$2.5" alignItems="center">
              <Prim.Row
                justifyContent="center" whiteSpace="nowrap" borderRadius="$radius-xl" borderWidth={2} fontSize="$xl" fontWeight="$semibold"
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
                maxWidth="160px" textAlign="center" fontSize="$base" lineHeight={1.375}
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
      <Prim.Box height="$px" width="100%" marginBottom="2.25rem" style={{ background: colors.cardBorder }} />

      {/* BOTTOM: technique badges */}
      <Prim.Row gap="$5" alignItems="center">
        {techniques.map((t) => (
          <Prim.Text
            key={t}
            borderRadius="$radius-full" borderWidth={2} backgroundColor="$card" paddingHorizontal="$7" paddingVertical="$3.5" fontSize="$lg" fontWeight="$semibold"
            style={{ borderColor: colors.brand, color: colors.text }}
          >
            {t}
          </Prim.Text>
        ))}
      </Prim.Row>
    </Prim.Col>
  )
}
