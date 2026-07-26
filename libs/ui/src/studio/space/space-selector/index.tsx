import * as Prim from '../../../elements/primitives/index';
import { useCallback, useMemo } from 'react'
import { useUIState, useToggle } from '@lmthing/state'
import { ChevronDown, Plus, Search, FolderOpen } from 'lucide-react'
import { Button } from '../../../elements/forms/button'
import { Input } from '../../../elements/forms/input'
import { Stack } from '../../../elements/layouts/stack'
import { Label } from '../../../elements/typography/label'
import { Caption } from '../../../elements/typography/caption'
import { INPUT_BASE, INPUT_SM } from '../../../elements/forms/input/index'
import { DROPDOWN_CONTENT, DROPDOWN_ITEM } from '../../../elements/overlays/dropdown/index'
import { SPACE_SELECTOR_CHEVRON, SPACE_SELECTOR_CREATE_BTN, SPACE_SELECTOR_CREATE_FORM, SPACE_SELECTOR_EMPTY, SPACE_SELECTOR_ITEM_ICON, SPACE_SELECTOR_NEW_ICON, SPACE_SELECTOR_SEARCH_ICON, SPACE_SELECTOR_SEARCH_INPUT, SPACE_SELECTOR_TRIGGER, SPACE_SELECTOR_TRIGGER_LABEL } from '../props'

export interface SpaceEntry {
  id: string
  name: string
  description?: string
}

interface SpaceSelectorProps {
  spaces: SpaceEntry[]
  currentSpaceId?: string | null
  onSelectSpace?: (spaceId: string) => void
  onCreateSpace?: (name: string) => void
}

export function SpaceSelector({ spaces, currentSpaceId, onSelectSpace, onCreateSpace }: SpaceSelectorProps) {
  const [isOpen, toggleIsOpen, setIsOpen] = useToggle('space-selector.is-open', false)
  const [searchQuery, setSearchQuery] = useUIState('space-selector.search-query', '')
  const [showCreate, , setShowCreate] = useToggle('space-selector.show-create', false)
  const [newSpaceName, setNewSpaceName] = useUIState('space-selector.new-space-name', '')

  const currentSpace = useMemo(() => spaces.find(s => s.id === currentSpaceId), [spaces, currentSpaceId])
  const filteredSpaces = useMemo(() => spaces.filter(s => s.name.toLowerCase().includes(searchQuery.toLowerCase())), [spaces, searchQuery])

  const handleSelect = useCallback((spaceId: string) => { onSelectSpace?.(spaceId); setIsOpen(false); setSearchQuery('') }, [onSelectSpace])
  const handleCreate = useCallback((e: React.FormEvent) => {
    e.preventDefault()
    if (newSpaceName.trim()) { onCreateSpace?.(newSpaceName.trim()); setNewSpaceName(''); setShowCreate(false); setIsOpen(false) }
  }, [newSpaceName, onCreateSpace])

  return (
    <Prim.Box position="relative">
      <Button onClick={toggleIsOpen} variant="ghost" {...SPACE_SELECTOR_TRIGGER}>
        <Label {...SPACE_SELECTOR_TRIGGER_LABEL}>
          {currentSpace ? currentSpace.name : 'Select Space'}
        </Label>
        <ChevronDown {...SPACE_SELECTOR_CHEVRON} />
      </Button>

      {isOpen && (
        <Prim.Box {...DROPDOWN_CONTENT} position="absolute" top="100%" left={0} right={0} zIndex={50} marginTop="$1">
          <Prim.Box padding="$2" borderBottomWidth={1} borderBottomColor="$border">
            <Prim.Box position="relative">
              <Search {...SPACE_SELECTOR_SEARCH_ICON} />
              <Input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search spaces..."
                {...INPUT_BASE} {...INPUT_SM} {...SPACE_SELECTOR_SEARCH_INPUT}
                autoFocus
              />
            </Prim.Box>
          </Prim.Box>

          <Prim.Box maxHeight="$64" overflowY="auto">
            {filteredSpaces.length === 0 ? (
              <Caption muted {...SPACE_SELECTOR_EMPTY}>No spaces found</Caption>
            ) : (
              filteredSpaces.map((space) => (
                <Prim.Pressable
                  key={space.id}
                  onClick={() => handleSelect(space.id)}
                  {...DROPDOWN_ITEM}
                  {...(space.id === currentSpaceId
                    ? { backgroundColor: '$accent', color: '$accent-foreground', fontWeight: '$medium' }
                    : {})}
                  width="100%"
                  textAlign="left"
                >
                  <FolderOpen {...SPACE_SELECTOR_ITEM_ICON} />
                  <Prim.Text overflow="hidden" textOverflow="ellipsis" whiteSpace="nowrap">{space.name}</Prim.Text>
                </Prim.Pressable>
              ))
            )}
          </Prim.Box>

          <Prim.Box borderTopWidth={1} borderTopColor="$border" padding="$2">
            {showCreate ? (
              <Prim.Form onSubmit={handleCreate}>
                <Stack gap="sm" {...SPACE_SELECTOR_CREATE_FORM}>
                  <Input type="text" value={newSpaceName} onChange={(e) => setNewSpaceName(e.target.value)} placeholder="Space name..." {...INPUT_BASE} {...INPUT_SM} autoFocus />
                  <Stack row gap="sm">
                    <Button type="submit" variant="primary" size="sm" {...SPACE_SELECTOR_CREATE_BTN}>Create</Button>
                    <Button type="button" onClick={() => setShowCreate(false)} variant="ghost" size="sm" {...SPACE_SELECTOR_CREATE_BTN}>Cancel</Button>
                  </Stack>
                </Stack>
              </Prim.Form>
            ) : (
              <Prim.Pressable onClick={() => setShowCreate(true)} {...DROPDOWN_ITEM} width="100%">
                <Plus {...SPACE_SELECTOR_NEW_ICON} /><Prim.Text>New Space</Prim.Text>
              </Prim.Pressable>
            )}
          </Prim.Box>
        </Prim.Box>
      )}
    </Prim.Box>
  )
}
