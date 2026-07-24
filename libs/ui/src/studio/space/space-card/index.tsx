import { Card, CardBody } from '@lmthing/ui/elements/content/card'
import { Heading } from '@lmthing/ui/elements/typography/heading'

interface SpaceCardProps {
  id: string
  name: string
}

export function SpaceCard({ id, name }: SpaceCardProps) {
  return (
    <Card data-space-id={id}>
      <CardBody>
        <Heading level={4}>{name}</Heading>
      </CardBody>
    </Card>
  )
}
