import * as Prim from '../../../elements/primitives/index';
import { Card, CardBody } from '../../../elements/content/card'
import { Stack } from '../../../elements/layouts/stack'
import { Page, PageHeader, PageBody } from '../../../elements/layouts/page'
import { Heading } from '../../../elements/typography/heading'
import { Caption } from '../../../elements/typography/caption'
import { Badge } from '../../../elements/content/badge'
import { useProjects } from '@lmthing/state'

/**
 * StudioList — legacy list surface.
 *
 * Under the pod-backed architecture the "studio" concept is renamed to
 * "project" and projects live at the app level (the pod's PVC), not within a
 * space. This component now lists projects via {@link useProjects}.
 */
export function StudioList() {
  const { projects } = useProjects()

  return (
    <Page full>
      <PageHeader>
        <Stack row justifyContent="space-between" alignItems="center">
          <Prim.Box>
            <Heading level={2}>Projects</Heading>
            <Caption muted>Browse and manage your projects</Caption>
          </Prim.Box>
          <Badge variant="muted">{projects.length} project{projects.length !== 1 ? 's' : ''}</Badge>
        </Stack>
      </PageHeader>

      <PageBody>
        {projects.length === 0 ? (
          <Stack alignItems="center" justifyContent="center" padding="3rem">
            <Heading level={3}>No Projects</Heading>
            <Caption muted>Create a project to get started.</Caption>
          </Stack>
        ) : (
          <Stack gap="md">
            {projects.map((project) => (
              <Card key={project.id}>
                <CardBody>
                  <Heading level={4}>{project.name || project.id}</Heading>
                </CardBody>
              </Card>
            ))}
          </Stack>
        )}
      </PageBody>
    </Page>
  )
}
