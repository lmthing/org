/**
 * StudioAppSidebar — the studio surface's binding of the shared {@link AppSidebar}.
 *
 * Feeds projects (from AppContext) and the active project's spaces (from
 * ProjectContext) into the shared sidebar, and wires navigation:
 *  - selecting a project  → `/studio/$projectId`
 *  - selecting a space    → `/studio/$projectId/$spaceId`
 *
 * The studio surface has no conversations section (chat-only).
 */
import { useMemo } from 'react'
import { useNavigate, useParams } from '@tanstack/react-router'
import { useProjects, useProject } from '@lmthing/state'
import { buildProjectPath, buildSpacePath } from '@lmthing/ui/lib/space-path'
import { AppSidebar } from '@lmthing/ui/elements/nav/app-sidebar'
import type { AppSidebarSpace } from '@lmthing/ui/elements/nav/app-sidebar'
import { AppLinks } from '@lmthing/ui/elements/nav/app-links'

export interface StudioAppSidebarProps {
  className?: string
}

export function StudioAppSidebar({ className }: StudioAppSidebarProps) {
  const navigate = useNavigate()
  const { projectId, spaceId } = useParams({ strict: false }) as {
    projectId?: string
    spaceId?: string
  }
  const { projects, createProject, deleteProject } = useProjects()
  const { spaces, isLoadingSpaces } = useProject()

  const spaceItems = useMemo<AppSidebarSpace[]>(
    () => spaces.map((s) => ({ id: s.id, name: s.name || s.id })),
    [spaces],
  )

  const footer = <AppLinks current="studio" />

  return (
    <AppSidebar
      className={className}
      storageKey="studio-sidebar"
      projects={projects}
      activeProjectId={projectId ?? null}
      onSelectProject={(id) => navigate({ to: buildProjectPath(id) })}
      onCreateProject={async (name) => {
        const { id } = await createProject(name)
        navigate({ to: buildProjectPath(id) })
      }}
      onDeleteProject={async (id) => {
        await deleteProject(id)
        // Leaving the active project? Re-resolve the default from /studio.
        if (id === projectId) navigate({ to: '/studio' })
      }}
      spaces={spaceItems}
      activeSpaceId={spaceId ?? null}
      onSelectSpace={(sid) => {
        if (projectId) navigate({ to: buildSpacePath(projectId, sid) })
      }}
      spacesLoading={isLoadingSpaces}
      footer={footer}
    />
  )
}
