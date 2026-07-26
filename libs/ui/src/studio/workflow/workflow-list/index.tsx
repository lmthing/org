/**
 * TasklistList — list view for all tasklists in the current space.
 */
import * as Prim from '../../../elements/primitives/index';
import { useMemo } from 'react'
import { useUIState } from '@lmthing/state'
import type { TasklistListItem as TLItem } from '@lmthing/state'
import { TasklistCard, TasklistListItem } from '../workflow-card'
import { Button } from '../../../elements/forms/button'
import { Input } from '../../../elements/forms/input'
import { Stack } from '../../../elements/layouts/stack'
import { Page, PageHeader, PageBody } from '../../../elements/layouts/page'
import { Heading } from '../../../elements/typography/heading'
import { Caption } from '../../../elements/typography/caption'
import { WORKFLOW_LIST_CREATE_ICON, WORKFLOW_LIST_EMPTY_FIRST_CAPTION, WORKFLOW_LIST_EMPTY_FIRST_ICON, WORKFLOW_LIST_FILTERS, WORKFLOW_LIST_SEARCH_ICON, WORKFLOW_LIST_SEARCH_INPUT, WORKFLOW_LIST_STATS, WORKFLOW_LIST_STAT_ROW, WORKFLOW_LIST_VIEW_ICON } from '../workflow-list.props'

interface TasklistListProps {
  tasklists: TLItem[]
  selectedName: string | null
  onSelectTasklist: (name: string) => void
  onCreateTasklist: () => void
  onDeleteTasklist: (name: string) => void
}

type ViewMode = 'grid' | 'list'

