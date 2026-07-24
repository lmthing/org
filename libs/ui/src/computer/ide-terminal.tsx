import * as Prim from '../elements/primitives/index.js';
import { Terminal } from '../elements/content/terminal'
import type { TerminalSession } from '../elements/content/terminal'
import { X, Plus } from 'lucide-react'

export interface TerminalTab {
  id: string
  label: string
  session: TerminalSession | null
  readonly?: boolean
}

export interface IdeTerminalProps {
  tabs: TerminalTab[]
  activeTabId: string | null
  onTabSelect: (id: string) => void
  onTabClose?: (id: string) => void
  onAddTab?: () => void
}

function IdeTerminal({ tabs, activeTabId, onTabSelect, onTabClose, onAddTab }: IdeTerminalProps) {
  const resolvedActiveId = activeTabId ?? tabs[0]?.id ?? null

  return (
    <Prim.Box
      height="100%"
      display="flex"
      flexDirection="column"
      backgroundColor="$background"
    >
      <Prim.Box
        display="flex"
        alignItems="stretch"
        backgroundColor="$card"
        borderBottomWidth={1}
        borderBottomColor="$border"
        flexShrink={0}
        overflowX="auto"
      >
        {tabs.map((tab) => (
          <Prim.Box
            key={tab.id}
            display="flex"
            alignItems="center"
            gap="$1"
            paddingHorizontal="$3"
            paddingVertical="$1.5"
            fontSize="$xs"
            color="$muted-foreground"
            cursor="pointer"
            flexShrink={0}
            userSelect="none"
            whiteSpace="nowrap"
            hoverStyle={{ backgroundColor: '$accent', color: '$foreground' }}
            {...(tab.id === resolvedActiveId ? { backgroundColor: '$background', color: '$foreground' } : {})}
            onClick={() => onTabSelect(tab.id)}
          >
            {tab.label}
            {onTabClose && !tab.readonly && tabs.filter(t => !t.readonly).length > 0 && (
              <Prim.Pressable
                display="flex"
                alignItems="center"
                justifyContent="center"
                borderRadius="$radius"
                width="$4"
                height="$4"
                opacity={0.5}
                hoverStyle={{ opacity: 1, backgroundColor: 'color-mix(in srgb, var(--muted) 80%, transparent)' }}
                onClick={(e) => { e.stopPropagation(); onTabClose(tab.id) }}
                aria-label="Close tab"
              >
                <X size={10} />
              </Prim.Pressable>
            )}
          </Prim.Box>
        ))}
        {onAddTab && (
          <Prim.Box
            display="flex"
            alignItems="center"
            paddingHorizontal="$2"
            color="$muted-foreground"
            cursor="pointer"
            hoverStyle={{ color: '$foreground', backgroundColor: '$accent' }}
            onClick={onAddTab}
            title="New terminal"
          >
            <Plus size={13} />
          </Prim.Box>
        )}
      </Prim.Box>
      <Prim.Box
        flexGrow={1}
        flexShrink={1}
        flexBasis="0%"
        minHeight={0}
        position="relative"
      >
        {tabs.map((tab) => (
          <Prim.Box
            key={tab.id}
            position="absolute"
            top={0}
            right={0}
            bottom={0}
            left={0}
            {...(tab.id !== resolvedActiveId ? { visibility: 'hidden', pointerEvents: 'none' } : {})}
          >
            <Terminal session={tab.session} readonly={tab.readonly} />
          </Prim.Box>
        ))}
      </Prim.Box>
    </Prim.Box>
  )
}

export { IdeTerminal }
