import { createFileRoute } from '@tanstack/react-router'
import { SettingsView } from '@lmthing/ui/studio'

export const Route = createFileRoute('/studio/$projectId/$spaceId/settings/packages/')({
  component: () => <SettingsView isOpen />,
})
