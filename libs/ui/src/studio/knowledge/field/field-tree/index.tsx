/**
 * FieldTree - Simple expandable 3-level domain→field→option tree for knowledge management.
 * Replaces the react-arborist based tree with a lightweight React state implementation.
 */
import * as Prim from '../../../../elements/primitives/index.js';
import { useState, useCallback, forwardRef, useImperativeHandle } from 'react'
import type { Ref } from 'react'
import {
  ChevronRight,
  ChevronDown,
  Database,
  Layers,
  FileText,
  MoreVertical,
  Edit3,
  Trash2,
  Plus,
} from 'lucide-react'
import { useKnowledgeTree } from '@lmthing/ui/hooks/knowledge/useKnowledgeTree'
import type { KnowledgeTreeNode } from '@lmthing/ui/hooks/knowledge/useKnowledgeTree'
import { Button } from '@lmthing/ui/elements/forms/button'
import { cn } from '@lmthing/ui/lib/utils'
import './FieldTree.css'
import { FIELD_TREE_CONTEXT_MENU_BACKDROP, FIELD_TREE_CONTEXT_MENU_ITEM_DESTRUCTIVE, FIELD_TREE_CONTEXT_MENU_ITEM_ICON, FIELD_TREE_NODE_ICON, FIELD_TREE_NODE_ICON_CHEVRON, FIELD_TREE_NODE_ICON_FILE, FIELD_TREE_NODE_ICON_FOLDER, FIELD_TREE_NODE_LABEL, FIELD_TREE_NODE_SPACER } from './field-tree.props.js'

export interface FieldTreeHandle {
  expandAll: () => void
  collapseAll: () => void
}

export interface FieldTreeProps {
  selectedPath: string | null
  onSelect: (path: string, type: 'domain' | 'field' | 'option') => void
  onCreateOption: (domain: string, field: string) => void
  onCreateField: (domain: string) => void
  onDelete: (path: string, type: 'domain' | 'field' | 'option') => void
  onRenameRequest: (path: string, name: string, type: 'domain' | 'field' | 'option') => void
}

type NodeSelectFn = (path: string, type: 'domain' | 'field' | 'option') => void

interface ContextMenuState {
  node: KnowledgeTreeNode | null
  position: { x: number; y: number } | null
}

function ContextMenu({
  node,
  position,
  onClose,
  onRename,
  onDelete,
  onCreateChild,
}: {
  node: KnowledgeTreeNode
  position: { x: number; y: number }
  onClose: () => void
  onRename: () => void
  onDelete: () => void
  onCreateChild?: () => void
}) {
  return (
    <>
      <Prim.Box {...FIELD_TREE_CONTEXT_MENU_BACKDROP} onClick={onClose} />
      <Prim.Box
        className="field-tree-context-menu"
        style={{ left: position.x, top: position.y }}
      >
        {onCreateChild && (
          <Prim.Pressable
            onClick={() => { onCreateChild(); onClose() }}
            className="field-tree-context-menu__item"
          >
            <Plus {...FIELD_TREE_CONTEXT_MENU_ITEM_ICON} />
            {node.type === 'domain' ? 'New Field' : 'New Option'}
          </Prim.Pressable>
        )}
        <Prim.Pressable
          onClick={() => { onRename(); onClose() }}
          className="field-tree-context-menu__item"
        >
          <Edit3 {...FIELD_TREE_CONTEXT_MENU_ITEM_ICON} />
          Rename
        </Prim.Pressable>
        <Prim.Pressable
          onClick={() => { onDelete(); onClose() }}
          {...FIELD_TREE_CONTEXT_MENU_ITEM_DESTRUCTIVE} className="field-tree-context-menu__item"
        >
          <Trash2 {...FIELD_TREE_CONTEXT_MENU_ITEM_ICON} />
          Delete
        </Prim.Pressable>
      </Prim.Box>
    </>
  )
}

