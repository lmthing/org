import * as Prim from '../../elements/primitives/index.js';
import { colors } from './constants'
import { CozyThingText } from '@lmthing/ui/elements/branding/cozy-text'

const points = [
  {
    icon: '🔓',
    title: 'Open source, git-native',
    desc: 'Knowledge lives in files you own. No lock-in, no black box. Community builds the long tail.',
  },
  {
    icon: '🏛️',
    title: 'Deploy anywhere',
    desc: 'On-premises, EU-compliant, vendor agnostic. Built for the AI Act era.',
  },
  {
    icon: '🛒',
    title: 'Marketplace',
    desc: 'Publish agents & knowledge. Earn revenue. Keep data private — share only the agent.',
  },
  {
    icon: '⚡',
    title: 'Fine-tune on your data',
    desc: 'Train models on your own datasets. Cut LLM usage costs by up to 90% at scale.',
    highlight90: true,
  },
]

const tiers = [
  { name: 'Free', desc: 'Self-hosted, community use, open source' },
  { name: 'Basic', desc: 'Hosted, token proxy, personal agents' },
  { name: 'Pro', desc: 'Marketplace publishing, integrations, priority support', featured: true, tag: 'Revenue share' },
  { name: 'Self-Hosted', desc: 'Full control, own infra, bring your LLM' },
  { name: 'Enterprise', desc: 'On-premises, GDPR / HIPAA, B2B licensing', tag: 'AI Act ready' },
]

export default function Slide6Scalability() {
  return (
    <Prim.Col
      className="relative h-full w-full justify-center" alignItems="center"
      style={{ background: colors.bg, padding: '44px 64px 48px' }}
    >
      {/* TOP */}
      <Prim.Col className="mb-8" alignItems="center">
        <Prim.Box
          className="mb-3 text-lg font-bold uppercase tracking-[0.16em]"
          style={{ color: colors.brand }}
        >
          Scalability & Business Model
        </Prim.Box>
        <Prim.Text as="h1"
          className="text-center text-6xl font-extrabold leading-[1.15]"
          style={{ color: colors.text, letterSpacing: '-0.025em' }}
        >
          Open source core.{' '}
          <Prim.Text as="em" className="not-italic" style={{ color: colors.brand }}>
            Enterprise ready.
          </Prim.Text>
        </Prim.Text>
      </Prim.Col>

      {/* BODY */}
      <Prim.Box className="mb-7 grid w-full grid-cols-[1fr_1px_1fr] gap-x-9">
        {/* LEFT — Platform points */}
        <Prim.Col className="justify-center gap-5">
          {points.map((p) => (
            <Prim.Row key={p.title} className="gap-3" alignItems="flex-start">
              <Prim.Row
                className="h-10 w-10 justify-center rounded-[9px] border text-xl"
                alignItems="center"
                flexShrink={0}
                style={{ lineHeight: '1.75rem', background: colors.bgCard, borderColor: colors.cardBorder }}
              >
                {p.icon}
              </Prim.Row>
              <Prim.Box>
                <Prim.Box className="mb-0.5 text-lg font-bold" style={{ color: colors.text }}>
                  {p.title}
                </Prim.Box>
                <Prim.Box className="text-base leading-[1.55]" style={{ color: colors.textSecondary }}>
                  {p.highlight90 ? (
                    <>
                      Train models on your own datasets. Cut LLM usage costs by up to{' '}
                      <Prim.Text as="strong" style={{ color: colors.text }}>90%</Prim.Text> at scale.
                    </>
                  ) : (
                    p.desc
                  )}
                </Prim.Box>
              </Prim.Box>
            </Prim.Row>
          ))}
        </Prim.Col>

        {/* DIVIDER */}
        <Prim.Box style={{ background: colors.cardBorder }} />

        {/* RIGHT — Pricing tiers */}
        <Prim.Col className="justify-center gap-2">
          <Prim.Box
            className="mb-2 text-sm font-bold uppercase tracking-[0.12em]"
            style={{ color: colors.brand }}
          >
            Business Model
          </Prim.Box>
          {tiers.map((tier) => (
            <Prim.Row
              key={tier.name}
              className="gap-3 rounded-xl border px-4 py-3" alignItems="center"
              style={{
                background: tier.featured
                  ? `color-mix(in srgb, ${colors.brand} 6%, var(--card))`
                  : colors.bgCard,
                borderColor: tier.featured
                  ? `color-mix(in srgb, ${colors.brand} 30%, transparent)`
                  : colors.cardBorder,
              }}
            >
              <Prim.Box
                className="h-2.5 w-2.5 flex-shrink-0 rounded-full"
                style={{ background: tier.featured ? colors.brand : colors.cardBorder }}
              />
              <Prim.Box
                className="w-28 flex-shrink-0 text-base font-bold"
                style={{ color: colors.text }}
              >
                {tier.name}
              </Prim.Box>
              <Prim.Box className="flex-1 text-sm leading-snug" style={{ color: colors.textSecondary }}>
                {tier.desc}
              </Prim.Box>
              {tier.tag && (
                <Prim.Text
                  className="flex-shrink-0 whitespace-nowrap rounded-full px-3 py-1 text-xs font-semibold"
                  style={{ background: `color-mix(in srgb, ${colors.brand} 10%, transparent)`, color: colors.brand }}
                >
                  {tier.tag}
                </Prim.Text>
              )}
            </Prim.Row>
          ))}
        </Prim.Col>
      </Prim.Box>

      {/* BOTTOM STRIP */}
      <Prim.Row
        className="gap-2.5 rounded-full px-8 py-3.5" alignItems="center"
        style={{ background: colors.bgDark }}
      >
        <Prim.Box className="h-1.5 w-1.5 flex-shrink-0 rounded-full" style={{ background: colors.brand }} />
        <Prim.Box className="text-base font-medium tracking-wide text-white">
          Next:{' '}
          <Prim.Text as="em" className="not-italic font-bold" style={{ color: colors.brand }}>
            Ship Matilda · Open-source lm
            <CozyThingText text="thing" className="text-base font-bold" /> · Launch enterprise pilot
          </Prim.Text>
        </Prim.Box>
        <Prim.Box className="h-1.5 w-1.5 flex-shrink-0 rounded-full" style={{ background: colors.brand }} />
      </Prim.Row>
    </Prim.Col>
  )
}
