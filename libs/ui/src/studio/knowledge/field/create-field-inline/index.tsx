import * as Prim from '../../../../elements/primitives/index';
import { useUIState } from '@lmthing/state'
import { FolderPlus, X } from 'lucide-react'
import { Button } from '../../../../elements/forms/button'
import { Input } from '../../../../elements/forms/input'
import { Textarea } from '../../../../elements/forms/textarea'
import { Stack } from '../../../../elements/layouts/stack'
import { Label } from '../../../../elements/typography/label'
import { Caption } from '../../../../elements/typography/caption'
import { Heading } from '../../../../elements/typography/heading'
import { PANEL_BASE, PANEL_BODY, PANEL_HEADER } from '../../../../elements/content/panel/index'
import { CREATE_FIELD_INLINE_ACTIONS, CREATE_FIELD_INLINE_ACTION_BTN, CREATE_FIELD_INLINE_CLOSE_ICON, CREATE_FIELD_INLINE_HEADER_ROW, CREATE_FIELD_INLINE_ICON, CREATE_FIELD_INLINE_TITLE_ROW } from '../../props'

interface CreateFieldInlineProps {
    onSubmit: (name: string, description: string) => void
    onCancel: () => void
}

export function CreateFieldInline({ onSubmit, onCancel }: CreateFieldInlineProps) {
    const [name, setName] = useUIState<string>('create-field-inline.name', '')
    const [description, setDescription] = useUIState<string>('create-field-inline.description', '')

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault()
        if (name.trim()) {
            onSubmit(name.trim(), description.trim())
            setName('')
            setDescription('')
        }
    }

    return (
        <Prim.Box {...PANEL_BASE} marginBottom="$6">
            <Prim.Box {...PANEL_HEADER}>
                <Stack row gap="md" {...CREATE_FIELD_INLINE_HEADER_ROW}>
                    <Stack row gap="md" {...CREATE_FIELD_INLINE_TITLE_ROW}>
                        <FolderPlus {...CREATE_FIELD_INLINE_ICON} />
                        <Prim.Box>
                            <Heading level={3}>Create Knowledge Field</Heading>
                            <Caption muted>Define a new field of knowledge</Caption>
                        </Prim.Box>
                    </Stack>
                    <Button variant="ghost" size="icon" onClick={onCancel}>
                        <X {...CREATE_FIELD_INLINE_CLOSE_ICON} />
                    </Button>
                </Stack>
            </Prim.Box>
            <Prim.Box {...PANEL_BODY}>
                <Prim.Form onSubmit={handleSubmit}>
                    <Stack gap="md">
                        <Prim.Box>
                            <Label compact required>Name</Label>
                            <Input
                                type="text"
                                value={name}
                                onChange={(e) => setName(e.target.value)}
                                placeholder="e.g. Project Documentation"
                                autoFocus
                                required
                            />
                        </Prim.Box>
                        <Prim.Box>
                            <Label compact>Description (Optional)</Label>
                            <Textarea
                                value={description}
                                onChange={(e) => setDescription(e.target.value)}
                                placeholder="Brief description of this knowledge field"
                                compact
                            />
                        </Prim.Box>
                        <Stack row gap="sm" {...CREATE_FIELD_INLINE_ACTIONS}>
                            <Button variant="outline" onClick={onCancel} {...CREATE_FIELD_INLINE_ACTION_BTN}>
                                Cancel
                            </Button>
                            <Button variant="primary" type="submit" disabled={!name.trim()} {...CREATE_FIELD_INLINE_ACTION_BTN}>
                                Create Field
                            </Button>
                        </Stack>
                    </Stack>
                </Prim.Form>
            </Prim.Box>
        </Prim.Box>
    )
}
