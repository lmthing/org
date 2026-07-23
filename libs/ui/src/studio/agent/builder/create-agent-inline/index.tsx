import * as Prim from '../../../../elements/primitives/index.js';
import '@lmthing/css/components/agent/builder/index.css'
import { useUIState } from '@lmthing/state'
import { Bot, X } from 'lucide-react'
import { Button } from '@lmthing/ui/elements/forms/button'
import { Input } from '@lmthing/ui/elements/forms/input'
import { Card, CardHeader, CardBody } from '@lmthing/ui/elements/content/card'
import { Stack } from '@lmthing/ui/elements/layouts/stack'
import { Label } from '@lmthing/ui/elements/typography/label'
import { Caption } from '@lmthing/ui/elements/typography/caption'

interface CreateAgentInlineProps {
  onSubmit: (title: string) => void
  onCancel: () => void
}

export function CreateAgentInline({ onSubmit, onCancel }: CreateAgentInlineProps) {
  const [title, setTitle] = useUIState('create-agent-inline.title', '')

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (title.trim()) { onSubmit(title.trim()); setTitle('') }
  }

  return (
    <Card className="create-agent-inline">
      <CardHeader>
        <Stack row className="create-agent-inline__header-row">
          <Stack row gap="sm" className="create-agent-inline__header-left">
            <Prim.Box className="create-agent-inline__avatar">
              <Bot className="create-agent-inline__avatar-icon" />
            </Prim.Box>
            <Prim.Box>
              <Label>New Agent</Label>
              <Caption muted>Define a new AI agent</Caption>
            </Prim.Box>
          </Stack>
          <Button onClick={onCancel} variant="ghost" size="sm"><X className="create-agent-inline__close-icon" /></Button>
        </Stack>
      </CardHeader>
      <CardBody>
        <Prim.Form onSubmit={handleSubmit}>
          <Stack gap="sm">
            <Prim.Box>
              <Label compact required>Title</Label>
              <Input type="text" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Assessment Agent" autoFocus required />
            </Prim.Box>
            <Stack row gap="sm" className="create-agent-inline__actions">
              <Button type="button" onClick={onCancel} variant="ghost" className="create-agent-inline__btn">Cancel</Button>
              <Button type="submit" disabled={!title.trim()} variant="primary" className="create-agent-inline__btn">Create</Button>
            </Stack>
          </Stack>
        </Prim.Form>
      </CardBody>
    </Card>
  )
}
