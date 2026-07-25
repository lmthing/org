import * as Prim from '@lmthing/ui/elements/primitives';
import { createFileRoute, useParams } from '@tanstack/react-router'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { ChevronRight, ChevronDown, Folder, FolderOpen, FileText } from 'lucide-react'
import { Button } from '@lmthing/ui/elements/forms/button'
import { Caption } from '@lmthing/ui/elements/typography/caption'
import { buildTree } from '@/lib/file-tree'
import type { FileTreeNode } from '@/lib/runtime/file-watcher'
import { useAppApi, manifestFilePaths, type AppManifest } from '../-lib/appApi'

/**
 * App-file editor. The tree is derived from the manifest (pages/api/hooks/
 * tables + `package.json`); a file opens via `GET …/app/files/<path>` and saves
 * via `PUT …/app/files/<path>`. The management API is **path-scoped** and
 * refuses `.data/`/`types/` writes — those refusals surface as the save error.
 * A simple styled `<textarea>` is the editor (no code-editor component ships in
 * `apps/web`/`@lmthing/ui` today).
 */
function TreeItem({
  node,
  depth,
  selectedPath,
  onSelect,
  expanded,
  onToggle,
}: {
  node: FileTreeNode
  depth: number
  selectedPath: string | null
  onSelect: (path: string) => void
  expanded: Set<string>
  onToggle: (path: string) => void
}) {
  const isDir = node.type === 'directory'
  const isOpen = expanded.has(node.path)
  const isSelected = node.path === selectedPath
  return (
    <>
      <Prim.Box
        onClick={() => (isDir ? onToggle(node.path) : onSelect(node.path))}
        display="flex" alignItems="center" gap="0.375rem" paddingVertical="0.25rem" paddingHorizontal="0.5rem" paddingLeft={`${depth + 0.5}rem`} cursor="pointer" fontSize="0.8125rem" borderRadius="0.25rem" backgroundColor="isSelected ? 'var(--color-primary)' : 'transparent'" color={isSelected ? 'var(--color-primary-foreground)' : 'inherit'}
      >
        {isDir ? (
          <>
            {isOpen ? (
              <ChevronDown style={{ width: 14, height: 14, flexShrink: 0, opacity: 0.5 }} />
            ) : (
              <ChevronRight style={{ width: 14, height: 14, flexShrink: 0, opacity: 0.5 }} />
            )}
            {isOpen ? (
              <FolderOpen style={{ width: 15, height: 15, flexShrink: 0, color: isSelected ? 'inherit' : 'var(--color-primary)' }} />
            ) : (
              <Folder style={{ width: 15, height: 15, flexShrink: 0, color: isSelected ? 'inherit' : 'var(--color-primary)' }} />
            )}
          </>
        ) : (
          <>
            <Prim.Text width={14} flexShrink={0} />
            <FileText style={{ width: 15, height: 15, flexShrink: 0, opacity: 0.5 }} />
          </>
        )}
        <Prim.Text overflow="hidden" textOverflow="ellipsis" whiteSpace="nowrap">
          {node.name}
        </Prim.Text>
      </Prim.Box>
      {isDir &&
        isOpen &&
        node.children?.map((child) => (
          <TreeItem
            key={child.path}
            node={child}
            depth={depth + 1}
            selectedPath={selectedPath}
            onSelect={onSelect}
            expanded={expanded}
            onToggle={onToggle}
          />
        ))}
    </>
  )
}

