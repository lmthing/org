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
      className="relative h-full w-full justify-center" alignItems="center"
      style={{ background: colors.bg, padding: '48px 72px 52px' }}
    >
      {/* TOP */}
      <Prim.Col className="mb-10" alignItems="center">
        <Prim.Box
          className="text-lg font-bold uppercase tracking-[0.16em]" marginBottom="1rem"
          style={{ color: colors.brand }}
        >
          What we achieved in 3 days
        </Prim.Box>
        <Prim.Text as="h1"
          className="text-center text-6xl font-extrabold leading-[1.15]"
          style={{ color: colors.text, letterSpacing: '-0.025em' }}
        >
          Built it. <Prim.Text as="em" className="not-italic" style={{ color: colors.brand }}>Validated it.</Prim.Text>{' '}
          Shipped it.
        </Prim.Text>
      </Prim.Col>

      {/* CARDS */}
      <Prim.Box className="grid w-full grid-cols-3 gap-5" marginBottom="2.25rem">
        {cards.map((card) => (
          <Prim.Col
            key={card.title}
            className="relative overflow-hidden rounded-2xl border p-7 pb-8"
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
              className="absolute left-0 right-0 top-0 h-[3px]"
              style={{
                background: card.highlight ? colors.brand : colors.cardBorder,
                borderRadius: '16px 16px 0 0',
              }}
            />

            <Prim.Box className="text-5xl" marginBottom="0.75rem">{card.icon}</Prim.Box>

            <Prim.Box
              className="text-6xl font-extrabold leading-none" marginBottom="0.25rem"
              style={{
                color: card.highlight ? colors.brand : colors.text,
                letterSpacing: '-0.03em',
              }}
            >
              {card.stat}
            </Prim.Box>

            <Prim.Box className="text-2xl font-bold" marginBottom="0.75rem" style={{ color: colors.text }}>
              {card.title}
            </Prim.Box>

            <Prim.Box
              className="h-[1.5px] w-8" marginBottom="1rem"
              style={{
                background: card.highlight
                  ? `color-mix(in srgb, ${colors.brand} 40%, transparent)`
                  : colors.cardBorder,
              }}
            />

            <Prim.Box className="text-lg leading-[1.65]" style={{ color: colors.textSecondary }}>
              {card.body}
            </Prim.Box>
          </Prim.Col>
        ))}
      </Prim.Box>

      {/* BOTTOM STRIP */}
      <Prim.Row
        className="gap-2.5 rounded-full px-8 py-3.5" alignItems="center"
        style={{ background: colors.bgDark }}
      >
        <Prim.Box className="h-1.5 w-1.5 flex-shrink-0 rounded-full" style={{ background: colors.brand }} />
        <Prim.Box className="text-base font-medium tracking-wide text-white">
          Three days.{' '}
          <Prim.Text as="em" className="not-italic font-bold" style={{ color: colors.brand }}>
            One use case shipped.
          </Prim.Text>{' '}
          Five experts convinced.
        </Prim.Box>
        <Prim.Box className="h-1.5 w-1.5 flex-shrink-0 rounded-full" style={{ background: colors.brand }} />
      </Prim.Row>
    </Prim.Col>
  )
}