export function TasklistList({
  tasklists,
  selectedName,
  onSelectTasklist,
  onCreateTasklist,
  onDeleteTasklist,
}: TasklistListProps) {
  const [viewMode, setViewMode] = useUIState<ViewMode>('tasklist-list.view-mode', 'grid')
  const [searchQuery, setSearchQuery] = useUIState('tasklist-list.search-query', '')

  const filteredTasklists = useMemo(() => {
    if (!searchQuery) return tasklists
    const q = searchQuery.toLowerCase()
    return tasklists.filter((tl) => tl.name.toLowerCase().includes(q))
  }, [tasklists, searchQuery])

  return (
    <Page>
      <PageHeader>
        <Prim.Box
          maxWidth="72rem"
          marginHorizontal="auto"
          paddingVertical="$6"
          paddingLeft="$4"
          paddingRight="$4"
          $gtXs={{ paddingLeft: '$6', paddingRight: '$6' }}
          $gtMd={{ paddingLeft: '$8', paddingRight: '$8' }}
        >
          <Prim.Box display="flex" justifyContent="space-between" alignItems="center" marginBottom="$6">
            <Prim.Box>
              <Heading level={1}>Tasklists</Heading>
              <Caption muted>Define ordered task DAGs for agent action flows</Caption>
            </Prim.Box>
            <Button variant="primary" onClick={onCreateTasklist}>
              <Prim.Svg {...WORKFLOW_LIST_CREATE_ICON} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <Prim.Path d="M12 5v14M5 12h14" />
              </Prim.Svg>
              New Tasklist
            </Button>
          </Prim.Box>

          {/* Stats */}
          <Stack row gap="lg" {...WORKFLOW_LIST_STATS}>
            <Stack row gap="sm" {...WORKFLOW_LIST_STAT_ROW}>
              <Prim.Text fontSize="$2xl" fontWeight="$bold" color="$foreground">{tasklists.length}</Prim.Text>
              <Caption muted>total</Caption>
            </Stack>
          </Stack>

          {/* Search + view toggle */}
          <Stack row gap="md" {...WORKFLOW_LIST_FILTERS}>
            <Prim.Box position="relative" flexGrow={1} flexShrink={1} flexBasis="0%" maxWidth="28rem">
              <Prim.Svg
                {...WORKFLOW_LIST_SEARCH_ICON}
                viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
              >
                <Prim.Circle cx="11" cy="11" r="8" />
                <Prim.Path d="M21 21l-4.35-4.35" />
              </Prim.Svg>
              <Input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search tasklists…"
                {...WORKFLOW_LIST_SEARCH_INPUT}
              />
            </Prim.Box>

            {/* View toggle */}
            <Prim.Box display="flex" alignItems="center" gap="$1" padding="$1" backgroundColor="$muted" borderRadius="0.5rem">
              <Prim.Pressable
                onClick={() => setViewMode('grid')}
                padding="$2"
                borderRadius="$radius-md"
                transition="quick"
                {...(viewMode === 'grid'
                  ? {
                      backgroundColor: '$card',
                      color: '$brand-3',
                      shadowColor: 'rgba(0,0,0,0.05)',
                      shadowOffset: { width: 0, height: 1 },
                      shadowRadius: 2,
                    }
                  : { color: '$muted-foreground', hoverStyle: { color: '$foreground' } })}
                title="Grid view"
              >
                <Prim.Svg {...WORKFLOW_LIST_VIEW_ICON} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <Prim.Rect x="3" y="3" width="7" height="7" />
                  <Prim.Rect x="14" y="3" width="7" height="7" />
                  <Prim.Rect x="14" y="14" width="7" height="7" />
                  <Prim.Rect x="3" y="14" width="7" height="7" />
                </Prim.Svg>
              </Prim.Pressable>
              <Prim.Pressable
                onClick={() => setViewMode('list')}
                padding="$2"
                borderRadius="$radius-md"
                transition="quick"
                {...(viewMode === 'list'
                  ? {
                      backgroundColor: '$card',
                      color: '$brand-3',
                      shadowColor: 'rgba(0,0,0,0.05)',
                      shadowOffset: { width: 0, height: 1 },
                      shadowRadius: 2,
                    }
                  : { color: '$muted-foreground', hoverStyle: { color: '$foreground' } })}
                title="List view"
              >
                <Prim.Svg {...WORKFLOW_LIST_VIEW_ICON} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <Prim.Path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01" />
                </Prim.Svg>
              </Prim.Pressable>
            </Prim.Box>
          </Stack>
        </Prim.Box>
      </PageHeader>

      <PageBody>
        <Prim.Box
          maxWidth="72rem"
          marginHorizontal="auto"
          paddingVertical="$8"
          paddingLeft="$4"
          paddingRight="$4"
          $gtXs={{ paddingLeft: '$6', paddingRight: '$6' }}
          $gtMd={{ paddingLeft: '$8', paddingRight: '$8' }}
        >
          {filteredTasklists.length === 0 ? (
            tasklists.length === 0 ? (
              <Prim.Box
                textAlign="center"
                backgroundColor="$card"
                borderRadius="1rem"
                borderWidth={2}
                borderStyle="dashed"
                borderColor="$border"
                padding="$16"
              >
                <Prim.Box
                  width="$20"
                  height="$20"
                  display="flex"
                  alignItems="center"
                  justifyContent="center"
                  marginHorizontal="auto"
                  borderRadius="1rem"
                  backgroundColor="$brand-3"
                  marginBottom="$6"
                  shadowColor="color-mix(in srgb, var(--brand-3) 25%, transparent)"
                  shadowOffset={{ width: 0, height: 20 }}
                  shadowRadius={25}
                >
                  <Prim.Svg {...WORKFLOW_LIST_EMPTY_FIRST_ICON} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <Prim.Path d="M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2" />
                    <Prim.Rect x="9" y="3" width="6" height="4" rx="1" />
                    <Prim.Path d="M9 12h6M9 16h4" />
                  </Prim.Svg>
                </Prim.Box>
                <Heading level={2}>Create your first tasklist</Heading>
                <Caption muted {...WORKFLOW_LIST_EMPTY_FIRST_CAPTION}>
                  Tasklists define the ordered steps agents execute when a slash action is triggered.
                </Caption>
                <Button variant="primary" onClick={onCreateTasklist}>
                  <Prim.Svg {...WORKFLOW_LIST_CREATE_ICON} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <Prim.Path d="M12 5v14M5 12h14" />
                  </Prim.Svg>
                  Create Tasklist
                </Button>
              </Prim.Box>
            ) : (
              <Prim.Box textAlign="center" backgroundColor="$card" borderRadius="0.75rem" padding="$12">
                <Heading level={3}>No tasklists match your search</Heading>
                <Caption muted>Try a different name</Caption>
              </Prim.Box>
            )
          ) : (
            <Prim.Box
              {...(viewMode === 'grid'
                ? {
                    display: 'grid',
                    gridTemplateColumns: 'repeat(1, minmax(0, 1fr))',
                    gap: '$4',
                    $gtSm: { gridTemplateColumns: 'repeat(2, minmax(0, 1fr))' },
                    $gtMd: { gridTemplateColumns: 'repeat(3, minmax(0, 1fr))' },
                  }
                : { display: 'flex', flexDirection: 'column', gap: '$2' })}
            >
              {filteredTasklists.map((tl) =>
                viewMode === 'grid' ? (
                  <TasklistCard
                    key={tl.name}
                    tasklist={tl}
                    isSelected={selectedName === tl.name}
                    onSelect={() => onSelectTasklist(tl.name)}
                    onDelete={() => onDeleteTasklist(tl.name)}
                  />
                ) : (
                  <TasklistListItem
                    key={tl.name}
                    tasklist={tl}
                    isSelected={selectedName === tl.name}
                    onSelect={() => onSelectTasklist(tl.name)}
                    onDelete={() => onDeleteTasklist(tl.name)}
                  />
                )
              )}
            </Prim.Box>
          )}
        </Prim.Box>
      </PageBody>
    </Page>
  )
}

/** @deprecated Use TasklistList */
export { TasklistList as WorkflowList }
