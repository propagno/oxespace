import { type ReactElement } from 'react'
import type { GitDiffFile } from '../../../shared/types/git'

interface DirNode {
  name: string
  fullPath: string
  additions: number
  deletions: number
  children: DirNode[]
  files: GitDiffFile[]
}

function buildTree(files: GitDiffFile[]): DirNode {
  const root: DirNode = { name: '', fullPath: '', additions: 0, deletions: 0, children: [], files: [] }

  for (const file of files) {
    const parts = file.path.split('/')
    let node = root
    for (let i = 0; i < parts.length - 1; i++) {
      const part = parts[i]
      let child = node.children.find((c) => c.name === part)
      if (!child) {
        const fullPath = parts.slice(0, i + 1).join('/')
        child = { name: part, fullPath, additions: 0, deletions: 0, children: [], files: [] }
        node.children.push(child)
      }
      node = child
    }
    node.files.push(file)
  }

  function rollup(node: DirNode): void {
    for (const child of node.children) rollup(child)
    for (const child of node.children) {
      node.additions += child.additions
      node.deletions += child.deletions
    }
    for (const f of node.files) {
      node.additions += f.additions
      node.deletions += f.deletions
    }
  }
  rollup(root)

  return root
}

interface FileRowProps {
  label: string
  additions: number
  deletions: number
  depth: number
  selected: boolean
  onClick: () => void
}

function FileRow({ label, additions, deletions, depth, selected, onClick }: FileRowProps): ReactElement {
  return (
    <div
      className={`review-tree-row${selected ? ' selected' : ''}`}
      style={{ paddingLeft: depth * 12 + 8 }}
      onClick={onClick}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => e.key === 'Enter' && onClick()}
    >
      <span style={{ color: 'var(--tx-secondary)', fontSize: 11 }}>{label}</span>
      <span className="review-tree-stats">
        {additions > 0 && <span className="review-stat-add">+{additions}</span>}
        {deletions > 0 && <span className="review-stat-del">-{deletions}</span>}
      </span>
    </div>
  )
}

interface ReviewFileTreeProps {
  files: GitDiffFile[]
  viewMode: 'structured' | 'flat'
  onViewModeChange: (mode: 'structured' | 'flat') => void
  selectedFile: string | null
  onSelectFile: (path: string) => void
}

function StructuredTree({ node, depth, selectedFile, onSelectFile }: { node: DirNode; depth: number; selectedFile: string | null; onSelectFile: (p: string) => void }): ReactElement {
  return (
    <>
      {node.children.map((child) => (
        <div key={child.fullPath}>
          <FileRow
            label={child.name + '/'}
            additions={child.additions}
            deletions={child.deletions}
            depth={depth}
            selected={false}
            onClick={() => {}}
          />
          <StructuredTree node={child} depth={depth + 1} selectedFile={selectedFile} onSelectFile={onSelectFile} />
        </div>
      ))}
      {node.files.map((f) => (
        <FileRow
          key={f.path}
          label={f.path.split('/').at(-1) ?? f.path}
          additions={f.additions}
          deletions={f.deletions}
          depth={depth}
          selected={selectedFile === f.path}
          onClick={() => onSelectFile(f.path)}
        />
      ))}
    </>
  )
}

export function ReviewFileTree({ files, viewMode, onViewModeChange, selectedFile, onSelectFile }: ReviewFileTreeProps): ReactElement {
  return (
    <div className="review-file-tree">
      <div className="review-file-tree-header">
        <span>Files</span>
        <div className="review-view-toggle">
          <button
            type="button"
            className={`review-view-btn${viewMode === 'structured' ? ' active' : ''}`}
            onClick={() => onViewModeChange('structured')}
          >Structured</button>
          <button
            type="button"
            className={`review-view-btn${viewMode === 'flat' ? ' active' : ''}`}
            onClick={() => onViewModeChange('flat')}
          >Flat</button>
        </div>
      </div>

      {viewMode === 'structured' ? (
        <StructuredTree node={buildTree(files)} depth={0} selectedFile={selectedFile} onSelectFile={onSelectFile} />
      ) : (
        files.map((f) => (
          <FileRow
            key={f.path}
            label={f.path}
            additions={f.additions}
            deletions={f.deletions}
            depth={0}
            selected={selectedFile === f.path}
            onClick={() => onSelectFile(f.path)}
          />
        ))
      )}
    </div>
  )
}
