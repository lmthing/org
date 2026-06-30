import { createFileRoute } from '@tanstack/react-router'
import { ComponentEditor } from '@lmthing/ui/studio'

function ComponentEditorPage() {
  return <ComponentEditor />
}

export const Route = createFileRoute('/studio/$projectId/$spaceId/components/')({
  component: ComponentEditorPage,
})
