import { Check, ChevronDown, ChevronRight } from 'lucide-react'
import { Fragment, useMemo, useState, type ReactElement } from 'react'
import type { GitDiffFile, GitDiffHunk, GitDiffLine } from '../../../shared/types/git'
import type { DiffMode } from '../../store/git.store'

interface DiffCardProps {
  file: GitDiffFile
  isReviewed: boolean
  isSelected: boolean
  diffMode: DiffMode
  onToggleReviewed: () => void
  onSelect: () => void
}

function relativeTime(mtime: number | null): string {
  if (mtime === null) return ''
  const diffSec = Math.floor((Date.now() / 1000) - mtime)
  if (diffSec < 60) return 'just now'
  if (diffSec < 3600) return `${Math.floor(diffSec / 60)}m ago`
  if (diffSec < 86400) return `${Math.floor(diffSec / 3600)}h ago`
  return `${Math.floor(diffSec / 86400)}d ago`
}

export function DiffCard({ diffMode, file, isReviewed, isSelected, onSelect, onToggleReviewed }: DiffCardProps): ReactElement {
  const [collapsed, setCollapsed] = useState(false)

  return (
    <div
      className={`review-card${isSelected ? ' selected' : ''}${isReviewed ? ' reviewed' : ''}`}
      onClick={onSelect}
    >
      <div className="review-card-header">
        <button
          type="button"
          className="review-card-collapse-btn"
          aria-label={collapsed ? 'Expand diff' : 'Collapse diff'}
          aria-expanded={!collapsed}
          onClick={(e) => { e.stopPropagation(); setCollapsed((c) => !c) }}
        >
          {collapsed ? <ChevronRight size={11} aria-hidden="true" /> : <ChevronDown size={11} aria-hidden="true" />}
        </button>

        <label className="review-card-reviewed" onClick={(e) => e.stopPropagation()}>
          <input
            type="checkbox"
            checked={isReviewed}
            onChange={onToggleReviewed}
            aria-label={`Mark ${file.path} as reviewed`}
          />
          {isReviewed ? <Check size={10} aria-hidden="true" /> : null}
          <span className="review-card-reviewed-text">{isReviewed ? 'Reviewed' : 'Mark reviewed'}</span>
        </label>

        <span className="review-card-path" title={file.path}>{file.path}</span>

        <span className="review-tree-stats">
          {file.additions > 0 && <span className="review-stat-add">+{file.additions}</span>}
          {file.deletions > 0 && <span className="review-stat-del">-{file.deletions}</span>}
        </span>
        {file.mtime !== null && <span className="review-card-time">{relativeTime(file.mtime)}</span>}
      </div>

      {!collapsed && (
        diffMode === 'side-by-side' ? (
          <SideBySideDiff hunks={file.hunks} label={file.path} />
        ) : (
          <UnifiedDiff hunks={file.hunks} label={file.path} />
        )
      )}
    </div>
  )
}

interface DiffViewProps {
  hunks: GitDiffHunk[]
  label: string
}

function UnifiedDiff({ hunks, label }: DiffViewProps): ReactElement {
  return (
    <table className="review-diff-table" aria-label={`Diff for ${label}`}>
      <tbody>
        {hunks.map((hunk, hi) => (
          <Fragment key={`hunk-${hi}`}>
            <tr className="diff-line--hunk-header">
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
          </Fragment>
        ))}
      </tbody>
    </table>
  )
}

/**
 * Pairs sequential removed+added lines so they appear side-by-side. Lines that
 * have no counterpart land in a single column (with the other side blank).
 * Simple O(N) scan — not Myers-perfect but matches how Codex Desktop chunks
 * adjacent removals/additions visually.
 */
interface PairedRow { left: GitDiffLine | null; right: GitDiffLine | null }

function pairHunkLines(lines: GitDiffLine[]): PairedRow[] {
  const out: PairedRow[] = []
  let i = 0
  while (i < lines.length) {
    const line = lines[i]
    if (line.type === 'context') {
      out.push({ left: line, right: line })
      i += 1
      continue
    }
    if (line.type === 'removed') {
      // Collect adjacent removeds, then adjacent addeds, then pair them up.
      const removed: GitDiffLine[] = []
      while (i < lines.length && lines[i].type === 'removed') { removed.push(lines[i]); i += 1 }
      const added: GitDiffLine[] = []
      while (i < lines.length && lines[i].type === 'added') { added.push(lines[i]); i += 1 }
      const max = Math.max(removed.length, added.length)
      for (let k = 0; k < max; k++) {
        out.push({ left: removed[k] ?? null, right: added[k] ?? null })
      }
      continue
    }
    if (line.type === 'added') {
      // Added without preceding removed — only on the right.
      out.push({ left: null, right: line })
      i += 1
      continue
    }
    i += 1
  }
  return out
}

function SideBySideDiff({ hunks, label }: DiffViewProps): ReactElement {
  const rows = useMemo(() => hunks.map((h) => ({ header: h.header, pairs: pairHunkLines(h.lines) })), [hunks])
  return (
    <table className="review-diff-table review-diff-table--split" aria-label={`Side-by-side diff for ${label}`}>
      <tbody>
        {rows.map((hunk, hi) => (
          <Fragment key={`sbs-${hi}`}>
            <tr className="diff-line--hunk-header">
              <td className="review-diff-ln" />
              <td className="review-diff-content" colSpan={3}>{hunk.header}</td>
            </tr>
            {hunk.pairs.map((pair, ri) => (
              <tr key={`${hi}-${ri}`} className="diff-sbs-row">
                <td className={`review-diff-ln${pair.left ? ` diff-line--${pair.left.type}` : ''}`}>
                  {pair.left?.oldLineNo ?? ''}
                </td>
                <td className={`review-diff-content review-diff-content--left${pair.left ? ` diff-line--${pair.left.type}` : ' diff-line--blank'}`}>
                  {pair.left ? pair.left.content : ''}
                </td>
                <td className={`review-diff-ln${pair.right ? ` diff-line--${pair.right.type}` : ''}`}>
                  {pair.right?.newLineNo ?? ''}
                </td>
                <td className={`review-diff-content review-diff-content--right${pair.right ? ` diff-line--${pair.right.type}` : ' diff-line--blank'}`}>
                  {pair.right ? pair.right.content : ''}
                </td>
              </tr>
            ))}
          </Fragment>
        ))}
      </tbody>
    </table>
  )
}
