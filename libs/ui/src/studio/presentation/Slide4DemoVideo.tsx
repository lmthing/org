import * as Prim from '../../elements/primitives/index.js';
import { colors } from './constants'
import { CozyThingText } from '@lmthing/ui/elements/branding/cozy-text'

export default function Slide6DemoVideo() {
  return (
    <Prim.Col
      position="relative" height="100%" width="100%" justifyContent="center" alignItems="center"
      style={{ background: colors.bg, padding: '48px 72px 52px' }}
    >
      {/* TOP */}
      <Prim.Col marginBottom="$8" alignItems="center">
        <Prim.Box
          fontSize="$lg" fontWeight="$bold" textTransform="uppercase" letterSpacing="0.16em" marginBottom="1rem"
          style={{ color: colors.brand }}
        >
          See it in action
        </Prim.Box>
        <Prim.Text as="h1"
          textAlign="center" fontSize="$6xl" fontWeight="$extrabold" lineHeight="1.15"
          style={{ color: colors.text, letterSpacing: '-0.025em' }}
        >
          lm<CozyThingText text="thing" className="text-6xl font-extrabold" /> demo
        </Prim.Text>
      </Prim.Col>

      {/* VIDEO CONTAINER */}
      <Prim.Row width="100%" maxWidth={1152} justifyContent="center" alignItems="center">
        <Prim.Video
          src="/lmthing.mp4"
          controls
          autoPlay
          loop
          muted
          className="w-full rounded-2xl shadow-2xl"
          style={{
            border: `1px solid ${colors.cardBorder}`,
            maxHeight: '65vh',
          }}
        />
      </Prim.Row>

      {/* BOTTOM STRIP */}
      <Prim.Row
        marginTop="$8" gap="$2.5" borderRadius="$radius-full" paddingHorizontal="$8" paddingVertical="$3.5" alignItems="center"
        style={{ background: colors.bgSection }}
      >
        <Prim.Box height="$1.5" width="$1.5" flexShrink={0} borderRadius="$radius-full" style={{ background: colors.brand }} />
        <Prim.Box fontSize="$base" fontWeight="$medium" letterSpacing="$wide" style={{ color: colors.textSecondary }}>
          Build custom AI agents in minutes, not days
        </Prim.Box>
        <Prim.Box height="$1.5" width="$1.5" flexShrink={0} borderRadius="$radius-full" style={{ background: colors.brand }} />
      </Prim.Row>
    </Prim.Col>
  )
}