function FilesEditor() {
  const { projectId } = useParams({ from: '/studio/$projectId/app' })
  const api = useAppApi(projectId)

  const [paths, setPaths] = useState<string[]>([])
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set())
  const [selected, setSelected] = useState<string | null>(null)
  const [content, setContent] = useState<string>('')
  const [original, setOriginal] = useState<string>('')
  const [loadingFile, setLoadingFile] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  useEffect(() => {
    const ac = new AbortController()
    api
      .getManifest(ac.signal)
      .then((m: AppManifest) => setPaths(manifestFilePaths(m)))
      .catch((e) => {
        if (!ac.signal.aborted) setError(e instanceof Error ? e.message : String(e))
      })
    return () => ac.abort()
  }, [api])

  const tree = useMemo(() => buildTree(paths), [paths])

  const openFile = useCallback(
    async (path: string) => {
      setSelected(path)
      setLoadingFile(true)
      setError(null)
      setNotice(null)
      try {
        const c = await api.readFile(path)
        setContent(c)
        setOriginal(c)
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e))
        setContent('')
        setOriginal('')
      } finally {
        setLoadingFile(false)
      }
    },
    [api],
  )

  const save = useCallback(async () => {
    if (!selected) return
    setSaving(true)
    setError(null)
    setNotice(null)
    try {
      await api.writeFile(selected, content)
      setOriginal(content)
      setNotice('Saved.')
    } catch (e) {
      // Respect the API's refusals (e.g. `.data/`/`types/` writes) — show them.
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setSaving(false)
    }
  }, [api, selected, content])

  const dirty = content !== original

  return (
    <Prim.Box display="flex" height="100%" overflow="hidden">
      {/* Tree */}
      <Prim.Box
        width={260} minWidth={200} borderRightWidth="1px" borderRightStyle="solid" borderRightColor="var(--color-border)" overflowY="auto" paddingVertical="0.5rem" paddingHorizontal="0" flexShrink={0}
      >
        <Prim.Box paddingTop="0.5rem" paddingHorizontal="0.75rem" paddingBottom="0.75rem" fontSize="0.6875rem" fontWeight={600} textTransform="uppercase" letterSpacing="0.05em" opacity={0.5}>
          App files ({paths.length})
        </Prim.Box>
        {tree.map((node) => (
          <TreeItem
            key={node.path}
            node={node}
            depth={0}
            selectedPath={selected}
            onSelect={openFile}
            expanded={expanded}
            onToggle={(p) =>
              setExpanded((prev) => {
                const next = new Set(prev)
                if (next.has(p)) next.delete(p)
                else next.add(p)
                return next
              })
            }
          />
        ))}
      </Prim.Box>

      {/* Editor */}
      <Prim.Box flexGrow={1} flexShrink={1} flexBasis="0%" display="flex" flexDirection="column" minWidth={0}>
        {selected ? (
          <>
            <Prim.Box
              display="flex" alignItems="center" gap="0.75rem" paddingVertical="0.5rem" paddingHorizontal="1rem" borderBottomWidth="1px" borderBottomStyle="solid" borderBottomColor="var(--color-border)"
            >
              <Prim.Text fontFamily="monospace" fontSize="0.75rem" fontWeight={600} color="var(--color-accent)" flexGrow={1} flexShrink={1} flexBasis="0%" overflow="hidden" textOverflow="ellipsis" whiteSpace="nowrap">
                {selected}
                {dirty ? ' •' : ''}
              </Prim.Text>
              {notice ? <Caption color="var(--color-accent)">{notice}</Caption> : null}
              <Button variant="primary" disabled={!dirty || saving} onClick={save}>
                {saving ? 'Saving…' : 'Save'}
              </Button>
            </Prim.Box>
            {error ? (
              <Caption paddingVertical="0.5rem" paddingHorizontal="1rem" color="var(--color-destructive)">{error}</Caption>
            ) : null}
            <Prim.TextArea
              value={content}
              spellCheck={false}
              disabled={loadingFile}
              onChange={(e) => setContent(e.target.value)}
              style={{
                flex: 1,
                width: '100%',
                border: 'none',
                outline: 'none',
                resize: 'none',
                padding: '1rem',
                fontFamily: 'monospace',
                fontSize: '0.8125rem',
                lineHeight: 1.6,
                background: 'var(--color-background)',
                color: 'var(--color-foreground)',
              }}
            />
          </>
        ) : (
          <Prim.Box display="flex" alignItems="center" justifyContent="center" height="100%" opacity={0.4} fontSize="0.875rem">
            {error ? (
              <Prim.Text color="var(--color-destructive)" opacity={1}>{error}</Prim.Text>
            ) : (
              'Select an app file to edit.'
            )}
          </Prim.Box>
        )}
      </Prim.Box>
    </Prim.Box>
  )
}

export const Route = createFileRoute('/studio/$projectId/app/files/')({
  component: FilesEditor,
})
