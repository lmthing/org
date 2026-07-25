import * as Prim from '../../../../elements/primitives/index.js';
import { Button } from '@lmthing/ui/elements/forms/button'
import { Card, CardBody, CardFooter } from '@lmthing/ui/elements/content/card'
import { Badge } from '@lmthing/ui/elements/content/badge'
import { Stack } from '@lmthing/ui/elements/layouts/stack'
import { PanelHeader } from '@lmthing/ui/elements/content/panel'
import { Label } from '@lmthing/ui/elements/typography/label'
import { Caption } from '@lmthing/ui/elements/typography/caption'
import { Code } from '@lmthing/ui/elements/typography/code'
import { ACTIONS_PANEL_BADGE_SM, ACTIONS_PANEL_CARD_DESCRIPTION, ACTIONS_PANEL_CARD_LABEL, ACTIONS_PANEL_CARD_META_ROW, ACTIONS_PANEL_CARD_ROW, ACTIONS_PANEL_CARD_TITLE_ROW, ACTIONS_PANEL_EMPTY, ACTIONS_PANEL_EMPTY_CAPTION, ACTIONS_PANEL_FOOTER_CAPTION, ACTIONS_PANEL_HEADER_ROW } from '../../props.js'

export interface AttachedWorkflow {
  workflowId: string
  workflowName: string
  stepCount: number
  slashAction: {
    id: string
    actionId: string
    name: string
    description: string
    enabled: boolean
  }
}

interface ActionsPanelProps {
  attachedWorkflows: AttachedWorkflow[]
  onToggleEnabled: (slashActionId: string, enabled: boolean) => void
  onEditAction: (slashActionId: string) => void
  onDetachWorkflow: (slashActionId: string) => void
  onOpenWorkflowBuilder: () => void
}

export function ActionsPanel({
  attachedWorkflows,
  onToggleEnabled,
  onEditAction,
  onDetachWorkflow,
  onOpenWorkflowBuilder,
}: ActionsPanelProps) {
  return (
    <Prim.Box display="flex" flexDirection="column" height="100%">
      <PanelHeader>
        <Stack row {...ACTIONS_PANEL_HEADER_ROW}>
          <Prim.Box>
            <Label compact>Slash Actions</Label>
            <Caption muted>Attach workflows with custom triggers</Caption>
          </Prim.Box>
          <Button onClick={onOpenWorkflowBuilder} variant="primary" size="sm">+ Attach Workflow</Button>
        </Stack>
      </PanelHeader>

      <Prim.Box flexGrow={1} flexShrink={1} flexBasis="0%" overflowY="auto" padding="$4">
        {attachedWorkflows.length === 0 ? (
          <Stack {...ACTIONS_PANEL_EMPTY}>
            <Prim.Text fontSize={32} marginBottom="$2">⚡</Prim.Text>
            <Label>No actions attached</Label>
            <Caption muted {...ACTIONS_PANEL_EMPTY_CAPTION}>
              Attach workflows to give users quick access to multi-step tasks
            </Caption>
            <Button onClick={onOpenWorkflowBuilder} variant="ghost" size="sm">Attach Your First Workflow</Button>
          </Stack>
        ) : (
          <Stack gap="sm">
            {attachedWorkflows.map(workflow => (
              <SlashActionCard
                key={workflow.slashAction.id}
                workflow={workflow}
                onToggleEnabled={onToggleEnabled}
                onEdit={onEditAction}
                onDetach={onDetachWorkflow}
              />
            ))}
          </Stack>
        )}
      </Prim.Box>

      <CardFooter>
        <Caption muted {...ACTIONS_PANEL_FOOTER_CAPTION}>
          Actions are invoked with <Code>/action</Code>
        </Caption>
      </CardFooter>
    </Prim.Box>
  )
}

function SlashActionCard({ workflow, onToggleEnabled, onEdit, onDetach }: {
  workflow: AttachedWorkflow
  onToggleEnabled: (slashActionId: string, enabled: boolean) => void
  onEdit: (slashActionId: string) => void
  onDetach: (slashActionId: string) => void
}) {
  return (
    <Card interactive>
      <CardBody>
        <Stack row gap="sm" {...ACTIONS_PANEL_CARD_ROW}>
          <Prim.Box flexShrink={0} fontSize={20}>⚡</Prim.Box>
          <Prim.Box flexGrow={1} flexShrink={1} flexBasis="0%" minWidth={0}>
            <Stack row gap="sm" {...ACTIONS_PANEL_CARD_TITLE_ROW}>
              <Code>/{workflow.slashAction.actionId}</Code>
              <Badge variant={workflow.slashAction.enabled ? 'success' : 'muted'} {...ACTIONS_PANEL_BADGE_SM}>
                {workflow.slashAction.enabled ? 'Active' : 'Disabled'}
              </Badge>
            </Stack>
            <Label {...ACTIONS_PANEL_CARD_LABEL}>{workflow.slashAction.name}</Label>
            <Caption muted {...ACTIONS_PANEL_CARD_DESCRIPTION}>{workflow.slashAction.description}</Caption>
            <Stack row gap="sm" {...ACTIONS_PANEL_CARD_META_ROW}>
              <Badge variant="muted" {...ACTIONS_PANEL_BADGE_SM}>{workflow.stepCount} step{workflow.stepCount > 1 ? 's' : ''}</Badge>
              <Caption muted>{workflow.workflowName}</Caption>
            </Stack>
          </Prim.Box>
          <Stack gap="sm">
            <Button
              onClick={() => onToggleEnabled(workflow.slashAction.id, !workflow.slashAction.enabled)}
              variant="ghost"
              size="sm"
              title={workflow.slashAction.enabled ? 'Disable' : 'Enable'}
            >
              {workflow.slashAction.enabled ? '✓' : '○'}
            </Button>
            <Button onClick={() => onEdit(workflow.slashAction.id)} variant="ghost" size="sm" title="Edit">✎</Button>
            <Button onClick={() => onDetach(workflow.slashAction.id)} variant="ghost" size="sm" title="Detach">✕</Button>
          </Stack>
        </Stack>
      </CardBody>
    </Card>
  )
}
