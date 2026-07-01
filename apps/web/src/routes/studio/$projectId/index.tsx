import { createFileRoute } from '@tanstack/react-router'
import { StudioProjectView } from '@lmthing/ui/studio'

export const Route = createFileRoute('/studio/$projectId/')({
  component: () => <StudioProjectView />,
})
