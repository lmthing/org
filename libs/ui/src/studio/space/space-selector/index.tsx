import * as Prim from '../../../elements/primitives/index.js';
import { useCallback, useMemo } from 'react'
import { useUIState, useToggle } from '@lmthing/state'
import { ChevronDown, Plus, Search, FolderOpen } from 'lucide-react'
import { Button } from '@lmthing/ui/elements/forms/button'
import { Input } from '@lmthing/ui/elements/forms/input'
import { Stack } from '@lmthing/ui/elements/layouts/stack'
import { Label } from '@lmthing/ui/elements/typography/label'
import { Caption } from '@lmthing/ui/elements/typography/caption'
import '@lmthing/css/components/space/index.css'

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
      <Button onClick={toggleIsOpen} variant="ghost" className="space-selector__trigger">
        <Label className="space-selector__trigger-label">
          {currentSpace ? currentSpace.name : 'Select Space'}
        </Label>
        <ChevronDown className="space-selector__chevron" />
      </Button>

      {isOpen && (
        <Prim.Box className="dropdown__content" position="absolute" top="100%" left={0} right={0} zIndex={50} marginTop="$1">
          <Prim.Box padding="$2" borderBottomWidth={1} borderBottomColor="$border">
            <Prim.Box position="relative">
              <Search className="space-selector__search-icon" />
              <Input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search spaces..."
                className="input--sm space-selector__search-input"
                autoFocus
              />
            </Prim.Box>
          </Prim.Box>

          <Prim.Box maxHeight="$64" overflowY="auto">
            {filteredSpaces.length === 0 ? (
              <Caption muted className="space-selector__empty">No spaces found</Caption>
            ) : (
              filteredSpaces.map((space) => (
                <Prim.Pressable
                  key={space.id}
                  onClick={() => handleSelect(space.id)}
                  className={`dropdown__item ${space.id === currentSpaceId ? 'list-item--selected' : ''}`}
                  width="100%"
                  textAlign="left"
                >
                  <FolderOpen className="space-selector__item-icon" />
                  <Prim.Text overflow="hidden" textOverflow="ellipsis" whiteSpace="nowrap">{space.name}</Prim.Text>
                </Prim.Pressable>
              ))
            )}
          </Prim.Box>

          <Prim.Box borderTopWidth={1} borderTopColor="$border" padding="$2">
            {showCreate ? (
              <Prim.Form onSubmit={handleCreate}>
                <Stack gap="sm" className="space-selector__create-form">
                  <Input type="text" value={newSpaceName} onChange={(e) => setNewSpaceName(e.target.value)} placeholder="Space name..." className="input--sm" autoFocus />
                  <Stack row gap="sm">
                    <Button type="submit" variant="primary" size="sm" className="space-selector__create-btn">Create</Button>
                    <Button type="button" onClick={() => setShowCreate(false)} variant="ghost" size="sm" className="space-selector__create-btn">Cancel</Button>
                  </Stack>
                </Stack>
              </Prim.Form>
            ) : (
              <Prim.Pressable onClick={() => setShowCreate(true)} className="dropdown__item" width="100%">
                <Plus className="space-selector__new-icon" /><Prim.Text>New Space</Prim.Text>
              </Prim.Pressable>
            )}
          </Prim.Box>
        </Prim.Box>
      )}
    </Prim.Box>
  )
}
