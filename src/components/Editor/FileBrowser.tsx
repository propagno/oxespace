import { ChevronDown, ChevronRight, FileText, Folder } from 'lucide-react'
import { useState, type ReactElement } from 'react'
import type { FileTreeNode } from '../../../shared/types/ipc'
import { EmptyState } from '../../ui'
import { useTreeKeyboard } from '../../hooks/useTreeKeyboard'
import { humanizeError } from '../../utils/humanizeError'

interface FileBrowserProps {
  nodes: FileTreeNode[]
  rootPath: string
  workspaceId: string
  selectedPath: string | null
  onOpenFile: (relativePath: string) => void
}

export function FileBrowser({ nodes, onOpenFile, rootPath, selectedPath, workspaceId }: FileBrowserProps): ReactElement {
  const [childrenByPath, setChildrenByPath] = useState<Record<string, FileTreeNode[]>>({})
  const [loadingByPath, setLoadingByPath] = useState<Record<string, boolean>>({})
  const [errorByPath, setErrorByPath] = useState<Record<string, string>>({})
  const tree = useTreeKeyboard<HTMLDivElement>()

  const loadDirectory = async (relativePath: string): Promise<FileTreeNode[]> => {
    if (childrenByPath[relativePath]) return childrenByPath[relativePath]
    setLoadingByPath((current) => ({ ...current, [relativePath]: true }))
    setErrorByPath((current) => ({ ...current, [relativePath]: '' }))
    try {
      const children = await window.oxe.fs.listTree({ workspaceId, rootPath, relativePath })
      setChildrenByPath((current) => ({ ...current, [relativePath]: children }))
      return children
    } catch (error) {
      setErrorByPath((current) => ({ ...current, [relativePath]: humanizeError(error, 'Failed to load directory') }))
      return []
    } finally {
      setLoadingByPath((current) => ({ ...current, [relativePath]: false }))
    }
  }

  if (nodes.length === 0) {
    return <EmptyState compact title="No files" />
  }

  return (
    <nav className="editor-browser" aria-label="Workspace files">
      <div className="editor-browser-tree" role="tree" aria-label="Files" ref={tree.ref} onKeyDown={tree.onKeyDown}>
      {nodes.map((node, index) => (
        <FileNode
          key={node.relativePath}
          node={node}
          level={1}
          position={index + 1}
          siblings={nodes.length}
          rootPath={rootPath}
          selectedPath={selectedPath}
          onOpenFile={onOpenFile}
          loadDirectory={loadDirectory}
          childrenByPath={childrenByPath}
          loadingByPath={loadingByPath}
          errorByPath={errorByPath}
        />
      ))}
      </div>
    </nav>
  )
}

interface FileNodeProps {
  node: FileTreeNode
  /** 1-based depth, position among siblings and sibling count: the tree's ARIA coordinates. */
  level: number
  position: number
  siblings: number
  rootPath: string
  selectedPath: string | null
  onOpenFile: (relativePath: string) => void
  loadDirectory: (relativePath: string) => Promise<FileTreeNode[]>
  childrenByPath: Record<string, FileTreeNode[]>
  loadingByPath: Record<string, boolean>
  errorByPath: Record<string, string>
}

function buildAbsolutePath(rootPath: string, relativePath: string): string {
  const sep = rootPath.includes('\\') ? '\\' : '/'
  const base = rootPath.endsWith(sep) ? rootPath.slice(0, -1) : rootPath
  const rel = sep === '\\' ? relativePath.replace(/\//g, '\\') : relativePath
  const full = `${base}${sep}${rel}`
  return full.includes(' ') ? `"${full}"` : full
}

function FileNode({ node, level, position, siblings, onOpenFile, rootPath, selectedPath, loadDirectory, childrenByPath, loadingByPath, errorByPath }: FileNodeProps): ReactElement {
  const [isExpanded, setIsExpanded] = useState(false)

  const handleDragStart = (event: React.DragEvent): void => {
    event.dataTransfer.effectAllowed = 'copy'
    event.dataTransfer.setData('application/oxe-file-path', buildAbsolutePath(rootPath, node.relativePath))
    event.stopPropagation()
  }

  if (node.type === 'directory') {
    const children = childrenByPath[node.relativePath] ?? node.children ?? []
    const isLoading = loadingByPath[node.relativePath] === true
    const error = errorByPath[node.relativePath]
    const handleToggle = (): void => {
      const nextExpanded = !isExpanded
      setIsExpanded(nextExpanded)
      if (nextExpanded && !childrenByPath[node.relativePath] && !node.children) {
        void loadDirectory(node.relativePath)
      }
    }
    return (
      <div className="editor-browser-node">
        <button
          type="button"
          className="editor-browser-directory"
          role="treeitem"
          aria-level={level}
          aria-posinset={position}
          aria-setsize={siblings}
          aria-expanded={isExpanded}
          draggable
          onDragStart={handleDragStart}
          onClick={handleToggle}
          title={node.relativePath}
        >
          {isExpanded ? <ChevronDown size={12} aria-hidden="true" /> : <ChevronRight size={12} aria-hidden="true" />}
          <Folder size={14} aria-hidden="true" />
          <span>{node.name}</span>
        </button>
        {isExpanded ? (
          <div className="editor-browser-children">
            {isLoading ? <EmptyState compact title="Loading" /> : null}
            {error ? <div className="editor-error">{error}</div> : null}
            {!isLoading && !error && children.length === 0 ? <EmptyState compact title="Empty" /> : null}
            {children.map((child, childIndex) => (
              <FileNode
                key={child.relativePath}
                node={child}
                level={level + 1}
                position={childIndex + 1}
                siblings={children.length}
                rootPath={rootPath}
                selectedPath={selectedPath}
                onOpenFile={onOpenFile}
                loadDirectory={loadDirectory}
                childrenByPath={childrenByPath}
                loadingByPath={loadingByPath}
                errorByPath={errorByPath}
              />
            ))}
          </div>
        ) : null}
      </div>
    )
  }

  return (
    <button
      type="button"
      className={`editor-browser-file${selectedPath === node.relativePath ? ' active' : ''}`}
      role="treeitem"
      aria-level={level}
      aria-posinset={position}
      aria-setsize={siblings}
      aria-selected={selectedPath === node.relativePath}
      title={node.relativePath}
      draggable
      onDragStart={handleDragStart}
      onClick={() => onOpenFile(node.relativePath)}
    >
      <FileText size={14} aria-hidden="true" />
      <span>{node.name}</span>
    </button>
  )
}
