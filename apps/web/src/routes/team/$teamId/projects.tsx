import * as Prim from '@lmthing/ui/elements/primitives'
import { createFileRoute } from '@tanstack/react-router'
import { ProjectProvider } from '@lmthing/state'
import { StudioProjectView } from '@lmthing/ui/studio'
import { useTeamAuth } from '@/lib/team-auth'

/**
 * The team's shared projects, edited with the same studio views a personal
 * workspace uses. Nothing here is team-specific: the enclosing AppProvider
 * already points `@lmthing/state` at the team's pod, so every existing
 * component reads and writes the TEAM's projects and spaces.
 *
 * A viewer sees the same views; their writes are refused by the pod's role
 * guard rather than by hiding the editor.
 */
function TeamProjects() {
  const team = useTeamAuth()
  return (
    <ProjectProvider projectId="user">
      <Prim.Col height="100%">
        {team.role === 'viewer' ? (
          <Prim.Text fontSize="$xs" color="$muted-foreground" padding="$2">
            You have view access to this team — changes are saved only by editors.
          </Prim.Text>
        ) : null}
        <Prim.Box flex={1} minHeight={0}>
          <StudioProjectView />
        </Prim.Box>
      </Prim.Col>
    </ProjectProvider>
  )
}

export const Route = createFileRoute('/team/$teamId/projects')({
  component: TeamProjects,
})
