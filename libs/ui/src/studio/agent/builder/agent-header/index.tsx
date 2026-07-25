import * as Prim from '../../../../elements/primitives/index.js';
import { Stack } from '@lmthing/ui/elements/layouts/stack'
import { Button } from '@lmthing/ui/elements/forms/button'
import { Input } from '@lmthing/ui/elements/forms/input'
import { ArrowLeft } from 'lucide-react'
import { INPUT_BASE, INPUT_SM } from '../../../../elements/forms/input/index.js'
import { AGENT_HEADER_ICON, AGENT_HEADER_LEFT, AGENT_HEADER_RIGHT } from '../../props.js'

export interface AgentHeaderProps {
  title: string
  isNew: boolean
  hasUnsavedChanges: boolean
  isValid: boolean
  onTitleChange: (title: string) => void
  onSave: () => void
  onBack: () => void
}

export function AgentHeader({
  title,
  isNew,
  hasUnsavedChanges,
  isValid,
  onTitleChange,
  onSave,
  onBack,
}: AgentHeaderProps) {
  return (
    <Prim.Box as="header" display="flex" alignItems="center" justifyContent="space-between" flexShrink={0} paddingVertical="$3" paddingHorizontal="$4" borderBottomWidth={1} borderBottomColor="$border">
      <Stack row {...AGENT_HEADER_LEFT}>
        <Button variant="ghost" size="icon" onClick={onBack}>
          <ArrowLeft {...AGENT_HEADER_ICON} />
        </Button>
        <Input
          value={title}
          onChange={e => onTitleChange(e.target.value)}
          placeholder="Agent title"
          {...INPUT_BASE} {...INPUT_SM} className="agent-header__name-input"
        />
      </Stack>
      <Stack row gap="sm" {...AGENT_HEADER_RIGHT}>
        {hasUnsavedChanges && (
          <Button variant="primary" size="sm" onClick={onSave} disabled={!isValid}>
            {isNew ? 'Create' : 'Save'}
          </Button>
        )}
      </Stack>
    </Prim.Box>
  )
}
