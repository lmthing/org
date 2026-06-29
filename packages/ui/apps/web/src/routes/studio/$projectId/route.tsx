import { createFileRoute, Outlet, useParams } from '@tanstack/react-router'
import { ProjectProvider } from '@lmthing/state'

function ProjectLayout() {
  const { projectId } = useParams({ from: '/studio/$projectId' })
  return (
    <ProjectProvider projectId={projectId}>
      <Outlet />
    </ProjectProvider>
  )
}

export const Route = createFileRoute('/studio/$projectId')({
  component: ProjectLayout,
})
