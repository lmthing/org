import * as Prim from '../elements/primitives/index';
import { CozyThingText } from '@lmthing/ui/elements/branding/cozy-text'
import { Badge } from '../elements/content/badge'
import { Loader2 } from 'lucide-react'
import { IdeFileTree, type FileTreeNode } from './ide-file-tree'
import { IdeEditor } from './ide-editor'
import { IdeTerminal, type TerminalTab } from './ide-terminal'

export type { TerminalTab }

export interface IdeLayoutProps {
  // Status
  status: string
  isBooting: boolean
  isInstalling: boolean

  // File tree
  fileTree: FileTreeNode[]
  activeFile: string | null
  onFileSelect: (path: string) => void
  onCreateFile: (parentPath: string, name: string) => void
  onCreateDirectory: (parentPath: string, name: string) => void
  onDelete: (path: string) => void

  // Editor
  openFiles: string[]
  fileContents: Record<string, string>
  onEditorFileSelect: (path: string) => void
  onFileClose: (path: string) => void
  onContentChange: (path: string, content: string) => void

  // Terminal tabs
  terminalTabs: TerminalTab[]
  activeTerminalTabId: string | null
  onTerminalTabSelect: (id: string) => void
  onTerminalTabClose: (id: string) => void
  onAddTerminalTab: () => void

  // Navigation
  onNavigate?: (path: string) => void

  // Restart
  onRestart?: () => void
  restarting?: boolean
}

const navItems = [
  { path: '/computer/terminal', label: 'Terminal' },
  { path: '/computer/spaces', label: 'Spaces' },
  { path: '/computer/settings', label: 'Settings' },
]

function IdeLayout(props: IdeLayoutProps) {
  const { status, isBooting, isInstalling, onNavigate, onRestart, restarting } = props

  return (
    <Prim.Box
      display="flex"
      flexDirection="column"
      height="100vh"
      overflow="hidden"
      backgroundColor="$background"
      color="$foreground"
    >
      <Prim.Box
        height="$10"
        display="flex"
        alignItems="center"
        gap="$3"
        paddingHorizontal="$4"
        borderBottomWidth={1}
        borderBottomColor="$border"
        backgroundColor="$card"
        flexShrink={0}
      >
        <Prim.Text fontSize="$sm" fontWeight="$semibold"><CozyThingText text="lmthing.computer" /></Prim.Text>
        {onNavigate && (
          <Prim.Box as="nav" display="flex" alignItems="center" gap="$1" marginLeft="$4">
            {navItems.map((item) => (
              <Prim.Pressable
                key={item.path}
                onClick={() => onNavigate(item.path)}
                fontSize="$xs"
                color="$muted-foreground"
                paddingHorizontal="$2"
                paddingVertical="$1"
                borderRadius="$radius"
                cursor="pointer"
                backgroundColor="transparent"
                borderWidth={0}
                hoverStyle={{ color: '$foreground' }}
              >
                {item.label}
              </Prim.Pressable>
            ))}
          </Prim.Box>
        )}
        <Prim.Box
          display="flex"
          alignItems="center"
          gap="$2"
          marginLeft="auto"
          fontSize="$sm"
          color="$muted-foreground"
        >
          {(isBooting || isInstalling) && <Loader2 size={14} className="animate-spin" />}
          {isBooting && 'Booting...'}
          {isInstalling && 'Installing dependencies...'}
          {!isBooting && !isInstalling && (
            <Badge variant={status === 'running' ? 'success' : 'muted'}>{status}</Badge>
          )}
          {onRestart && (
            <Prim.Pressable
              onClick={restarting ? undefined : onRestart}
              disabled={restarting}
              fontSize="$xs"
              color="$muted-foreground"
              cursor="pointer"
              backgroundColor="transparent"
              borderWidth={0}
              padding="$0"
              hoverStyle={{ color: '$foreground' }}
              disabledStyle={{ opacity: 0.4 }}
              title="Restart CLI process (reloads .env)"
            >
              {restarting ? '↻' : '⏻'}
            </Prim.Pressable>
          )}
        </Prim.Box>
      </Prim.Box>
      <Prim.Box flexGrow={1} flexShrink={1} flexBasis="0%" overflow="hidden">
        <Prim.Box display="flex" width="100%" height="100%" minHeight={0} minWidth={0} flexDirection="row">
          <Prim.Box minHeight={0} minWidth={0} overflow="hidden" flexShrink={0} flexBasis="15%">
            <IdeFileTree
              fileTree={props.fileTree}
              activeFile={props.activeFile}
              onFileSelect={props.onFileSelect}
              onCreateFile={props.onCreateFile}
              onCreateDirectory={props.onCreateDirectory}
              onDelete={props.onDelete}
            />
          </Prim.Box>

          <Prim.Box width="$1" backgroundColor="$border" flexShrink={0} />

          <Prim.Box minHeight={0} minWidth={0} overflow="hidden" flexGrow={1} flexShrink={1} flexBasis="0%">
            <Prim.Box display="flex" width="100%" height="100%" minHeight={0} minWidth={0} flexDirection="column">
              <Prim.Box minHeight={0} minWidth={0} overflow="hidden" flexGrow={1} flexShrink={1} flexBasis="0%">
                <IdeEditor
                  openFiles={props.openFiles}
                  activeFile={props.activeFile}
                  fileContents={props.fileContents}
                  onFileSelect={props.onEditorFileSelect}
                  onFileClose={props.onFileClose}
                  onContentChange={props.onContentChange}
                />
              </Prim.Box>

              <Prim.Box height="$1" backgroundColor="$border" flexShrink={0} />

              <Prim.Box minHeight={0} minWidth={0} overflow="hidden" flexShrink={0} flexBasis="30%">
                <IdeTerminal
                  tabs={props.terminalTabs}
                  activeTabId={props.activeTerminalTabId}
                  onTabSelect={props.onTerminalTabSelect}
                  onTabClose={props.onTerminalTabClose}
                  onAddTab={props.onAddTerminalTab}
                />
              </Prim.Box>
            </Prim.Box>
          </Prim.Box>

        </Prim.Box>
      </Prim.Box>
    </Prim.Box>
  )
}

export { IdeLayout }
