import * as Prim from '@lmthing/ui/elements/primitives';
import { useState, useMemo } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { useGlobRead } from '@lmthing/state'
import {
  ChevronRight,
  ChevronDown,
  Folder,
  FolderOpen,
  FileText,
} from 'lucide-react'
import { buildTree } from '@/lib/file-tree'
import type { FileTreeNode } from '@/lib/runtime/file-watcher'


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
        onClick={() => {
          if (isDir) onToggle(node.path)
          else onSelect(node.path)
        }}
        display="flex" alignItems="center" gap="0.375rem" paddingVertical="0.25rem" paddingHorizontal="0.5rem" paddingLeft={`${depth + 0.5}rem`} cursor="pointer" fontSize="0.8125rem" borderRadius="0.25rem" backgroundColor="isSelected ? 'var(--color-primary)' : 'transparent'" color={isSelected ? 'var(--color-primary-foreground)' : 'inherit'}
        onMouseEnter={(e) => {
          if (!isSelected) (e.currentTarget.style.background = 'var(--color-muted)')
        }}
        onMouseLeave={(e) => {
          if (!isSelected) (e.currentTarget.style.background = 'transparent')
        }}
      >
        {isDir ? (
          <>
            {isOpen
              ? <ChevronDown style={{ width: 14, height: 14, flexShrink: 0, opacity: 0.5 }} />
              : <ChevronRight style={{ width: 14, height: 14, flexShrink: 0, opacity: 0.5 }} />}
            {isOpen
              ? <FolderOpen style={{ width: 15, height: 15, flexShrink: 0, color: isSelected ? 'inherit' : 'var(--color-primary)' }} />
              : <Folder style={{ width: 15, height: 15, flexShrink: 0, color: isSelected ? 'inherit' : 'var(--color-primary)' }} />}
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
      {isDir && isOpen && node.children?.map((child) => (
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

function RawView() {
  const snapshot = useGlobRead('**/*')
  const paths = useMemo(() => Object.keys(snapshot).sort(), [snapshot])
  const tree = useMemo(() => buildTree(paths), [paths])

  const [selectedPath, setSelectedPath] = useState<string | null>(null)
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set())

  const handleToggle = (path: string) => {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      return next
    })
  }

  const selectedContent = selectedPath ? snapshot[selectedPath] ?? null : null

  return (
    <Prim.Box display="flex" height="100%" overflow="hidden">
      {/* File tree sidebar */}
      <Prim.Box
        width={260} minWidth={200} borderRightWidth="1px" borderRightStyle="solid" borderRightColor="var(--color-border)" overflowY="auto" paddingVertical="0.5rem" paddingHorizontal="0" flexShrink={0}
      >
        <Prim.Box paddingTop="0.5rem" paddingHorizontal="0.75rem" paddingBottom="0.75rem" fontSize="0.6875rem" fontWeight={600} textTransform="uppercase" letterSpacing="0.05em" opacity={0.5}>
          Files ({paths.length})
        </Prim.Box>
        {tree.map((node) => (
          <TreeItem
            key={node.path}
            node={node}
            depth={0}
            selectedPath={selectedPath}
            onSelect={setSelectedPath}
            expanded={expanded}
            onToggle={handleToggle}
          />
        ))}
      </Prim.Box>

      {/* File content */}
      <Prim.Box flexGrow={1} flexShrink={1} flexBasis="0%" overflow="auto" fontFamily="monospace" fontSize="0.8125rem">
        {selectedPath && selectedContent !== null ? (
          <>
            <Prim.Box
              paddingVertical="0.5rem" paddingHorizontal="1rem" borderBottomWidth="1px" borderBottomStyle="solid" borderBottomColor="var(--color-border)" fontSize="0.75rem" fontWeight={600} color="var(--color-accent)" position="sticky" top={0} backgroundColor="var(--color-background)" zIndex={1}
            >
              {selectedPath}
            </Prim.Box>
            <Prim.Pre
              style={{
                margin: 0,
                padding: '1rem',
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word',
                lineHeight: 1.6,
              }}
            >
              {selectedContent}
            </Prim.Pre>
          </>
        ) : (
          <Prim.Box display="flex" alignItems="center" justifyContent="center" height="100%" opacity={0.4} fontSize="0.875rem">
            {paths.length === 0 ? 'No files in this space.' : 'Select a file to view its content.'}
          </Prim.Box>
        )}
      </Prim.Box>
    </Prim.Box>
  )
}

export const Route = createFileRoute('/studio/$projectId/$spaceId/raw/')({
  component: RawView,
})
