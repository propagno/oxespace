import { useState, type ReactElement } from 'react'
import type { GitDiffFile } from '../../../shared/types/git'

interface DiffCardProps {
  file: GitDiffFile
  isRead: boolean
  onMarkRead: () => void
}

function relativeTime(mtime: number | null): string {
  if (mtime === null) return ''
  const diffSec = Math.floor((Date.now() / 1000) - mtime)
  if (diffSec < 60) return 'just now'
  if (diffSec < 3600) return `${Math.floor(diffSec / 60)}m ago`
  if (diffSec < 86400) return `${Math.floor(diffSec / 3600)}h ago`
  return `${Math.floor(diffSec / 86400)}d ago`
}

export function DiffCard({ file, isRead, onMarkRead }: DiffCardProps): ReactElement {
  const [collapsed, setCollapsed] = useState(false)

  return (
    <div className="review-card">
      <div
        className="review-card-header"
        onClick={() => setCollapsed((c) => !c)}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => e.key === 'Enter' && setCollapsed((c) => !c)}
        aria-expanded={!collapsed}
      >
        <span
          className={`review-card-read-dot${isRead ? ' read' : ''}`}
          title={isRead ? 'Read' : 'Mark as read'}
          onClick={(e) => { e.stopPropagation(); onMarkRead() }}
        />
        <span className="review-card-path" title={file.path}>{file.path}</span>
        <span className="review-tree-stats">
          {file.additions > 0 && <span className="review-stat-add">+{file.additions}</span>}
          {file.deletions > 0 && <span className="review-stat-del">-{file.deletions}</span>}
        </span>
        {file.mtime !== null && <span className="review-card-time">{relativeTime(file.mtime)}</span>}
        <span className="review-card-collapse">{collapsed ? '▶' : '▼'}</span>
      </div>

      {!collapsed && (
        <table className="review-diff-table" aria-label={`Diff for ${file.path}`}>
          <tbody>
            {file.hunks.map((hunk, hi) => (
              <>
                <tr key={`hunk-${hi}`} className="diff-line--hunk-header">
                  <td className="review-diff-ln" />
                  <td className="review-diff-ln" />
                  <td className="review-diff-content">{hunk.header}</td>
                </tr>
                {hunk.lines.map((line, li) => (
                  <tr key={`${hi}-${li}`} className={`diff-line--${line.type}`}>
                    <td className="review-diff-ln">{line.oldLineNo ?? ''}</td>
                    <td className="review-diff-ln">{line.newLineNo ?? ''}</td>
                    <td className="review-diff-content">{line.content}</td>
                  </tr>
                ))}
              </>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}
