import { Check, ChevronDown, ChevronRight, MessageSquarePlus, Trash2 } from 'lucide-react'
import { Fragment, useMemo, useState, type ReactElement } from 'react'
import type { GitDiffFile, GitDiffHunk, GitDiffLine } from '../../../shared/types/git'
import { commentAnchor, type DiffComment, type DiffSide } from '../../../shared/types/diff-comments'
import { useDiffCommentsStore } from '../../store/diff-comments.store'
import type { DiffMode } from '../../store/git.store'

interface DiffCardProps {
  file: GitDiffFile
  workspaceId: string
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

/** Anchor side/line for a diff line: added/context → new side, removed → old. */
function lineAnchor(line: GitDiffLine): { side: DiffSide; lineNo: number } | null {
  if (line.newLineNo !== null) return { side: 'new', lineNo: line.newLineNo }
  if (line.oldLineNo !== null) return { side: 'old', lineNo: line.oldLineNo }
  return null
}

export function DiffCard({ diffMode, file, isReviewed, isSelected, onSelect, onToggleReviewed, workspaceId }: DiffCardProps): ReactElement {
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
          <SideBySideDiff hunks={file.hunks} label={file.path} filePath={file.path} workspaceId={workspaceId} />
        ) : (
          <UnifiedDiff hunks={file.hunks} label={file.path} filePath={file.path} workspaceId={workspaceId} />
        )
      )}
    </div>
  )
}

interface DiffViewProps {
  hunks: GitDiffHunk[]
  label: string
  filePath: string
  workspaceId: string
}

/** Per-file comment plumbing shared by both diff views. */
function useFileComments(workspaceId: string, filePath: string): {
  byAnchor: Map<string, DiffComment[]>
  editing: string | null
  setEditing: (anchor: string | null) => void
  saveComment: (side: DiffSide, lineNo: number, lineContent: string, body: string) => void
  removeComment: (id: string) => void
} {
  const comments = useDiffCommentsStore((s) => s.comments)
  const add = useDiffCommentsStore((s) => s.add)
  const removeComment = useDiffCommentsStore((s) => s.remove)
  const [editing, setEditing] = useState<string | null>(null)

  const byAnchor = useMemo(() => {
    const map = new Map<string, DiffComment[]>()
    for (const c of comments) {
      if (c.workspaceId !== workspaceId || c.filePath !== filePath) continue
      const key = commentAnchor(c.filePath, c.side, c.lineNo)
      const arr = map.get(key) ?? []
      arr.push(c)
      map.set(key, arr)
    }
    return map
  }, [comments, workspaceId, filePath])

  const saveComment = (side: DiffSide, lineNo: number, lineContent: string, body: string): void => {
    const trimmed = body.trim()
    if (!trimmed) return
    add({ workspaceId, filePath, side, lineNo, lineContent, body: trimmed })
    setEditing(null)
  }

  return { byAnchor, editing, setEditing, saveComment, removeComment }
}

interface CommentRowsProps {
  colSpan: number
  anchor: string
  comments: DiffComment[]
  isEditing: boolean
  onCancelEdit: () => void
  onSave: (body: string) => void
  onRemove: (id: string) => void
}

/** Rendered under a diff line: existing comment rows + the inline editor. */
function CommentRows({ anchor, colSpan, comments, isEditing, onCancelEdit, onRemove, onSave }: CommentRowsProps): ReactElement | null {
  const [draft, setDraft] = useState('')
  if (comments.length === 0 && !isEditing) return null
  return (
    <>
      {comments.map((c) => (
        <tr key={c.id} className="diff-comment-row" data-testid="diff-comment-row">
          <td className="review-diff-content diff-comment-cell" colSpan={colSpan}>
            <MessageSquarePlus size={11} aria-hidden="true" className="diff-comment-icon" />
            <span className="diff-comment-body">{c.body}</span>
            <button
              type="button"
              className="diff-comment-delete"
              aria-label="Delete comment"
              onClick={(e) => { e.stopPropagation(); onRemove(c.id) }}
            >
              <Trash2 size={11} aria-hidden="true" />
            </button>
          </td>
        </tr>
      ))}
      {isEditing ? (
        <tr className="diff-comment-row diff-comment-row--editor" data-testid="diff-comment-editor">
          <td className="review-diff-content diff-comment-cell" colSpan={colSpan}>
            <textarea
              autoFocus
              className="diff-comment-input"
              placeholder="Comment for the agent… (Ctrl+Enter saves)"
              value={draft}
              rows={2}
              aria-label={`Comment on ${anchor}`}
              onClick={(e) => e.stopPropagation()}
              onChange={(e) => setDraft(e.currentTarget.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); onSave(draft); setDraft('') }
                if (e.key === 'Escape') { e.preventDefault(); setDraft(''); onCancelEdit() }
              }}
            />
            <div className="diff-comment-actions">
              <button type="button" className="diff-comment-save" onClick={(e) => { e.stopPropagation(); onSave(draft); setDraft('') }}>
                Add
              </button>
              <button type="button" className="diff-comment-cancel" onClick={(e) => { e.stopPropagation(); setDraft(''); onCancelEdit() }}>
                Cancel
              </button>
            </div>
          </td>
        </tr>
      ) : null}
    </>
  )
}

