import * as Prim from '../../elements/primitives/index.js';
import { colors } from './constants'
import { CozyThingText } from '@lmthing/ui/elements/branding/cozy-text'

const cards = [
  {
    icon: '⚡',
    stat: '< 1hr',
    title: 'Matilda, live',
    highlight: true,
    body: (
      <>
        Dimitris uploaded past Panhellenic exam material.{' '}
        <Prim.Text as="strong"><CozyThingText text="THING" className="text-base font-semibold" /> structured his knowledge.</Prim.Text> His custom agent now produces verified
        material on demand.
        <Prim.Br />
        <Prim.Br />
        What used to take a <Prim.Text as="strong">full day of trial-and-error prompting</Prim.Text> — done in under
        an hour, with guaranteed accuracy.
      </>
    ),
  },
  {
    icon: '🎯',
    stat: '5',
    title: 'Mentors validated',
    body: (
      <>
        Pitched and stress-tested the idea with <Prim.Text as="strong">5 domain experts and mentors</Prim.Text> during
        the hackathon.
        <Prim.Br />
        <Prim.Br />
        Real feedback. Real signal. The problem resonated across{' '}
        <Prim.Text as="strong">education, legal, and consulting</Prim.Text> verticals.
      </>
    ),
  },
  {
    icon: '🚀',
    stat: '1',
    title: 'Full pitch shipped',
    body: (
      <>
        Built the complete pitch deck — architecture, positioning, narrative — as a{' '}
        <Prim.Text as="strong">
          working proof of lm
          <CozyThingText text="thing" className="text-lg font-semibold" />
          's value.
        </Prim.Text>
        <Prim.Br />
        <Prim.Br />
        The platform that helped build this pitch <Prim.Text as="strong">is the platform we're pitching.</Prim.Text>
      </>
    ),
  },
]

export default function Slide5BuiltIn3Days() {
  return (
    <Prim.Col
      position="relative" height="100%" width="100%" justifyContent="center" alignItems="center"
      style={{ background: colors.bg, padding: '48px 72px 52px' }}
    >
      {/* TOP */}
      <Prim.Col marginBottom="$10" alignItems="center">
        <Prim.Box
          fontSize="$lg" fontWeight="$bold" textTransform="uppercase" letterSpacing="0.16em" marginBottom="1rem"
          style={{ color: colors.brand }}
        >
          What we achieved in 3 days
        </Prim.Box>
        <Prim.Text as="h1"
          textAlign="center" fontSize="$6xl" fontWeight="$extrabold" lineHeight="1.15"
          style={{ color: colors.text, letterSpacing: '-0.025em' }}
        >
          Built it. <Prim.Text as="em" fontStyle="normal" style={{ color: colors.brand }}>Validated it.</Prim.Text>{' '}
          Shipped it.
        </Prim.Text>
      </Prim.Col>

      {/* CARDS */}
      <Prim.Box className="w-full grid-cols-3 gap-5" display="grid" marginBottom="2.25rem">
        {cards.map((card) => (
          <Prim.Col
            key={card.title}
            position="relative" overflow="hidden" borderRadius="$radius-xl" borderWidth={1} padding="$7" paddingBottom="$8"
            style={{
              background: card.highlight
                ? `color-mix(in srgb, ${colors.brand} 6%, var(--card))`
                : colors.bgCard,
              borderColor: card.highlight
                ? `color-mix(in srgb, ${colors.brand} 25%, transparent)`
                : colors.cardBorder,
            }}
          >
            {/* accent top bar */}
            <Prim.Box
              position="absolute" left="$0" right="$0" top="$0" height="3px"
              style={{
                background: card.highlight ? colors.brand : colors.cardBorder,
                borderRadius: '16px 16px 0 0',
              }}
            />

            <Prim.Box fontSize="$5xl" marginBottom="0.75rem">{card.icon}</Prim.Box>

            <Prim.Box
              fontSize="$6xl" fontWeight="$extrabold" lineHeight={1} marginBottom="0.25rem"
              style={{
                color: card.highlight ? colors.brand : colors.text,
                letterSpacing: '-0.03em',
              }}
            >
              {card.stat}
            </Prim.Box>

            <Prim.Box fontSize="$2xl" fontWeight="$bold" marginBottom="0.75rem" style={{ color: colors.text }}>
              {card.title}
            </Prim.Box>

            <Prim.Box
              height="1.5px" width="$8" marginBottom="1rem"
              style={{
                background: card.highlight
                  ? `color-mix(in srgb, ${colors.brand} 40%, transparent)`
                  : colors.cardBorder,
              }}
            />

            <Prim.Box fontSize="$lg" lineHeight="1.65" style={{ color: colors.textSecondary }}>
              {card.body}
            </Prim.Box>
          </Prim.Col>
        ))}
      </Prim.Box>

      {/* BOTTOM STRIP */}
      <Prim.Row
        gap="$2.5" borderRadius="$radius-full" paddingHorizontal="$8" paddingVertical="$3.5" alignItems="center"
        style={{ background: colors.bgDark }}
      >
        <Prim.Box height="$1.5" width="$1.5" flexShrink={0} borderRadius="$radius-full" style={{ background: colors.brand }} />
        <Prim.Box fontSize="$base" fontWeight="$medium" letterSpacing="$wide" color="#fff" /* ds-lint-ok: literal text-white on the colored slide bg (theme-independent) */>
          Three days.{' '}
          <Prim.Text as="em" fontStyle="normal" fontWeight="$bold" style={{ color: colors.brand }}>
            One use case shipped.
          </Prim.Text>{' '}
          Five experts convinced.
        </Prim.Box>
        <Prim.Box height="$1.5" width="$1.5" flexShrink={0} borderRadius="$radius-full" style={{ background: colors.brand }} />
      </Prim.Row>
    </Prim.Col>
  )
}
