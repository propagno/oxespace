import { ChevronDown, ChevronRight, FileText, Folder } from 'lucide-react'
import { useState, type ReactElement } from 'react'
import type { FileTreeNode } from '../../../shared/types/ipc'

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

  const loadDirectory = async (relativePath: string): Promise<FileTreeNode[]> => {
    if (childrenByPath[relativePath]) return childrenByPath[relativePath]
    setLoadingByPath((current) => ({ ...current, [relativePath]: true }))
    setErrorByPath((current) => ({ ...current, [relativePath]: '' }))
    try {
      const children = await window.oxe.fs.listTree({ workspaceId, rootPath, relativePath })
      setChildrenByPath((current) => ({ ...current, [relativePath]: children }))
      return children
    } catch (error) {
      setErrorByPath((current) => ({ ...current, [relativePath]: error instanceof Error ? error.message : 'Failed to load directory' }))
      return []
    } finally {
      setLoadingByPath((current) => ({ ...current, [relativePath]: false }))
    }
  }

  if (nodes.length === 0) {
    return <div className="editor-browser-empty">No files</div>
  }

  return (
    <nav className="editor-browser" aria-label="Workspace files">
      {nodes.map((node) => (
        <FileNode
          key={node.relativePath}
          node={node}
          rootPath={rootPath}
          selectedPath={selectedPath}
          onOpenFile={onOpenFile}
          loadDirectory={loadDirectory}
          childrenByPath={childrenByPath}
          loadingByPath={loadingByPath}
          errorByPath={errorByPath}
        />
      ))}
    </nav>
  )
}

interface FileNodeProps {
  node: FileTreeNode
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

function FileNode({ node, onOpenFile, rootPath, selectedPath, loadDirectory, childrenByPath, loadingByPath, errorByPath }: FileNodeProps): ReactElement {
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
          aria-expanded={isExpanded}
          draggable
          onDragStart={handleDragStart}
          onClick={handleToggle}
          title={node.relativePath}
        >
          {isExpanded ? <ChevronDown size={12} aria-hidden="true" /> : <ChevronRight size={12} aria-hidden="true" />}
          <Folder size={13} aria-hidden="true" />
          <span>{node.name}</span>
        </button>
        {isExpanded ? (
          <div className="editor-browser-children">
            {isLoading ? <div className="editor-browser-empty">Loading</div> : null}
            {error ? <div className="editor-error">{error}</div> : null}
            {!isLoading && !error && children.length === 0 ? <div className="editor-browser-empty">Empty</div> : null}
            {children.map((child) => (
              <FileNode
                key={child.relativePath}
                node={child}
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
      title={node.relativePath}
      draggable
      onDragStart={handleDragStart}
      onClick={() => onOpenFile(node.relativePath)}
    >
      <FileText size={13} aria-hidden="true" />
      <span>{node.name}</span>
    </button>
  )
}
