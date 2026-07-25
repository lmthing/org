import * as Prim from '@lmthing/ui/elements/primitives';
import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/computer/spaces/')({
  component: SpaceList,
})

function SpaceList() {
  return (
    <Prim.Box padding="$8">
      <Prim.Text as="h1" fontSize="$2xl" fontWeight="$bold">Spaces</Prim.Text>
    </Prim.Box>
  )
}
