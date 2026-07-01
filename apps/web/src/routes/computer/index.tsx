import { createFileRoute, useRouter } from '@tanstack/react-router'
import { IdeLayout } from '@lmthing/ui/computer'
import { useIde } from './use-ide'

export const Route = createFileRoute('/computer/')({
  component: IdeRoute,
})

function IdeRoute() {
  const router = useRouter()
  const { status, store, files, terminals, restarting, handleRestart } = useIde()

  return (
    <IdeLayout
      status={status}
      isBooting={files.isLoading || store.isBooting}
      isInstalling={store.isInstalling}
      fileTree={files.fileTree}
      activeFile={store.activeFile}
      onFileSelect={files.handleFileSelect}
      onCreateFile={files.handleCreateFile}
      onCreateDirectory={files.handleCreateDirectory}
      onDelete={files.handleDelete}
      openFiles={store.openFiles}
      fileContents={files.fileContents}
      onEditorFileSelect={(path) => store.setActiveFile(path)}
      onFileClose={(path) => store.closeFile(path)}
      onContentChange={files.handleContentChange}
      terminalTabs={terminals.tabs}
      activeTerminalTabId={terminals.activeTabId}
      onTerminalTabSelect={terminals.setActiveTabId}
      onTerminalTabClose={terminals.handleCloseTab}
      onAddTerminalTab={terminals.handleAddTab}
      onNavigate={(path) => router.navigate({ to: path })}
      onRestart={() => { void handleRestart() }}
      restarting={restarting}
    />
  )
}
