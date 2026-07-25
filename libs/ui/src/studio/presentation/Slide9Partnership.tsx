import * as Prim from '../../elements/primitives/index.js';
import { colors } from './constants'
import { CozyThingText } from '@lmthing/ui/elements/branding/cozy-text'
import qrCode from '@/assets/qr-code.png'

export default function Slide8Partnership() {
  return (
    <Prim.Col
      height="100%" width="100%" justifyContent="center" alignItems="center"
      style={{ background: colors.bg }}
    >
      <Prim.Text as="h1" textAlign="center" fontSize="$5xl" fontWeight="$bold" lineHeight={1.25} letterSpacing="$tight" $sm={{ fontSize: "$7xl" }} style={{ color: colors.text }}>
        Are you building agents?
        <Prim.Br />
        <Prim.Br />
        Visit <Prim.Text style={{ color: colors.brandDark   }}>lm</Prim.Text><CozyThingText text="thing" className="text-5xl font-bold sm:text-7xl leading-loose" /><Prim.Text style={{ color: colors.brandDark }}>.studio</Prim.Text>
        <Prim.Br />
        and join the community!
      </Prim.Text>

      <Prim.Col marginTop="$16" alignItems="center">
        <Prim.Image
          src={qrCode}
          alt="Scan to visit lmthing.studio"
          className="h-80 w-80 rounded-3xl shadow-xl"
          style={{ boxShadow: `0 10px 40px color-mix(in srgb, ${colors.brand} 20%, transparent)` }}
        />
      </Prim.Col>
    </Prim.Col>
  )
}
