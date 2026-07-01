import { useApp } from '@lmthing/state'
import { useComputer } from '@/lib/runtime/ComputerContext'
import { useIdeStore } from '@/lib/store'
import { useIdeFiles } from './use-ide-files'
import { useIdeTerminals } from './use-ide-terminals'
import { usePodRestart } from './use-pod-restart'

/**
 * Composes the IDE route's data + terminal-session hooks into the single
 * shape `IdeLayout` needs. Keeps `index.tsx` a thin route/composition file.
 */
export function useIde() {
  const { status } = useComputer()
  const store = useIdeStore()
  const { transport } = useApp()

  const files = useIdeFiles()
  const terminals = useIdeTerminals(status, transport)
  const { restarting, handleRestart } = usePodRestart()

  return {
    status,
    store,
    files,
    terminals,
    restarting,
    handleRestart,
  }
}
