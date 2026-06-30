import { createFileRoute } from '@tanstack/react-router'
import { SpacesLayout } from '@lmthing/ui/studio'

export const Route = createFileRoute('/studio/$projectId/')({
  component: () => <SpacesLayout />,
})
