import { Check, ChevronLeft, ChevronRight, Columns2, FolderGit2, Rows3, Send } from 'lucide-react'
import { type ReactElement } from 'react'
import type { GitHubWorktree } from '../../../shared/types/github'
import type { DiffMode } from '../../store/git.store'
import { RefPicker, type RefPickerBranch } from '../Changes/RefPicker'

/** Relative refs the old fixed list offered; kept as shortcuts next to the real branches. */
const BASE_SHORTCUTS = ['@{upstream}', 'HEAD~1', 'HEAD~5']
const withShortcuts = (branches: RefPickerBranch[]): RefPickerBranch[] => [...branches, ...BASE_SHORTCUTS.map(name => ({ name, remote: false }))]

interface ReviewToolbarProps {
  base: string
  /** Side B as a ref; null is the work tree. */
  head: string | null
  branches: RefPickerBranch[]
  rootPath: string
  onHeadChange: (head: string | null) => void
  includeUncommitted: boolean
  hideReviewed: boolean
  sortBy: 'last-edit' | 'name'
  diffMode: DiffMode
  totalFiles: number
  reviewedCount: number
  currentIndex: number
  /** #7 Annotate AI Diffs: pending comment count + ship-to-agent action. */
  commentCount: number
  onSendComments: () => void
  onBaseChange: (base: string) => void
  onToggleUncommitted: () => void
  onToggleHideReviewed: () => void
  onSortChange: (sortBy: 'last-edit' | 'name') => void
  onDiffModeChange: (mode: DiffMode) => void
  onClearReviewed: () => void
  onNavigate: (dir: -1 | 1) => void
}

export function ReviewToolbar({
  base,
  head,
  branches,
  rootPath,
  onHeadChange,
  commentCount,
  currentIndex,
  diffMode,
  hideReviewed,
  includeUncommitted,
  onBaseChange,
  onClearReviewed,
  onDiffModeChange,
  onNavigate,
  onSendComments,
  onSortChange,
  onToggleHideReviewed,
  onToggleUncommitted,
  reviewedCount,
  sortBy,
  totalFiles
}: ReviewToolbarProps): ReactElement {
  return (
    <div className="review-toolbar review-toolbar-v2">
      {commentCount > 0 ? (
        <button
          type="button"
          className="review-send-comments"
          data-testid="review-send-comments"
          title="Send the diff comments to the active agent"
          onClick={onSendComments}
        >
          <Send size={12} aria-hidden="true" />
          <span>Enviar {commentCount} ao agente</span>
        </button>
      ) : null}
      <RefPicker
        label="Diff base branch"
        value={base}
        branches={withShortcuts(branches)}
        selected={`ref:${base}`}
        onPickRef={onBaseChange}
      />
      <RefPicker
        label="Compare (side B)"
        value={head ?? 'Work tree'}
        icon={head ? undefined : <FolderGit2 size={14} aria-hidden="true" />}
        branches={branches}
        worktrees={[{ path: rootPath, branch: 'Work tree', head: null, isMain: true, locked: false } as GitHubWorktree]}
        selected={head ? `ref:${head}` : `tree:${rootPath}`}
        onPickRef={onHeadChange}
        onPickWorktree={() => onHeadChange(null)}
      />

      <div className="review-toolbar-sep" />

      <button
        type="button"
        className={`review-toggle-btn${includeUncommitted && !head ? ' active' : ''}`}
        onClick={onToggleUncommitted}
        aria-pressed={includeUncommitted && !head}
        disabled={Boolean(head)}
        title={head ? 'A ref has no uncommitted changes' : undefined}
      >
        Uncommitted
      </button>

      <button
        type="button"
        className={`review-toggle-btn${hideReviewed ? ' active' : ''}`}
        onClick={onToggleHideReviewed}
        aria-pressed={hideReviewed}
      >
        Hide reviewed
      </button>

      <div className="review-toolbar-sep" />

      <span className="review-toolbar-label">View</span>
      <div className="review-diff-mode-toggle" role="radiogroup" aria-label="Diff mode">
        <button
          type="button"
          role="radio"
          aria-checked={diffMode === 'unified'}
          className={`review-diff-mode-btn${diffMode === 'unified' ? ' active' : ''}`}
          onClick={() => onDiffModeChange('unified')}
          title="Unified diff"
        >
          <Rows3 size={12} aria-hidden="true" />
          Unified
        </button>
        <button
          type="button"
          role="radio"
          aria-checked={diffMode === 'side-by-side'}
          className={`review-diff-mode-btn${diffMode === 'side-by-side' ? ' active' : ''}`}
          onClick={() => onDiffModeChange('side-by-side')}
          title="Side-by-side diff"
        >
          <Columns2 size={12} aria-hidden="true" />
          Split
        </button>
      </div>

      <div className="review-toolbar-sep" />

      <span className="review-toolbar-label">Sort</span>
      <select
        className="review-base-select"
        value={sortBy}
        onChange={(e) => onSortChange(e.target.value as 'last-edit' | 'name')}
        aria-label="Sort order"
      >
        <option value="last-edit">Last edit</option>
        <option value="name">Name</option>
      </select>

      <div className="review-toolbar-sep" />

      <span className="review-reviewed-counter" title="Reviewed / total files">
        <Check size={12} aria-hidden="true" />
        {reviewedCount}/{totalFiles}
      </span>
      {reviewedCount > 0 ? (
        <button type="button" className="review-clear-reviewed" onClick={onClearReviewed}>
          Clear
        </button>
      ) : null}

      <div className="review-counter">
        <button type="button" className="review-nav-btn" onClick={() => onNavigate(-1)} aria-label="Previous file (k)" disabled={currentIndex <= 0}>
          <ChevronLeft size={12} aria-hidden="true" />
        </button>
        <span>{totalFiles > 0 ? `${currentIndex + 1}/${totalFiles}` : '0/0'}</span>
        <button type="button" className="review-nav-btn" onClick={() => onNavigate(1)} aria-label="Next file (j)" disabled={currentIndex >= totalFiles - 1}>
          <ChevronRight size={12} aria-hidden="true" />
        </button>
      </div>
    </div>
  )
}
