import * as Prim from '../../elements/primitives/index.js';
import { colors } from './constants'
import { CozyThingText } from '@lmthing/ui/elements/branding/cozy-text'
import qrCode from '@/assets/qr-code.png'

export default function Slide8Partnership() {
  return (
    <Prim.Box
      className="flex h-full w-full flex-col items-center justify-center"
      style={{ background: colors.bg }}
    >
      <Prim.Text as="h1" className="text-center text-5xl font-bold leading-tight tracking-tight sm:text-7xl" style={{ color: colors.text }}>
        Are you building agents?
        <Prim.Br />
        <Prim.Br />
        Visit <Prim.Text style={{ color: colors.brandDark   }}>lm</Prim.Text><CozyThingText text="thing" className="text-5xl font-bold sm:text-7xl leading-loose" /><Prim.Text style={{ color: colors.brandDark }}>.studio</Prim.Text>
        <Prim.Br />
        and join the community!
      </Prim.Text>

      <Prim.Box className="mt-16 flex flex-col items-center">
        <Prim.Image
          src={qrCode}
          alt="Scan to visit lmthing.studio"
          className="h-80 w-80 rounded-3xl shadow-xl"
          style={{ boxShadow: `0 10px 40px color-mix(in srgb, ${colors.brand} 20%, transparent)` }}
        />
      </Prim.Box>
    </Prim.Box>
  )
}
