import { createFileRoute } from '@tanstack/react-router'
import { useComputer } from '@/lib/runtime/ComputerContext'
import { Page, PageHeader, PageBody } from '@lmthing/ui/elements/layouts/page'
import { Card, CardHeader, CardBody } from '@lmthing/ui/elements/content/card'
import { Badge } from '@lmthing/ui/elements/content/badge'
import { Heading } from '@lmthing/ui/elements/typography/heading'
import { Caption } from '@lmthing/ui/elements/typography/caption'
import { Account } from '@lmthing/ui/elements/settings/account'
import { Models } from '@lmthing/ui/elements/settings/models'
import { EnvVars } from '@lmthing/ui/elements/settings/env-vars'
import { Billing } from '@lmthing/ui/elements/settings/billing'

export const Route = createFileRoute('/computer/settings')({
  component: Settings,
})

function Settings() {
  const { status } = useComputer()

  return (
    <Page>
      <PageHeader>
        <Heading level={2}>Settings</Heading>
      </PageHeader>
      <PageBody>
        <Card>
          <CardHeader>
            <Heading level={4}>Account</Heading>
          </CardHeader>
          <CardBody>
            <Account />
          </CardBody>
        </Card>

        <Card>
          <CardHeader>
            <Heading level={4}>Runtime</Heading>
          </CardHeader>
          <CardBody>
            <Badge variant="primary">Dedicated Pod</Badge>
            <Caption muted>Status: {status}</Caption>
            <Caption muted>
              0.5 CPU, 1 GB memory. Always-on with full metrics and terminal access.
            </Caption>
          </CardBody>
        </Card>

        <Card>
          <CardHeader>
            <Heading level={4}>Models</Heading>
          </CardHeader>
          <CardBody>
            <Models />
          </CardBody>
        </Card>

        <Card>
          <CardHeader>
            <Heading level={4}>Environment Variables</Heading>
          </CardHeader>
          <CardBody>
            <Caption muted>
              Variables are injected into your compute pod at startup. Saving will restart your pod.
            </Caption>
            <EnvVars />
          </CardBody>
        </Card>

        <Card>
          <CardHeader>
            <Heading level={4}>Billing</Heading>
          </CardHeader>
          <CardBody>
            <Billing />
          </CardBody>
        </Card>
      </PageBody>
    </Page>
  )
}
