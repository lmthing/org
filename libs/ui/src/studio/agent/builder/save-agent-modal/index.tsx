import * as Prim from '../../../../elements/primitives/index.js';
import '@lmthing/css/components/agent/builder/index.css'
import { useCallback, useEffect } from 'react'
import { useUIState } from '@lmthing/state'
import { Button } from '@lmthing/ui/elements/forms/button'
import { Input } from '@lmthing/ui/elements/forms/input'
import { Textarea } from '@lmthing/ui/elements/forms/textarea'
import { Stack } from '@lmthing/ui/elements/layouts/stack'
import { Heading } from '@lmthing/ui/elements/typography/heading'
import { Label } from '@lmthing/ui/elements/typography/label'
import { Caption } from '@lmthing/ui/elements/typography/caption'
import { CardFooter } from '@lmthing/ui/elements/content/card'

interface SaveAgentModalProps {
  isOpen: boolean
  onClose: () => void
  onSave: (name: string, description: string) => void
}

export function SaveAgentModal({ isOpen, onClose, onSave }: SaveAgentModalProps) {
  const [name, setName] = useUIState('save-modal.name', '')
  const [description, setDescription] = useUIState('save-modal.description', '')

  useEffect(() => { if (isOpen) { setName(''); setDescription('') } }, [isOpen])

  const handleSave = useCallback(() => {
    if (name.trim()) { onSave(name.trim(), description.trim()); setName(''); setDescription('') }
  }, [name, description, onSave])

  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (e.key === 'Escape') onClose()
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) handleSave()
  }, [onClose, handleSave])

  useEffect(() => {
    if (isOpen) {
      document.addEventListener('keydown', handleKeyDown)
      return () => document.removeEventListener('keydown', handleKeyDown)
    }
  }, [isOpen, handleKeyDown])

  if (!isOpen) return null

  return (
    <Prim.Box className="dialog__backdrop">
      <Prim.Box className="dialog__content" maxWidth={448}>
        <Prim.Box className="dialog__header">
          <Stack row gap="sm" className="save-agent-modal__header-row">
            <Prim.Box className="save-agent-modal__icon-wrap">
              <Prim.Svg className="save-agent-modal__icon" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <Prim.Path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7H5a2 2 0 00-2 2v9a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-3m-1 4l-3 3m0 0l-3-3m3 3V4" />
              </Prim.Svg>
            </Prim.Box>
            <Prim.Box>
              <Heading level={3}>Save Agent</Heading>
              <Caption muted>Save this agent configuration for future reuse</Caption>
            </Prim.Box>
          </Stack>
          <Button onClick={onClose} variant="ghost" size="sm">✕</Button>
        </Prim.Box>

        <Stack gap="md" className="save-agent-modal__form">
          <Prim.Box>
            <Label compact required>Agent Name</Label>
            <Input type="text" value={name} onChange={e => setName(e.target.value)} placeholder="e.g., Security Auditor" autoFocus />
          </Prim.Box>
          <Prim.Box>
            <Label compact>Description</Label>
            <Textarea value={description} onChange={e => setDescription(e.target.value)} placeholder="Briefly describe what this agent does..." rows={3} />
          </Prim.Box>
          <Caption muted>Saved agents can be loaded from the Saved Agents view</Caption>
        </Stack>

        <CardFooter className="save-agent-modal__footer">
          <Button onClick={onClose} variant="ghost">Cancel</Button>
          <Button onClick={handleSave} disabled={!name.trim()} variant="primary">Save Agent</Button>
        </CardFooter>
      </Prim.Box>
    </Prim.Box>
  )
}
