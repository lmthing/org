/**
 * ComponentCodeEditor — raw TSX source editor pane for a single component
 * file, following the draft/save pattern shared with the agent-builder and
 * topic-editor.
 */
import * as Prim from '../../elements/primitives/index';
import { useCallback, useEffect, useRef } from 'react'
import { useSpaceFS, useFile, useUIState } from '@lmthing/state'
import { Stack } from '../../elements/layouts/stack'
import { Label } from '../../elements/typography/label'
import { Caption } from '../../elements/typography/caption'
import { Button } from '../../elements/forms/button'
import { componentNameFromPath, type ComponentKind } from './component-editor-utils'
import { INPUT_BASE } from '../../elements/forms/input/index'
import { COMPONENT_EDITOR_TEXTAREA } from './props'

/** `.component-editor__kind-badge--<kind>` tint modifier → per-kind style lookup. */
const KIND_BADGE_STYLE: Record<ComponentKind, { backgroundColor: string; color: string }> = {
  view: { backgroundColor: 'color-mix(in srgb, var(--knowledge) 15%, transparent)', color: '$knowledge' },
  form: { backgroundColor: 'color-mix(in srgb, var(--success) 15%, transparent)', color: '$success' },
}

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
    <Prim.Box display="flex" flexDirection="column" flexGrow={1} flexShrink={1} flexBasis="0%" gap="$2">
      <Prim.Box display="flex" alignItems="center" justifyContent="space-between">
        <Stack row gap="sm">
          <Label>{name}.tsx</Label>
          <Prim.Text fontSize={11} paddingVertical="$0.5" paddingHorizontal="$1.5" borderRadius="$radius-full" fontWeight="$semibold" textTransform="uppercase" letterSpacing="0.04em" {...KIND_BADGE_STYLE[kind]}>
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
        {...INPUT_BASE} {...COMPONENT_EDITOR_TEXTAREA}
        value={draft}
        onChange={e => handleChange(e.target.value)}
        onKeyDown={handleKeyDown}
        spellCheck={false}
        placeholder="// Write TSX source here — import only from '@lmthing/ui'…"
      />
    </Prim.Box>
  )
}
