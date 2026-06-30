import { createFileRoute } from '@tanstack/react-router'
import { DomainMetadataPanel } from '@lmthing/ui/studio'

function DomainMetadataPage() {
  const { domainId } = Route.useParams()
  return <DomainMetadataPanel domain={domainId} />
}

export const Route = createFileRoute('/studio/$projectId/$spaceId/knowledge/domain/$domainId/')({
  component: DomainMetadataPage,
})