function OptionNode({
  node,
  selectedPath,
  onSelect,
  onContextMenu,
}: {
  node: KnowledgeTreeNode
  selectedPath: string | null
  onSelect: NodeSelectFn
  onContextMenu: (node: KnowledgeTreeNode, pos: { x: number; y: number }) => void
}) {
  const isSelected = node.path === selectedPath

  return (
    <Prim.Box
      className={cn(
        'field-tree-node field-tree-node--option',
        isSelected && 'field-tree-node--selected',
      )}
      onClick={() => onSelect(node.path, 'option')}
    >
      <Prim.Text {...FIELD_TREE_NODE_SPACER} />
      <Prim.Text {...FIELD_TREE_NODE_SPACER} />
      <FileText {...FIELD_TREE_NODE_ICON} {...FIELD_TREE_NODE_ICON_FILE} />
      <Prim.Text {...FIELD_TREE_NODE_LABEL}>{node.slug}</Prim.Text>
      <Prim.Box className="field-tree-node__actions">
        <Button
          variant="ghost"
          size="icon"
          onClick={(e: React.MouseEvent) => {
            e.stopPropagation()
            const rect = (e.target as HTMLElement).getBoundingClientRect()
            onContextMenu(node, { x: rect.left, y: rect.bottom + 4 })
          }}
        >
          <MoreVertical {...FIELD_TREE_NODE_ICON} />
        </Button>
      </Prim.Box>
    </Prim.Box>
  )
}

function FieldNode({
  node,
  selectedPath,
  onSelect,
  onContextMenu,
  isExpanded,
  onToggle,
}: {
  node: KnowledgeTreeNode
  selectedPath: string | null
  onSelect: NodeSelectFn
  onContextMenu: (node: KnowledgeTreeNode, pos: { x: number; y: number }) => void
  isExpanded: boolean
  onToggle: () => void
}) {
  const isSelected = node.path === selectedPath
  const hasChildren = node.children && node.children.length > 0

  return (
    <Prim.Box>
      <Prim.Box
        className={cn(
          'field-tree-node field-tree-node--field',
          isSelected && 'field-tree-node--selected',
        )}
        onClick={() => { onToggle(); onSelect(node.path, 'field') }}
      >
        <Prim.Text {...FIELD_TREE_NODE_SPACER} />
        {hasChildren ? (
          isExpanded ? (
            <ChevronDown {...FIELD_TREE_NODE_ICON_CHEVRON} />
          ) : (
            <ChevronRight {...FIELD_TREE_NODE_ICON_CHEVRON} />
          )
        ) : (
          <Prim.Text {...FIELD_TREE_NODE_SPACER} />
        )}
        <Layers {...FIELD_TREE_NODE_ICON} {...FIELD_TREE_NODE_ICON_FOLDER} />
        <Prim.Text {...FIELD_TREE_NODE_LABEL}>{node.slug}</Prim.Text>
        <Prim.Box className="field-tree-node__actions">
          <Button
            variant="ghost"
            size="icon"
            onClick={(e: React.MouseEvent) => {
              e.stopPropagation()
              const rect = (e.target as HTMLElement).getBoundingClientRect()
              onContextMenu(node, { x: rect.left, y: rect.bottom + 4 })
            }}
          >
            <MoreVertical {...FIELD_TREE_NODE_ICON} />
          </Button>
        </Prim.Box>
      </Prim.Box>
      {isExpanded && hasChildren && (
        <Prim.Box>
          {node.children!.map(opt => (
            <OptionNode
              key={opt.path}
              node={opt}
              selectedPath={selectedPath}
              onSelect={onSelect}
              onContextMenu={onContextMenu}
            />
          ))}
        </Prim.Box>
      )}
    </Prim.Box>
  )
}

function DomainNode({
  node,
  selectedPath,
  onSelect,
  onContextMenu,
  expandedFields,
  onToggleField,
  isExpanded,
  onToggle,
}: {
  node: KnowledgeTreeNode
  selectedPath: string | null
  onSelect: NodeSelectFn
  onContextMenu: (node: KnowledgeTreeNode, pos: { x: number; y: number }) => void
  expandedFields: Set<string>
  onToggleField: (path: string) => void
  isExpanded: boolean
  onToggle: () => void
}) {
  const isSelected = node.path === selectedPath
  const hasChildren = node.children && node.children.length > 0

  return (
    <Prim.Box>
      <Prim.Box
        className={cn(
          'field-tree-node field-tree-node--domain',
          isSelected && 'field-tree-node--selected',
        )}
        onClick={() => { onToggle(); onSelect(node.path, 'domain') }}
      >
        {hasChildren ? (
          isExpanded ? (
            <ChevronDown {...FIELD_TREE_NODE_ICON_CHEVRON} />
          ) : (
            <ChevronRight {...FIELD_TREE_NODE_ICON_CHEVRON} />
          )
        ) : (
          <Prim.Text {...FIELD_TREE_NODE_SPACER} />
        )}
        <Database {...FIELD_TREE_NODE_ICON} {...FIELD_TREE_NODE_ICON_FOLDER} />
        <Prim.Text {...FIELD_TREE_NODE_LABEL}>{node.slug}</Prim.Text>
        <Prim.Box className="field-tree-node__actions">
          <Button
            variant="ghost"
            size="icon"
            onClick={(e: React.MouseEvent) => {
              e.stopPropagation()
              const rect = (e.target as HTMLElement).getBoundingClientRect()
              onContextMenu(node, { x: rect.left, y: rect.bottom + 4 })
            }}
          >
            <MoreVertical {...FIELD_TREE_NODE_ICON} />
          </Button>
        </Prim.Box>
      </Prim.Box>
      {isExpanded && hasChildren && (
        <Prim.Box>
          {node.children!.map(fieldNode => (
            <FieldNode
              key={fieldNode.path}
              node={fieldNode}
              selectedPath={selectedPath}
              onSelect={onSelect}
              onContextMenu={onContextMenu}
              isExpanded={expandedFields.has(fieldNode.path)}
              onToggle={() => onToggleField(fieldNode.path)}
            />
          ))}
        </Prim.Box>
      )}
    </Prim.Box>
  )
}

