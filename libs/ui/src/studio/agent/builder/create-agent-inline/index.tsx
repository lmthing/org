import * as Prim from '../../../../elements/primitives/index';
import { useUIState } from '@lmthing/state'
import { Bot, X } from 'lucide-react'
import { Button } from '../../../../elements/forms/button'
import { Input } from '../../../../elements/forms/input'
import { Card, CardHeader, CardBody } from '../../../../elements/content/card'
import { Stack } from '../../../../elements/layouts/stack'
import { Label } from '../../../../elements/typography/label'
import { Caption } from '../../../../elements/typography/caption'
import { CREATE_AGENT_INLINE, CREATE_AGENT_INLINE_ACTIONS, CREATE_AGENT_INLINE_AVATAR_ICON, CREATE_AGENT_INLINE_BTN, CREATE_AGENT_INLINE_CLOSE_ICON, CREATE_AGENT_INLINE_HEADER_LEFT, CREATE_AGENT_INLINE_HEADER_ROW } from '../../props'

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
    <Card {...CREATE_AGENT_INLINE}>
      <CardHeader>
        <Stack row {...CREATE_AGENT_INLINE_HEADER_ROW}>
          <Stack row gap="sm" {...CREATE_AGENT_INLINE_HEADER_LEFT}>
            <Prim.Box display="flex" alignItems="center" justifyContent="center" padding="$2" backgroundColor="$agent" borderRadius={8}>
              <Bot {...CREATE_AGENT_INLINE_AVATAR_ICON} />
            </Prim.Box>
            <Prim.Box>
              <Label>New Agent</Label>
              <Caption muted>Define a new AI agent</Caption>
            </Prim.Box>
          </Stack>
          <Button onClick={onCancel} variant="ghost" size="sm"><X {...CREATE_AGENT_INLINE_CLOSE_ICON} /></Button>
        </Stack>
      </CardHeader>
      <CardBody>
        <Prim.Form onSubmit={handleSubmit}>
          <Stack gap="sm">
            <Prim.Box>
              <Label compact required>Title</Label>
              <Input type="text" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Assessment Agent" autoFocus required />
            </Prim.Box>
            <Stack row gap="sm" {...CREATE_AGENT_INLINE_ACTIONS}>
              <Button type="button" onClick={onCancel} variant="ghost" {...CREATE_AGENT_INLINE_BTN}>Cancel</Button>
              <Button type="submit" disabled={!title.trim()} variant="primary" {...CREATE_AGENT_INLINE_BTN}>Create</Button>
            </Stack>
          </Stack>
        </Prim.Form>
      </CardBody>
    </Card>
  )
}
