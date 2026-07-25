import * as Prim from '../elements/primitives/index.js';
import { Button } from '../elements/forms/button'
import { useState } from 'react'
import {
  ChevronRight,
  ChevronDown,
  File,
  Folder,
  FolderOpen,
  FilePlus,
  FolderPlus,
  Trash2,
} from 'lucide-react'
import * as ContextMenu from '../elements/overlays/context-menu'
import { Dialog, DialogContent, DialogTitle } from '../elements/overlays/dialog'
import { IDE_FILE_TREE_CONTEXT_ITEM, IDE_FILE_TREE_CONTEXT_ITEM_DANGER, IDE_FILE_TREE_DIALOG_INPUT, IDE_FILE_TREE_DIALOG_TITLE, IDE_FILE_TREE_ICON, IDE_FILE_TREE_ICON_FOLDER } from './ide-file-tree.props.js'

export interface FileTreeNode {
  name: string
  path: string
  type: 'file' | 'directory'
  children?: FileTreeNode[]
}

export interface IdeFileTreeProps {
  fileTree: FileTreeNode[]
  activeFile: string | null
  onFileSelect: (path: string) => void
  onCreateFile: (parentPath: string, name: string) => void
  onCreateDirectory: (parentPath: string, name: string) => void
  onDelete: (path: string) => void
}

interface ItemProps {
  node: FileTreeNode
  level: number
  activeFile: string | null
  onFileSelect: (path: string) => void
  onCreateFile: (parentPath: string, name: string) => void
  onCreateDirectory: (parentPath: string, name: string) => void
  onDelete: (path: string) => void
}

function IdeFileTreeItem({ node, level, activeFile, onFileSelect, onCreateFile, onCreateDirectory, onDelete }: ItemProps) {
  const [expanded, setExpanded] = useState(false)
  const [dialogType, setDialogType] = useState<'file' | 'folder' | null>(null)
  const [newName, setNewName] = useState('')
  const isActive = activeFile === node.path

  function handleClick() {
    if (node.type === 'directory') {
      setExpanded(!expanded)
    } else {
      onFileSelect(node.path)
    }
  }

  function handleCreate() {
    if (!newName.trim() || !dialogType) return
    const parent = node.type === 'directory' ? node.path : node.path.split('/').slice(0, -1).join('/') || '.'
    if (dialogType === 'file') onCreateFile(parent, newName.trim())
    else onCreateDirectory(parent, newName.trim())
    setDialogType(null)
    setNewName('')
  }

  return (
    <Prim.Box>
      <ContextMenu.Root>
        <ContextMenu.Trigger asChild>
          <Prim.Box
            display="flex"
            alignItems="center"
            gap="$1"
            paddingHorizontal="$2"
            paddingVertical="$1"
            cursor="pointer"
            fontSize="$sm"
            hoverStyle={{ backgroundColor: '$accent' }}
            backgroundColor={isActive ? 'color-mix(in srgb, var(--primary) 20%, transparent)' : undefined}
            color={isActive ? '$primary' : undefined}
            style={{ paddingLeft: `${level * 12 + 8}px` }}
            onClick={handleClick}
          >
            {node.type === 'directory' ? (
              <>
                {expanded
                  ? <ChevronDown size={16} {...IDE_FILE_TREE_ICON} />
                  : <ChevronRight size={16} {...IDE_FILE_TREE_ICON} />}
                {expanded
                  ? <FolderOpen size={16} {...IDE_FILE_TREE_ICON} {...IDE_FILE_TREE_ICON_FOLDER} />
                  : <Folder size={16} {...IDE_FILE_TREE_ICON} {...IDE_FILE_TREE_ICON_FOLDER} />}
              </>
            ) : (
              <>
                <Prim.Text style={{ width: 16 }} />
                <File size={16} {...IDE_FILE_TREE_ICON} />
              </>
            )}
            <Prim.Text overflow="hidden" textOverflow="ellipsis" whiteSpace="nowrap">{node.name}</Prim.Text>
          </Prim.Box>
        </ContextMenu.Trigger>
        <ContextMenu.Portal>
          <ContextMenu.Content className="ide-file-tree__context-menu">
            <ContextMenu.Item {...IDE_FILE_TREE_CONTEXT_ITEM} onClick={() => setDialogType('file')}>
              <FilePlus size={16} /> New File
            </ContextMenu.Item>
            <ContextMenu.Item {...IDE_FILE_TREE_CONTEXT_ITEM} onClick={() => setDialogType('folder')}>
              <FolderPlus size={16} /> New Folder
            </ContextMenu.Item>
            <ContextMenu.Separator style={{ height: 1, margin: '4px 0', background: 'var(--color-border)' }} />
            <ContextMenu.Item {...IDE_FILE_TREE_CONTEXT_ITEM} {...IDE_FILE_TREE_CONTEXT_ITEM_DANGER} onClick={() => onDelete(node.path)}>
              <Trash2 size={16} /> Delete
            </ContextMenu.Item>
          </ContextMenu.Content>
        </ContextMenu.Portal>
      </ContextMenu.Root>

      <Dialog open={dialogType !== null} onOpenChange={(open) => { if (!open) setDialogType(null) }}>
        <DialogContent className="ide-file-tree__dialog-content">
          <DialogTitle {...IDE_FILE_TREE_DIALOG_TITLE}>
            New {dialogType === 'folder' ? 'Folder' : 'File'}
          </DialogTitle>
          <Prim.TextField
            {...IDE_FILE_TREE_DIALOG_INPUT}
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
            placeholder={dialogType === 'folder' ? 'folder-name' : 'filename.txt'}
            autoFocus
          />
          <Prim.Box display="flex" justifyContent="flex-end" gap="$2" marginTop="$4">
            <Button variant="ghost" size="sm" onClick={() => setDialogType(null)}>Cancel</Button>
            <Button variant="primary" size="sm" onClick={handleCreate}>Create</Button>
          </Prim.Box>
        </DialogContent>
      </Dialog>

      {node.type === 'directory' && expanded && node.children?.map((child) => (
        <IdeFileTreeItem
          key={child.path}
          node={child}
          level={level + 1}
          activeFile={activeFile}
          onFileSelect={onFileSelect}
          onCreateFile={onCreateFile}
          onCreateDirectory={onCreateDirectory}
          onDelete={onDelete}
        />
      ))}
    </Prim.Box>
  )
}

