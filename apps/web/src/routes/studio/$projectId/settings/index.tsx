import { createFileRoute } from '@tanstack/react-router'
import { ProjectSettingsView } from '@lmthing/ui/studio'

export const Route = createFileRoute('/studio/$projectId/settings/')({
  component: () => <ProjectSettingsView />,
})
