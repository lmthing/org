import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useApp } from '@lmthing/state'
import { useIdeStore } from '@/lib/store'
import { buildTree } from '@/lib/file-tree'

/**
 * Owns the IDE's file tree + open-file contents: loading the pod's file list,
 * lazily fetching/caching file contents, and debounced writes back to the pod.
 * Mutates `useIdeStore`'s open-file state as a side effect (same as the
 * original inline implementation).
 */
export function useIdeFiles() {
  const { transport } = useApp()
  const store = useIdeStore()

  const [filePaths, setFilePaths] = useState<string[]>([])
  const [fileContents, setFileContents] = useState<Record<string, string>>({})
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const debounceTimersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map())

  const saveFile = useCallback(
    (path: string, content: string) => {
      if (!transport) return
      const timer = debounceTimersRef.current.get(path)
      if (timer) clearTimeout(timer)

      const newTimer = setTimeout(async () => {
        debounceTimersRef.current.delete(path)
        try {
          await transport.writeFile(path, content)
        } catch (err) {
          console.error(`Failed to save ${path}:`, err)
        }
      }, 1500)

      debounceTimersRef.current.set(path, newTimer)
    },
    [transport],
  )

  // Load file tree on mount
  useEffect(() => {
    if (!transport) return
    let cancelled = false

    async function loadTree() {
      setIsLoading(true)
      setError(null)
      try {
        const files = await transport!.listFiles()
        if (!cancelled) setFilePaths(files)
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err))
      } finally {
        if (!cancelled) setIsLoading(false)
      }
    }

    void loadTree()
    return () => { cancelled = true }
  }, [transport])

  const fileTree = useMemo(() => buildTree(filePaths), [filePaths])

  const handleFileSelect = useCallback(async (path: string) => {
    if (fileContents[path] !== undefined) {
      store.openFile(path, fileContents[path])
      return
    }
    if (!transport) return
    try {
      const content = await transport.readFile(path)
      setFileContents((prev) => ({ ...prev, [path]: content }))
      store.openFile(path, content)
    } catch (err) {
      console.error(`Failed to read ${path}:`, err)
      store.openFile(path, '')
    }
  }, [fileContents, transport, store])

  const handleCreateFile = useCallback(async (parentPath: string, name: string) => {
    const path = parentPath === '.' ? name : `${parentPath}/${name}`
    if (!transport) return
    try {
      await transport.writeFile(path, '')
      setFilePaths((prev) => prev.includes(path) ? prev : [...prev, path])
      setFileContents((prev) => ({ ...prev, [path]: '' }))
      store.openFile(path, '')
    } catch (err) {
      console.error(`Failed to create ${path}:`, err)
    }
  }, [transport, store])

  const handleCreateDirectory = useCallback(async (parentPath: string, name: string) => {
    const path = parentPath === '.' ? name : `${parentPath}/${name}`
    const dummyPath = `${path}/.gitkeep`
    if (!transport) return
    try {
      await transport.writeFile(dummyPath, '')
      setFilePaths((prev) => prev.includes(dummyPath) ? prev : [...prev, dummyPath])
    } catch (err) {
      console.error(`Failed to create directory ${path}:`, err)
    }
  }, [transport])

  const handleDelete = useCallback((path: string) => {
    // Optimistically remove from local state; no delete API yet
    setFilePaths((prev) => prev.filter((p) => p !== path && !p.startsWith(`${path}/`)))
    setFileContents((prev) => {
      const next = { ...prev }
      delete next[path]
      for (const k of Object.keys(next)) {
        if (k.startsWith(`${path}/`)) delete next[k]
      }
      return next
    })
    store.closeFile(path)
  }, [store])

  const handleContentChange = useCallback((path: string, content: string) => {
    setFileContents((prev) => ({ ...prev, [path]: content }))
    store.updateFileContent(path, content)
    saveFile(path, content)
  }, [saveFile, store])

  return {
    fileTree,
    fileContents,
    isLoading,
    error,
    handleFileSelect,
    handleCreateFile,
    handleCreateDirectory,
    handleDelete,
    handleContentChange,
  }
}