function IdeFileTree({ fileTree, activeFile, onFileSelect, onCreateFile, onCreateDirectory, onDelete }: IdeFileTreeProps) {
  const [dialogType, setDialogType] = useState<'file' | 'folder' | null>(null)
  const [newName, setNewName] = useState('')

  function handleCreate() {
    if (!newName.trim() || !dialogType) return
    if (dialogType === 'file') onCreateFile('.', newName.trim())
    else onCreateDirectory('.', newName.trim())
    setDialogType(null)
    setNewName('')
  }

  return (
    <Prim.Box height="100%" backgroundColor="$card" overflow="auto">
      <Prim.Box
        display="flex"
        alignItems="center"
        justifyContent="space-between"
        paddingHorizontal="$3"
        paddingVertical="$2"
        borderBottomWidth={1}
        borderBottomColor="$border"
      >
        <Prim.Text
          fontSize="$xs"
          fontWeight="$semibold"
          color="$muted-foreground"
          textTransform="uppercase"
          letterSpacing="$wider"
        >Files</Prim.Text>
        <Prim.Box display="flex" gap="$1">
          <Prim.Pressable
            padding="$1"
            borderRadius="$radius"
            color="$muted-foreground"
            // transition-colors awaits the animation driver
            hoverStyle={{ backgroundColor: '$accent', color: '$foreground' }}
            title="New File"
            onClick={() => setDialogType('file')}
          >
            <FilePlus size={16} />
          </Prim.Pressable>
          <Prim.Pressable
            padding="$1"
            borderRadius="$radius"
            color="$muted-foreground"
            // transition-colors awaits the animation driver
            hoverStyle={{ backgroundColor: '$accent', color: '$foreground' }}
            title="New Folder"
            onClick={() => setDialogType('folder')}
          >
            <FolderPlus size={16} />
          </Prim.Pressable>
        </Prim.Box>
      </Prim.Box>
      <Prim.Box>
        {fileTree.map((node) => (
          <IdeFileTreeItem
            key={node.path}
            node={node}
            level={0}
            activeFile={activeFile}
            onFileSelect={onFileSelect}
            onCreateFile={onCreateFile}
            onCreateDirectory={onCreateDirectory}
            onDelete={onDelete}
          />
        ))}
      </Prim.Box>

      <Dialog open={dialogType !== null} onOpenChange={(open) => { if (!open) setDialogType(null) }}>
        <DialogContent className="ide-file-tree__dialog-content">
          <DialogTitle {...IDE_FILE_TREE_DIALOG_TITLE}>
            New {dialogType === 'folder' ? 'Folder' : 'File'}
          </DialogTitle>
          <Prim.TextField
            {...IDE_FILE_TREE_DIALOG_INPUT}
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
            placeholder={dialogType === 'folder' ? 'folder-name' : 'filename.txt'}
            autoFocus
          />
          <Prim.Box display="flex" justifyContent="flex-end" gap="$2" marginTop="$4">
            <Button variant="ghost" size="sm" onClick={() => setDialogType(null)}>Cancel</Button>
            <Button variant="primary" size="sm" onClick={handleCreate}>Create</Button>
          </Prim.Box>
        </DialogContent>
      </Dialog>
    </Prim.Box>
  )
}

export { IdeFileTree }
