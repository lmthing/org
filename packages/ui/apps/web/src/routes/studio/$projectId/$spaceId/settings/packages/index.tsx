import { createFileRoute } from '@tanstack/react-router'
import { SettingsView } from '@lmthing/ui/components/shell/settings-view'

export const Route = createFileRoute('/studio/$projectId/$spaceId/settings/packages/')({
  component: () => <SettingsView isOpen />,
})
