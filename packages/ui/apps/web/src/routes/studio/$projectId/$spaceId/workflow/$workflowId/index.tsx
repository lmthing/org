import { createFileRoute, useNavigate, useParams } from '@tanstack/react-router'
import { TasklistEditor } from '@lmthing/ui/studio'

function TasklistEditorPage() {
  const params = useParams({ strict: false }) as {
    projectId?: string; spaceId?: string; workflowId?: string
  }
  const { projectId, spaceId, workflowId } = params
  const navigate = useNavigate()

  const spacePath = projectId && spaceId
    ? `/studio/${projectId}/${spaceId}`
    : ''

  const handleBack = () => {
    navigate({ to: `${spacePath}/workflow` })
  }

  if (!workflowId) return null

  // workflowId is the tasklist name (directory under tasklists/)
  return <TasklistEditor name={workflowId} onBack={handleBack} />
}

export const Route = createFileRoute('/studio/$projectId/$spaceId/workflow/$workflowId/')({
  component: TasklistEditorPage,
})
