import { ChevronDown, FileText, Folder } from 'lucide-react'
import type { ReactElement } from 'react'
import type { FileTreeNode } from '../../../shared/types/ipc'

interface FileBrowserProps {
  nodes: FileTreeNode[]
  selectedPath: string | null
  onOpenFile: (relativePath: string) => void
}

export function FileBrowser({ nodes, onOpenFile, selectedPath }: FileBrowserProps): ReactElement {
  if (nodes.length === 0) {
    return <div className="editor-browser-empty">No files</div>
  }

  return (
    <nav className="editor-browser" aria-label="Workspace files">
      {nodes.map((node) => (
        <FileNode key={node.relativePath} node={node} selectedPath={selectedPath} onOpenFile={onOpenFile} />
      ))}
    </nav>
  )
}

interface FileNodeProps {
  node: FileTreeNode
  selectedPath: string | null
  onOpenFile: (relativePath: string) => void
}

function FileNode({ node, onOpenFile, selectedPath }: FileNodeProps): ReactElement {
  if (node.type === 'directory') {
    return (
      <div className="editor-browser-node">
        <div className="editor-browser-directory">
          <ChevronDown size={12} aria-hidden="true" />
          <Folder size={13} aria-hidden="true" />
          <span>{node.name}</span>
        </div>
        <div className="editor-browser-children">
          {(node.children ?? []).map((child) => (
            <FileNode key={child.relativePath} node={child} selectedPath={selectedPath} onOpenFile={onOpenFile} />
          ))}
        </div>
      </div>
    )
  }

  return (
    <button
      type="button"
      className={`editor-browser-file${selectedPath === node.relativePath ? ' active' : ''}`}
      title={node.relativePath}
      onClick={() => onOpenFile(node.relativePath)}
    >
      <FileText size={13} aria-hidden="true" />
      <span>{node.name}</span>
    </button>
  )
}
