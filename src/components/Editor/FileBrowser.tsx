import { ChevronDown, ChevronRight, FileText, Folder } from 'lucide-react'
import { useState, type ReactElement } from 'react'
import type { FileTreeNode } from '../../../shared/types/ipc'

interface FileBrowserProps {
  nodes: FileTreeNode[]
  rootPath: string
  selectedPath: string | null
  onOpenFile: (relativePath: string) => void
}

export function FileBrowser({ nodes, onOpenFile, rootPath, selectedPath }: FileBrowserProps): ReactElement {
  if (nodes.length === 0) {
    return <div className="editor-browser-empty">No files</div>
  }

  return (
    <nav className="editor-browser" aria-label="Workspace files">
      {nodes.map((node) => (
        <FileNode key={node.relativePath} node={node} rootPath={rootPath} selectedPath={selectedPath} onOpenFile={onOpenFile} />
      ))}
    </nav>
  )
}

interface FileNodeProps {
  node: FileTreeNode
  rootPath: string
  selectedPath: string | null
  onOpenFile: (relativePath: string) => void
}

function buildAbsolutePath(rootPath: string, relativePath: string): string {
  const sep = rootPath.includes('\\') ? '\\' : '/'
  const base = rootPath.endsWith(sep) ? rootPath.slice(0, -1) : rootPath
  const rel = sep === '\\' ? relativePath.replace(/\//g, '\\') : relativePath
  const full = `${base}${sep}${rel}`
  return full.includes(' ') ? `"${full}"` : full
}

function FileNode({ node, onOpenFile, rootPath, selectedPath }: FileNodeProps): ReactElement {
  const [isExpanded, setIsExpanded] = useState(true)

  const handleDragStart = (event: React.DragEvent): void => {
    event.dataTransfer.effectAllowed = 'copy'
    event.dataTransfer.setData('application/oxe-file-path', buildAbsolutePath(rootPath, node.relativePath))
    event.stopPropagation()
  }

  if (node.type === 'directory') {
    return (
      <div className="editor-browser-node">
        <button
          type="button"
          className="editor-browser-directory"
          aria-expanded={isExpanded}
          draggable
          onDragStart={handleDragStart}
          onClick={() => setIsExpanded((current) => !current)}
          title={node.relativePath}
        >
          {isExpanded ? <ChevronDown size={12} aria-hidden="true" /> : <ChevronRight size={12} aria-hidden="true" />}
          <Folder size={13} aria-hidden="true" />
          <span>{node.name}</span>
        </button>
        {isExpanded ? (
          <div className="editor-browser-children">
            {(node.children ?? []).map((child) => (
              <FileNode key={child.relativePath} node={child} rootPath={rootPath} selectedPath={selectedPath} onOpenFile={onOpenFile} />
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
