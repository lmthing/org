import * as Prim from '@lmthing/ui/elements/primitives';
import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/computer/spaces/$spaceId/config')({
  component: SpaceConfig,
})

function SpaceConfig() {
  const { spaceId } = Route.useParams()
  return (
    <Prim.Box padding="$8">
      <Prim.Text as="h1" fontSize="$2xl" fontWeight="$bold">Config: {spaceId}</Prim.Text>
    </Prim.Box>
  )
}
