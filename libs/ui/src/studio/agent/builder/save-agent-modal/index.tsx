import * as Prim from '../../../../elements/primitives/index';
import { useCallback, useEffect } from 'react'
import { useUIState } from '@lmthing/state'
import { Button } from '../../../../elements/forms/button'
import { Input } from '../../../../elements/forms/input'
import { Textarea } from '../../../../elements/forms/textarea'
import { Stack } from '../../../../elements/layouts/stack'
import { Heading } from '../../../../elements/typography/heading'
import { Label } from '../../../../elements/typography/label'
import { Caption } from '../../../../elements/typography/caption'
import { CardFooter } from '../../../../elements/content/card'
import { DIALOG_BACKDROP, DIALOG_CONTENT, DIALOG_HEADER } from '../../../../elements/overlays/dialog/index'
import { SAVE_AGENT_MODAL_FOOTER, SAVE_AGENT_MODAL_FORM, SAVE_AGENT_MODAL_HEADER_ROW, SAVE_AGENT_MODAL_ICON } from '../../props'

interface SaveAgentModalProps {
  isOpen: boolean
  onClose: () => void
  onSave: (name: string, description: string) => void
}

/**
 * `.save-agent-modal__icon-wrap` — the sweep skips it because a `linear-gradient` is not a colour
 * the prop table maps; `backgroundImage` takes it verbatim.
 */
const ICON_WRAP = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: '2.5rem',
  height: '2.5rem',
  borderRadius: '0.75rem',
  backgroundImage: 'linear-gradient(135deg, var(--agent), color-mix(in srgb, var(--agent) 80%, black))',
} as const

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
    <Prim.Box {...DIALOG_BACKDROP}>
      <Prim.Box {...DIALOG_CONTENT} maxWidth={448}>
        <Prim.Box {...DIALOG_HEADER}>
          <Stack row gap="sm" {...SAVE_AGENT_MODAL_HEADER_ROW}>
            <Prim.Box {...ICON_WRAP}>
              <Prim.Svg {...SAVE_AGENT_MODAL_ICON} fill="none" viewBox="0 0 24 24" stroke="currentColor">
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

        <Stack gap="md" {...SAVE_AGENT_MODAL_FORM}>
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

        <CardFooter {...SAVE_AGENT_MODAL_FOOTER}>
          <Button onClick={onClose} variant="ghost">Cancel</Button>
          <Button onClick={handleSave} disabled={!name.trim()} variant="primary">Save Agent</Button>
        </CardFooter>
      </Prim.Box>
    </Prim.Box>
  )
}
