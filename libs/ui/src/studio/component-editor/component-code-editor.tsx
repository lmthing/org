/**
 * ComponentCodeEditor — raw TSX source editor pane for a single component
 * file, following the draft/save pattern shared with the agent-builder and
 * topic-editor.
 */
import * as Prim from '../../elements/primitives/index.js';
import { useCallback, useEffect, useRef } from 'react'
import { useSpaceFS, useFile, useUIState } from '@lmthing/state'
import { Stack } from '@lmthing/ui/elements/layouts/stack'
import { Label } from '@lmthing/ui/elements/typography/label'
import { Caption } from '@lmthing/ui/elements/typography/caption'
import { Button } from '@lmthing/ui/elements/forms/button'
import { componentNameFromPath, type ComponentKind } from './component-editor-utils'

interface ComponentCodeEditorProps {
  componentPath: string
  kind: ComponentKind
}

export function ComponentCodeEditor({ componentPath, kind }: ComponentCodeEditorProps) {
  const spaceFS = useSpaceFS()
  const rawContent = useFile(componentPath)
  const name = componentNameFromPath(componentPath)

  const [draft, setDraft] = useUIState<string>(`comp-editor.${componentPath}.draft`, '')
  const [hasUnsaved, setHasUnsaved] = useUIState<boolean>(`comp-editor.${componentPath}.unsaved`, false)

  // Sync draft when file content changes
  const syncKey = `${componentPath}::${rawContent ?? ''}`
  const lastSyncKey = useRef('')
  useEffect(() => {
    if (lastSyncKey.current === syncKey) return
    lastSyncKey.current = syncKey
    if (rawContent !== null && rawContent !== undefined) {
      setDraft(rawContent)
      setHasUnsaved(false)
    }
  })

  const handleChange = useCallback((value: string) => {
    setDraft(value)
    setHasUnsaved(true)
  }, [setDraft, setHasUnsaved])

  const handleSave = useCallback(() => {
    if (!spaceFS || !hasUnsaved) return
    spaceFS.writeFile(componentPath, draft)
    setHasUnsaved(false)
  }, [spaceFS, componentPath, draft, hasUnsaved, setHasUnsaved])

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 's') {
      e.preventDefault()
      handleSave()
    }
  }, [handleSave])

  return (
    <Prim.Box className="component-editor__pane">
      <Prim.Box className="component-editor__pane-header">
        <Stack row gap="sm">
          <Label>{name}.tsx</Label>
          <Prim.Text className={`component-editor__kind-badge component-editor__kind-badge--${kind}`}>
            {kind}
          </Prim.Text>
          <Caption muted>{componentPath}</Caption>
        </Stack>
        <Stack row gap="sm">
          {hasUnsaved && <Caption muted>Unsaved</Caption>}
          <Button
            variant="primary"
            size="sm"
            disabled={!hasUnsaved}
            onClick={handleSave}
          >
            Save
          </Button>
        </Stack>
      </Prim.Box>

      <Prim.TextArea
        className="input component-editor__textarea"
        value={draft}
        onChange={e => handleChange(e.target.value)}
        onKeyDown={handleKeyDown}
        spellCheck={false}
        placeholder="// Write TSX source here — import only from '@lmthing/ui'…"
      />
    </Prim.Box>
  )
}
