import * as Prim from '../../elements/primitives/index.js';
import { colors } from './constants'
import { CozyThingText } from '@lmthing/ui/elements/branding/cozy-text'

export default function Slide6DemoVideo() {
  return (
    <Prim.Col
      className="relative h-full w-full justify-center" alignItems="center"
      style={{ background: colors.bg, padding: '48px 72px 52px' }}
    >
      {/* TOP */}
      <Prim.Col className="mb-8" alignItems="center">
        <Prim.Box
          className="mb-4 text-lg font-bold uppercase tracking-[0.16em]"
          style={{ color: colors.brand }}
        >
          See it in action
        </Prim.Box>
        <Prim.Text as="h1"
          className="text-center text-6xl font-extrabold leading-[1.15]"
          style={{ color: colors.text, letterSpacing: '-0.025em' }}
        >
          lm<CozyThingText text="thing" className="text-6xl font-extrabold" /> demo
        </Prim.Text>
      </Prim.Col>

      {/* VIDEO CONTAINER */}
      <Prim.Row className="w-full max-w-6xl justify-center" alignItems="center">
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
        className="mt-8 gap-2.5 rounded-full px-8 py-3.5" alignItems="center"
        style={{ background: colors.bgSection }}
      >
        <Prim.Box className="h-1.5 w-1.5 flex-shrink-0 rounded-full" style={{ background: colors.brand }} />
        <Prim.Box className="text-base font-medium tracking-wide" style={{ color: colors.textSecondary }}>
          Build custom AI agents in minutes, not days
        </Prim.Box>
        <Prim.Box className="h-1.5 w-1.5 flex-shrink-0 rounded-full" style={{ background: colors.brand }} />
      </Prim.Row>
    </Prim.Col>
  )
}
