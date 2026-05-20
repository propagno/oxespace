import { ChevronDown, ChevronRight, File } from 'lucide-react'
import { type ReactElement } from 'react'
import type { GitDiffFile } from '../../../shared/types/git'

interface DirNode {
  name: string
  fullPath: string
  additions: number
  deletions: number
  reviewedCount: number
  fileCount: number
  children: DirNode[]
  files: GitDiffFile[]
}

function buildTree(files: GitDiffFile[], reviewed: Set<string>): DirNode {
  const root: DirNode = { name: '', fullPath: '', additions: 0, deletions: 0, reviewedCount: 0, fileCount: 0, children: [], files: [] }

  for (const file of files) {
    const parts = file.path.split('/')
    let node = root
    for (let i = 0; i < parts.length - 1; i++) {
      const part = parts[i]
      let child = node.children.find((c) => c.name === part)
      if (!child) {
        const fullPath = parts.slice(0, i + 1).join('/')
        child = { name: part, fullPath, additions: 0, deletions: 0, reviewedCount: 0, fileCount: 0, children: [], files: [] }
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
      node.reviewedCount += child.reviewedCount
      node.fileCount += child.fileCount
    }
    for (const f of node.files) {
      node.additions += f.additions
      node.deletions += f.deletions
      node.fileCount += 1
      if (reviewed.has(f.path)) node.reviewedCount += 1
    }
  }
  rollup(root)

  // Sort children alphabetically, directories first.
  function sortRecursive(node: DirNode): void {
    node.children.sort((a, b) => a.name.localeCompare(b.name))
    node.files.sort((a, b) => a.path.localeCompare(b.path))
    for (const child of node.children) sortRecursive(child)
  }
  sortRecursive(root)

  return root
}

interface DirRowProps {
  node: DirNode
  depth: number
  isCollapsed: boolean
  onToggleCollapsed: () => void
}

function DirRow({ node, depth, isCollapsed, onToggleCollapsed }: DirRowProps): ReactElement {
  const allReviewed = node.fileCount > 0 && node.reviewedCount === node.fileCount
  return (
    <button
      type="button"
      className={`review-tree-dir${allReviewed ? ' all-reviewed' : ''}`}
      style={{ paddingLeft: depth * 12 + 4 }}
      onClick={onToggleCollapsed}
      aria-expanded={!isCollapsed}
    >
      {isCollapsed ? <ChevronRight size={11} aria-hidden="true" /> : <ChevronDown size={11} aria-hidden="true" />}
      <span className="review-tree-dir-name">{node.name}</span>
      <span className="review-tree-dir-meta">
        {node.fileCount > 0 ? `${node.reviewedCount}/${node.fileCount}` : ''}
      </span>
      <span className="review-tree-stats">
        {node.additions > 0 && <span className="review-stat-add">+{node.additions}</span>}
        {node.deletions > 0 && <span className="review-stat-del">-{node.deletions}</span>}
      </span>
    </button>
  )
}

interface FileRowProps {
  file: GitDiffFile
  label: string
  depth: number
  selected: boolean
  reviewed: boolean
  onSelect: () => void
  onToggleReviewed: () => void
}

function FileRow({ depth, file, label, onSelect, onToggleReviewed, reviewed, selected }: FileRowProps): ReactElement {
  return (
    <div
      className={`review-tree-file${selected ? ' selected' : ''}${reviewed ? ' reviewed' : ''}`}
      style={{ paddingLeft: depth * 12 + 8 }}
    >
      <input
        type="checkbox"
        className="review-tree-checkbox"
        checked={reviewed}
        onChange={onToggleReviewed}
        onClick={(e) => e.stopPropagation()}
        aria-label={`Mark ${file.path} as reviewed`}
      />
      <button
        type="button"
        className="review-tree-file-body"
        onClick={onSelect}
        title={file.path}
      >
        <File size={10} aria-hidden="true" className="review-tree-file-icon" />
        <span className="review-tree-file-label">{label}</span>
        <span className="review-tree-stats">
          {file.additions > 0 && <span className="review-stat-add">+{file.additions}</span>}
          {file.deletions > 0 && <span className="review-stat-del">-{file.deletions}</span>}
        </span>
      </button>
    </div>
  )
}

interface RenderNodeProps {
  node: DirNode
  depth: number
  reviewedFiles: Set<string>
  collapsedDirs: Set<string>
  selectedFile: string | null
  onSelectFile: (p: string) => void
  onToggleReviewed: (p: string) => void
  onToggleDirCollapsed: (d: string) => void
}

function RenderNode({ node, depth, reviewedFiles, collapsedDirs, selectedFile, onSelectFile, onToggleReviewed, onToggleDirCollapsed }: RenderNodeProps): ReactElement {
  return (
    <>
      {node.children.map((child) => {
        const collapsed = collapsedDirs.has(child.fullPath)
        return (
          <div key={child.fullPath}>
            <DirRow
              node={child}
              depth={depth}
              isCollapsed={collapsed}
              onToggleCollapsed={() => onToggleDirCollapsed(child.fullPath)}
            />
            {!collapsed && (
              <RenderNode
                node={child}
                depth={depth + 1}
                reviewedFiles={reviewedFiles}
                collapsedDirs={collapsedDirs}
                selectedFile={selectedFile}
                onSelectFile={onSelectFile}
                onToggleReviewed={onToggleReviewed}
                onToggleDirCollapsed={onToggleDirCollapsed}
              />
            )}
          </div>
        )
      })}
      {node.files.map((f) => (
        <FileRow
          key={f.path}
          file={f}
          label={f.path.split('/').at(-1) ?? f.path}
          depth={depth}
          selected={selectedFile === f.path}
          reviewed={reviewedFiles.has(f.path)}
          onSelect={() => onSelectFile(f.path)}
          onToggleReviewed={() => onToggleReviewed(f.path)}
        />
      ))}
    </>
  )
}

interface ReviewFileTreeProps {
  files: GitDiffFile[]
  treeMode: 'structured' | 'flat'
  reviewedFiles: string[]
  collapsedDirs: string[]
  selectedFile: string | null
  onTreeModeChange: (mode: 'structured' | 'flat') => void
  onSelectFile: (path: string) => void
  onToggleReviewed: (path: string) => void
  onToggleDirCollapsed: (dir: string) => void
}

export function ReviewFileTree({
  collapsedDirs,
  files,
  onSelectFile,
  onToggleDirCollapsed,
  onToggleReviewed,
  onTreeModeChange,
  reviewedFiles,
  selectedFile,
  treeMode
}: ReviewFileTreeProps): ReactElement {
  const reviewedSet = new Set(reviewedFiles)
  const collapsedSet = new Set(collapsedDirs)

  return (
    <div className="review-file-tree review-file-tree-v2">
      <div className="review-file-tree-header">
        <span>Files</span>
        <div className="review-view-toggle">
          <button
            type="button"
            className={`review-view-btn${treeMode === 'structured' ? ' active' : ''}`}
            onClick={() => onTreeModeChange('structured')}
          >Tree</button>
          <button
            type="button"
            className={`review-view-btn${treeMode === 'flat' ? ' active' : ''}`}
            onClick={() => onTreeModeChange('flat')}
          >Flat</button>
        </div>
      </div>

      <div className="review-file-tree-list" role="tree">
        {treeMode === 'structured' ? (
          <RenderNode
            node={buildTree(files, reviewedSet)}
            depth={0}
            reviewedFiles={reviewedSet}
            collapsedDirs={collapsedSet}
            selectedFile={selectedFile}
            onSelectFile={onSelectFile}
            onToggleReviewed={onToggleReviewed}
            onToggleDirCollapsed={onToggleDirCollapsed}
          />
        ) : (
          files.map((f) => (
            <FileRow
              key={f.path}
              file={f}
              label={f.path}
              depth={0}
              selected={selectedFile === f.path}
              reviewed={reviewedSet.has(f.path)}
              onSelect={() => onSelectFile(f.path)}
              onToggleReviewed={() => onToggleReviewed(f.path)}
            />
          ))
        )}
      </div>
    </div>
  )
}
