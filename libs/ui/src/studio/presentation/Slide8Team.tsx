import * as Prim from '../../elements/primitives/index.js';
import { colors } from './constants'
import { CozyThingText } from '@lmthing/ui/elements/branding/cozy-text'

const members = [
  {
    name: 'Vasilis Kefallinos',
    role: 'Software Engineer',
    subtitle: '',
    image: 'https://media.licdn.com/dms/image/v2/D4D03AQE3LAcUEgiyDg/profile-displayphoto-shrink_400_400/profile-displayphoto-shrink_400_400/0/1648817529808?e=1774483200&v=beta&t=ffc4fSJI0n7gMyeOZDfyWiNvteKCn54lWHS5fqKx5E4',
  },
  {
    name: 'Thanos Vidakis',
    role: 'Software Engineer',
    subtitle: '',
    image: 'https://media.licdn.com/dms/image/v2/C4D03AQGZ5JdhnudPSw/profile-displayphoto-shrink_400_400/profile-displayphoto-shrink_400_400/0/1596229243641?e=1774483200&v=beta&t=y5hqBkfoWO-Yde_0cmVIdvNmFfVBXqnFdCPcNGtLdgs',
  },
  {
    name: 'Dimitris Maris',
    role: 'Educator - Domain Expert',
    subtitle: 'Matilda CEO',
    image: 'https://media.licdn.com/dms/image/v2/D4D03AQGksKxRuflKeQ/profile-displayphoto-scale_400_400/B4DZovGFVyIkAk-/0/1761726716430?e=1774483200&v=beta&t=gWq_aKmNcy6ykLX1EG9d6WGkU7uudy-o0IarjGDvH9Q',
  },
  {
    name: 'Vassilis Kourtis',
    role: 'Software Engineer',
    subtitle: '',
    image: 'https://media.licdn.com/dms/image/v2/C5603AQG2RMabm1NqIg/profile-displayphoto-shrink_400_400/profile-displayphoto-shrink_400_400/0/1516529896470?e=1774483200&v=beta&t=kYtVz3bbnzyBL1_SMoP0XJMvAZ--cXoL3-ph1A3N2zM',
  },
]

export default function Slide7Team() {
  return (
    <Prim.Col
      height="100%" width="100%" justifyContent="center" alignItems="center"
      style={{ background: colors.bg }}
    >
      <Prim.Text as="h2" alignItems="center" justifyContent="center" gap="$3" fontSize="$7xl" fontWeight="$bold" marginBottom="4rem" display="flex" style={{ color: colors.text }}>
        Team behind the <CozyThingText text="thing" className="text-7xl leading-loose" />
      </Prim.Text>

      <Prim.Row gap="$16">
        {members.map((m) => (
          <Prim.Col key={m.name} alignItems="center">
            <Prim.Image
              src={m.image}
              alt={m.name}
              width="$40" height="$40" borderRadius="$radius-full" borderWidth={4} objectFit="cover"
              style={{ borderColor: colors.brand }}
            />
            <Prim.Text as="p" fontSize="$2xl" fontWeight="$bold" marginTop="1.5rem" style={{ color: colors.text }}>
              {m.name}
            </Prim.Text>
            <Prim.Text as="p" fontSize="$base" marginTop="0.5rem" style={{ color: colors.muted }}>
              {m.role}
            </Prim.Text>
            {m.subtitle && (
              <Prim.Text as="p" fontSize="$sm" marginTop="0.25rem" style={{ color: colors.muted }}>
                {m.subtitle}
              </Prim.Text>
            )}
          </Prim.Col>
        ))}
      </Prim.Row>
    </Prim.Col>
  )
}
