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
      position="relative" height="100%" width="100%" justifyContent="center" alignItems="center"
      backgroundColor="colors.bg" paddingTop="44px" paddingHorizontal="64px" paddingBottom="48px"
    >
      {/* TOP */}
      <Prim.Col marginBottom="$8" alignItems="center">
        <Prim.Box
          fontSize="$lg" fontWeight="$bold" textTransform="uppercase" letterSpacing="0.16em" marginBottom="0.75rem"
          color={colors.brand}
        >
          Scalability & Business Model
        </Prim.Box>
        <Prim.Text as="h1"
          textAlign="center" fontSize="$6xl" fontWeight="$extrabold" lineHeight="1.15"
          color={colors.text} letterSpacing="-0.025em"
        >
          Open source core.{' '}
          <Prim.Text as="em" fontStyle="normal" color={colors.brand}>
            Enterprise ready.
          </Prim.Text>
        </Prim.Text>
      </Prim.Col>

      {/* BODY */}
      <Prim.Box width="100%" gridTemplateColumns="1fr 1px 1fr" columnGap="$9" display="grid" marginBottom="1.75rem">
        {/* LEFT — Platform points */}
        <Prim.Col justifyContent="center" gap="$5">
          {points.map((p) => (
            <Prim.Row key={p.title} gap="$3" alignItems="flex-start">
              <Prim.Row
                height="$10" width="$10" justifyContent="center" borderRadius="9px" borderWidth={1} fontSize="$xl"
                alignItems="center"
                flexShrink={0}
                lineHeight="1.75rem" backgroundColor="colors.bgCard" borderColor={colors.cardBorder}
              >
                {p.icon}
              </Prim.Row>
              <Prim.Box>
                <Prim.Box fontSize="$lg" fontWeight="$bold" marginBottom="0.125rem" color={colors.text}>
                  {p.title}
                </Prim.Box>
                <Prim.Box fontSize="$base" lineHeight="1.55" color={colors.textSecondary}>
                  {p.highlight90 ? (
                    <>
                      Train models on your own datasets. Cut LLM usage costs by up to{' '}
                      <Prim.Text as="strong" color={colors.text}>90%</Prim.Text> at scale.
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
        <Prim.Box backgroundColor="colors.cardBorder" />

        {/* RIGHT — Pricing tiers */}
        <Prim.Col justifyContent="center" gap="$2">
          <Prim.Box
            fontSize="$sm" fontWeight="$bold" textTransform="uppercase" letterSpacing="0.12em" marginBottom="0.5rem"
            color={colors.brand}
          >
            Business Model
          </Prim.Box>
          {tiers.map((tier) => (
            <Prim.Row
              key={tier.name}
              gap="$3" borderRadius="$radius-xl" borderWidth={1} paddingHorizontal="$4" paddingVertical="$3" alignItems="center"
              backgroundColor="tier.featured\n                  ? `color-mix(in srgb, ${colors.brand} 6%, var(--card))`\n                  : colors.bgCard" borderColor={tier.featured
                  ? `color-mix(in srgb, ${colors.brand} 30%, transparent)`
                  : colors.cardBorder}
            >
              <Prim.Box
                height="$2.5" width="$2.5" flexShrink={0} borderRadius="$radius-full"
                backgroundColor="tier.featured ? colors.brand : colors.cardBorder"
              />
              <Prim.Box
                width="$28" flexShrink={0} fontSize="$base" fontWeight="$bold"
                color={colors.text}
              >
                {tier.name}
              </Prim.Box>
              <Prim.Box flexGrow={1} flexShrink={1} flexBasis="0%" fontSize="$sm" lineHeight={1.375} color={colors.textSecondary}>
                {tier.desc}
              </Prim.Box>
              {tier.tag && (
                <Prim.Text
                  flexShrink={0} borderRadius="$radius-full" paddingHorizontal="$3" paddingVertical="$1" fontSize="$xs" fontWeight="$semibold" whiteSpace="nowrap"
                  backgroundColor="`color-mix(in srgb, ${colors.brand} 10%, transparent)`" color={colors.brand}
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
        gap="$2.5" borderRadius="$radius-full" paddingHorizontal="$8" paddingVertical="$3.5" alignItems="center"
        backgroundColor="colors.bgDark"
      >
        <Prim.Box height="$1.5" width="$1.5" flexShrink={0} borderRadius="$radius-full" backgroundColor="colors.brand" />
        <Prim.Box fontSize="$base" fontWeight="$medium" letterSpacing="$wide" color="#fff" /* ds-lint-ok: literal text-white on the colored slide bg (theme-independent) */>
          Next:{' '}
          <Prim.Text as="em" fontStyle="normal" fontWeight="$bold" color={colors.brand}>
            Ship Matilda · Open-source lm
            <CozyThingText text="thing" fontSize="$base" fontWeight="$bold" /> · Launch enterprise pilot
          </Prim.Text>
        </Prim.Box>
        <Prim.Box height="$1.5" width="$1.5" flexShrink={0} borderRadius="$radius-full" backgroundColor="colors.brand" />
      </Prim.Row>
    </Prim.Col>
  )
}
