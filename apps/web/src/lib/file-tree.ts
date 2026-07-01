import type { FileTreeNode } from '@/lib/runtime/file-watcher'

/**
 * Build a sorted hierarchical file tree from a flat list of `/`-separated
 * paths. Directories sort before files, then alphabetically. Shared by the
 * computer IDE and the studio raw-files viewer.
 */
export function buildTree(paths: string[]): FileTreeNode[] {
  const root: FileTreeNode[] = []

  for (const path of paths) {
    const parts = path.split('/')
    let current = root
    let currentPath = ''

    for (let i = 0; i < parts.length; i++) {
      const part = parts[i]
      currentPath = currentPath ? `${currentPath}/${part}` : part
      const isFile = i === parts.length - 1

      let existing = current.find((n) => n.name === part)
      if (!existing) {
        existing = {
          name: part,
          path: currentPath,
          type: isFile ? 'file' : 'directory',
          children: isFile ? undefined : [],
        }
        current.push(existing)
      }
      if (!isFile) {
        current = existing.children!
      }
    }
  }

  const sort = (nodes: FileTreeNode[]): FileTreeNode[] => {
    nodes.sort((a, b) => {
      if (a.type !== b.type) return a.type === 'directory' ? -1 : 1
      return a.name.localeCompare(b.name)
    })
    for (const n of nodes) {
      if (n.children) sort(n.children)
    }
    return nodes
  }

  return sort(root)
}
