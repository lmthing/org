import { createFileRoute } from '@tanstack/react-router'
import { SpacesLayout } from '@lmthing/ui/components/shell/spaces-layout'

export const Route = createFileRoute('/studio/$projectId/')({
  component: () => <SpacesLayout />,
})
