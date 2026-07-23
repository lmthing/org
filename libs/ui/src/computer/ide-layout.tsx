import * as Prim from '../elements/primitives/index.js';
import '@lmthing/css/components/computer/ide-layout.css'
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
    <Prim.Box className="ide-layout">
      <Prim.Box className="ide-layout__header">
        <Prim.Text className="ide-layout__title"><CozyThingText text="lmthing.computer" /></Prim.Text>
        {onNavigate && (
          <Prim.Box as="nav" className="ide-layout__nav">
            {navItems.map((item) => (
              <Prim.Pressable key={item.path} onClick={() => onNavigate(item.path)} className="ide-layout__nav-btn">
                {item.label}
              </Prim.Pressable>
            ))}
          </Prim.Box>
        )}
        <Prim.Box className="ide-layout__status">
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
              className="ide-layout__restart-btn"
              title="Restart CLI process (reloads .env)"
            >
              {restarting ? '↻' : '⏻'}
            </Prim.Pressable>
          )}
        </Prim.Box>
      </Prim.Box>
      <Prim.Box className="ide-layout__body">
        <Prim.Box className="ide-layout__split ide-layout__split--horizontal">
          <Prim.Box className="ide-layout__pane ide-layout__pane--sidebar">
            <IdeFileTree
              fileTree={props.fileTree}
              activeFile={props.activeFile}
              onFileSelect={props.onFileSelect}
              onCreateFile={props.onCreateFile}
              onCreateDirectory={props.onCreateDirectory}
              onDelete={props.onDelete}
            />
          </Prim.Box>

          <Prim.Box className="ide-layout__divider ide-layout__divider--horizontal" />

          <Prim.Box className="ide-layout__pane ide-layout__pane--main">
            <Prim.Box className="ide-layout__split ide-layout__split--vertical">
              <Prim.Box className="ide-layout__pane ide-layout__pane--editor">
                <IdeEditor
                  openFiles={props.openFiles}
                  activeFile={props.activeFile}
                  fileContents={props.fileContents}
                  onFileSelect={props.onEditorFileSelect}
                  onFileClose={props.onFileClose}
                  onContentChange={props.onContentChange}
                />
              </Prim.Box>

              <Prim.Box className="ide-layout__divider ide-layout__divider--vertical" />

              <Prim.Box className="ide-layout__pane ide-layout__pane--terminal">
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