function FieldTreeInner(
  {
    selectedPath,
    onSelect,
    onCreateOption,
    onCreateField,
    onDelete,
    onRenameRequest,
  }: FieldTreeProps,
  ref: Ref<FieldTreeHandle>
) {
  const tree = useKnowledgeTree()
  const [expandedDomains, setExpandedDomains] = useState<Set<string>>(() => new Set())
  const [expandedFields, setExpandedFields] = useState<Set<string>>(() => new Set())
  const [contextMenu, setContextMenu] = useState<ContextMenuState>({ node: null, position: null })

  useImperativeHandle(ref, () => ({
    expandAll: () => {
      const domains = new Set(tree.map((d: KnowledgeTreeNode) => d.path))
      const fields = new Set(tree.flatMap((d: KnowledgeTreeNode) => (d.children || []).map((f: KnowledgeTreeNode) => f.path)))
      setExpandedDomains(domains)
      setExpandedFields(fields)
    },
    collapseAll: () => {
      setExpandedDomains(new Set())
      setExpandedFields(new Set())
    },
  }), [tree])

  const toggleDomain = useCallback((path: string) => {
    setExpandedDomains((prev: Set<string>) => {
      const next = new Set(prev)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      return next
    })
  }, [])

  const toggleField = useCallback((path: string) => {
    setExpandedFields((prev: Set<string>) => {
      const next = new Set(prev)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      return next
    })
  }, [])

  const handleContextMenu = useCallback((node: KnowledgeTreeNode, position: { x: number; y: number }) => {
    setContextMenu({ node, position })
  }, [])

  const handleRename = useCallback(() => {
    if (!contextMenu.node) return
    onRenameRequest(contextMenu.node.path, contextMenu.node.slug, contextMenu.node.type)
  }, [contextMenu.node, onRenameRequest])

  const handleDelete = useCallback(() => {
    if (!contextMenu.node) return
    onDelete(contextMenu.node.path, contextMenu.node.type)
  }, [contextMenu.node, onDelete])

  const handleCreateChild = useCallback(() => {
    if (!contextMenu.node) return
    const node = contextMenu.node
    if (node.type === 'domain') {
      onCreateField(node.slug)
    } else if (node.type === 'field') {
      const parts = node.path.split('/')
      const domain = parts[1]
      onCreateOption(domain, node.slug)
    }
  }, [contextMenu.node, onCreateField, onCreateOption])

  const canCreateChild = contextMenu.node?.type === 'domain' || contextMenu.node?.type === 'field'

  return (
    <Prim.Box position="relative" height="100%" width="100%">
      {tree.map((domainNode: KnowledgeTreeNode) => (
        <DomainNode
          key={domainNode.path}
          node={domainNode}
          selectedPath={selectedPath}
          onSelect={onSelect}
          onContextMenu={handleContextMenu}
          expandedFields={expandedFields}
          onToggleField={toggleField}
          isExpanded={expandedDomains.has(domainNode.path)}
          onToggle={() => toggleDomain(domainNode.path)}
        />
      ))}

      {contextMenu.node && contextMenu.position && (
        <ContextMenu
          node={contextMenu.node}
          position={contextMenu.position}
          onClose={() => setContextMenu({ node: null, position: null })}
          onRename={handleRename}
          onDelete={handleDelete}
          onCreateChild={canCreateChild ? handleCreateChild : undefined}
        />
      )}
    </Prim.Box>
  )
}

export const FieldTree = forwardRef<FieldTreeHandle, FieldTreeProps>(FieldTreeInner)