function UnifiedDiff({ hunks, label, filePath, workspaceId }: DiffViewProps): ReactElement {
  const { byAnchor, editing, setEditing, saveComment, removeComment } = useFileComments(workspaceId, filePath)

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
            {hunk.lines.map((line, li) => {
              const anchor = lineAnchor(line)
              const key = anchor ? commentAnchor(filePath, anchor.side, anchor.lineNo) : null
              const lineComments = key ? byAnchor.get(key) ?? [] : []
              return (
                <Fragment key={`${hi}-${li}`}>
                  <tr className={`diff-line--${line.type} diff-line--commentable`}>
                    <td className="review-diff-ln">{line.oldLineNo ?? ''}</td>
                    <td className="review-diff-ln">{line.newLineNo ?? ''}</td>
                    <td className="review-diff-content">
                      {line.content}
                      {anchor ? (
                        <button
                          type="button"
                          className="diff-comment-add"
                          data-testid="diff-comment-add"
                          aria-label={`Comment on line ${anchor.lineNo}`}
                          title="Comentar esta linha"
                          onClick={(e) => { e.stopPropagation(); setEditing(key) }}
                        >
                          <MessageSquarePlus size={11} aria-hidden="true" />
                        </button>
                      ) : null}
                    </td>
                  </tr>
                  {anchor && key ? (
                    <CommentRows
                      anchor={key}
                      colSpan={3}
                      comments={lineComments}
                      isEditing={editing === key}
                      onCancelEdit={() => setEditing(null)}
                      onSave={(body) => saveComment(anchor.side, anchor.lineNo, line.content, body)}
                      onRemove={removeComment}
                    />
                  ) : null}
                </Fragment>
              )
            })}
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

function SideBySideDiff({ hunks, label, filePath, workspaceId }: DiffViewProps): ReactElement {
  const rows = useMemo(() => hunks.map((h) => ({ header: h.header, pairs: pairHunkLines(h.lines) })), [hunks])
  const { byAnchor, editing, setEditing, saveComment, removeComment } = useFileComments(workspaceId, filePath)

  return (
    <table className="review-diff-table review-diff-table--split" aria-label={`Side-by-side diff for ${label}`}>
      <tbody>
        {rows.map((hunk, hi) => (
          <Fragment key={`sbs-${hi}`}>
            <tr className="diff-line--hunk-header">
              <td className="review-diff-ln" />
              <td className="review-diff-content" colSpan={3}>{hunk.header}</td>
            </tr>
            {hunk.pairs.map((pair, ri) => {
              // Anchor to the right (new) side when it exists, else the left.
              const anchorLine = pair.right ?? pair.left
              const anchor = anchorLine ? lineAnchor(anchorLine) : null
              const key = anchor ? commentAnchor(filePath, anchor.side, anchor.lineNo) : null
              const lineComments = key ? byAnchor.get(key) ?? [] : []
              return (
                <Fragment key={`${hi}-${ri}`}>
                  <tr className="diff-sbs-row diff-line--commentable">
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
                      {anchor ? (
                        <button
                          type="button"
                          className="diff-comment-add"
                          data-testid="diff-comment-add"
                          aria-label={`Comment on line ${anchor.lineNo}`}
                          title="Comentar esta linha"
                          onClick={(e) => { e.stopPropagation(); setEditing(key) }}
                        >
                          <MessageSquarePlus size={11} aria-hidden="true" />
                        </button>
                      ) : null}
                    </td>
                  </tr>
                  {anchor && key && anchorLine ? (
                    <CommentRows
                      anchor={key}
                      colSpan={4}
                      comments={lineComments}
                      isEditing={editing === key}
                      onCancelEdit={() => setEditing(null)}
                      onSave={(body) => saveComment(anchor.side, anchor.lineNo, anchorLine.content, body)}
                      onRemove={removeComment}
                    />
                  ) : null}
                </Fragment>
              )
            })}
          </Fragment>
        ))}
      </tbody>
    </table>
  )
}
