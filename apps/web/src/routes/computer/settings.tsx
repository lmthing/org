import { createFileRoute } from '@tanstack/react-router'
import { useAuth } from '@lmthing/auth'
import { useComputer } from '@/lib/runtime/ComputerContext'
import { Page, PageHeader, PageBody } from '@lmthing/ui/elements/layouts/page'
import { Card, CardHeader, CardBody } from '@lmthing/ui/elements/content/card'
import { Badge } from '@lmthing/ui/elements/content/badge'
import { Button } from '@lmthing/ui/elements/forms/button'
import { Heading } from '@lmthing/ui/elements/typography/heading'
import { Caption } from '@lmthing/ui/elements/typography/caption'
import { EnvVars } from './env-vars'
import { Backup } from './backup'
import { BillingSection } from './billing-section'

export const Route = createFileRoute('/computer/settings')({
  component: Settings,
})

function Settings() {
  const { username, logout } = useAuth()
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
            <Caption muted>Logged in as</Caption>
            <Caption>{username}</Caption>
            <Button variant="ghost" size="sm" onClick={logout}>
              Log out
            </Button>
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
            <Heading level={4}>Environment Variables</Heading>
          </CardHeader>
          <CardBody>
            <Caption muted>
              Variables are injected into your compute pod at startup. Saving will restart your pod.
            </Caption>
            <EnvVars />
          </CardBody>
        </Card>

        <Backup />

        <BillingSection />
      </PageBody>
    </Page>
  )
}
