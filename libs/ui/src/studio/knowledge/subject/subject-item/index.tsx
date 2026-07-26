// OptionItem — displays one option file in a knowledge field
import { Card, CardBody } from '../../../../elements/content/card'
import { Heading } from '../../../../elements/typography/heading'
import { Caption } from '../../../../elements/typography/caption'

interface OptionItemProps {
  slug: string
  path: string
}

export function OptionItem({ slug, path }: OptionItemProps) {
  return (
    <Card data-option-slug={slug}>
      <CardBody>
        <Heading level={4}>{slug}</Heading>
        <Caption muted>{path}</Caption>
      </CardBody>
    </Card>
  )
}

// backward compat
export { OptionItem as SubjectItem }
