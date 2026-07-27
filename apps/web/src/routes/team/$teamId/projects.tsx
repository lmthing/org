import * as Prim from '@lmthing/ui/elements/primitives'
import { createFileRoute } from '@tanstack/react-router'
import { useState } from 'react'
import { useProjects, useProject, ProjectProvider } from '@lmthing/state'
import { Card } from '@lmthing/ui/elements/content/card'
import { ListItem } from '@lmthing/ui/elements/content/list-item'
import { Button } from '@lmthing/ui/elements/forms/button'
import { Input } from '@lmthing/ui/elements/forms/input'
import { Heading } from '@lmthing/ui/elements/typography/heading'
import { Caption } from '@lmthing/ui/elements/typography/caption'
import { FolderKanban, Layers, Plus } from 'lucide-react'
import { useTeamAuth } from '@/lib/team-auth'

/**
 * The team's shared projects and spaces.
 *
 * This is a team-native list built directly on `@lmthing/state`'s project/space
 * hooks — NOT the shared Studio app shell (`StudioProjectView`/`StudioAppSidebar`).
 * That shell renders its own full navigation chrome (brand header, its own
 * Chat/Computer/Team links) and assumes it owns the whole viewport; nested
 * under Team's own tab bar it produced two stacked navigations. Reusing it
 * would mean adding an "embedded" mode to shared Studio-surface code used by
 * `/studio` too — out of scope for this pass (see the design/teams-handoff
 * follow-ups). This list is deliberately narrower: a project can be created
 * and its spaces can be seen, but opening a space's actual workspace inside
 * Team has no destination yet — nothing renders a space's content without
 * that same full Studio shell, which doesn't have a chrome-less form either.
 */
function TeamProjects() {
  const team = useTeamAuth()
  const isEditor = team.role === 'editor'
  const { projects, isLoading, createProject } = useProjects()
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [newName, setNewName] = useState('')
  const [busy, setBusy] = useState(false)

  const create = async () => {
    const name = newName.trim()
    if (!name || busy) return
    setBusy(true)
    try {
      const { id } = await createProject(name)
      setNewName('')
      setSelectedId(id)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Prim.Box padding="$6" maxWidth={720} overflow="auto" height="100%">
      {team.role === 'viewer' ? (
        <Caption marginBottom="$3">
          You have view access to this team — changes are saved only by editors.
        </Caption>
      ) : null}
      <Heading level={1} marginBottom="$4">
        Projects
      </Heading>

      {isLoading ? (
        <Caption>Loading…</Caption>
      ) : projects.length === 0 ? (
        <Card padding="$6" display="flex" flexDirection="column" alignItems="center" marginBottom="$4">
          <Prim.Box
            backgroundColor="$muted"
            borderRadius="$radius-full"
            width="$10"
            height="$10"
            display="flex"
            alignItems="center"
            justifyContent="center"
            marginBottom="$3"
          >
            <FolderKanban size={20} color="var(--muted-foreground)" aria-hidden={true} />
          </Prim.Box>
          <Caption>No projects yet.</Caption>
        </Card>
      ) : (
        <Card marginBottom="$4">
          {projects.map((project, i) => (
            <Prim.Box key={project.id}>
              <ListItem selected={project.id === selectedId} onClick={() => setSelectedId(project.id)}>
                <FolderKanban size={14} aria-hidden={true} />
                <Prim.Text fontSize="$sm" marginLeft="$1.5">
                  {project.name}
                </Prim.Text>
              </ListItem>
              {i < projects.length - 1 ? <Prim.Box height={1} backgroundColor="$border" /> : null}
            </Prim.Box>
          ))}
        </Card>
      )}

      {isEditor ? (
        <Prim.Row gap="$2" marginBottom="$6">
          <Input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="New project name"
            flex={1}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void create()
            }}
          />
          <Button onClick={() => void create()} disabled={busy || !newName.trim()}>
            <Plus size={14} aria-hidden={true} />
            Create
          </Button>
        </Prim.Row>
      ) : null}

      {selectedId ? (
        <ProjectProvider key={selectedId} projectId={selectedId}>
          <SpacesList />
        </ProjectProvider>
      ) : null}
    </Prim.Box>
  )
}

function SpacesList() {
  const { spaces, isLoadingSpaces } = useProject()
  return (
    <Prim.Box>
      <Heading level={4} marginBottom="$2">
        Spaces
      </Heading>
      {isLoadingSpaces ? (
        <Prim.Box marginBottom="$2">
          <Caption>Loading…</Caption>
        </Prim.Box>
      ) : spaces.length === 0 ? (
        <Prim.Box marginBottom="$2">
          <Caption>No spaces yet.</Caption>
        </Prim.Box>
      ) : (
        <Card marginBottom="$2">
          {spaces.map((space, i) => (
            <Prim.Box key={space.id}>
              <ListItem cursor="default" hoverStyle={{ backgroundColor: 'transparent' }}>
                <Layers size={14} aria-hidden={true} />
                <Prim.Text fontSize="$sm" marginLeft="$1.5">
                  {space.name}
                </Prim.Text>
              </ListItem>
              {i < spaces.length - 1 ? <Prim.Box height={1} backgroundColor="$border" /> : null}
            </Prim.Box>
          ))}
        </Card>
      )}
      <Caption>Opening a space's workspace inside Team is coming in a follow-up.</Caption>
    </Prim.Box>
  )
}

export const Route = createFileRoute('/team/$teamId/projects')({
  component: TeamProjects,
})
