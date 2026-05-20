import { Check, ChevronLeft, ChevronRight, Columns2, Rows3 } from 'lucide-react'
import { type ReactElement } from 'react'
import type { DiffMode } from '../../store/git.store'

const BASE_OPTIONS = ['origin/main', 'origin/master', 'HEAD~1', 'HEAD~5']

interface ReviewToolbarProps {
  base: string
  includeUncommitted: boolean
  hideReviewed: boolean
  sortBy: 'last-edit' | 'name'
  diffMode: DiffMode
  totalFiles: number
  reviewedCount: number
  currentIndex: number
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
  currentIndex,
  diffMode,
  hideReviewed,
  includeUncommitted,
  onBaseChange,
  onClearReviewed,
  onDiffModeChange,
  onNavigate,
  onSortChange,
  onToggleHideReviewed,
  onToggleUncommitted,
  reviewedCount,
  sortBy,
  totalFiles
}: ReviewToolbarProps): ReactElement {
  return (
    <div className="review-toolbar review-toolbar-v2">
      <span className="review-toolbar-label">Base</span>
      <select
        className="review-base-select"
        value={BASE_OPTIONS.includes(base) ? base : 'custom'}
        onChange={(e) => {
          if (e.target.value !== 'custom') onBaseChange(e.target.value)
        }}
        aria-label="Diff base branch"
      >
        {BASE_OPTIONS.map((opt) => (
          <option key={opt} value={opt}>{opt}</option>
        ))}
        {!BASE_OPTIONS.includes(base) && <option value="custom">{base}</option>}
      </select>

      <div className="review-toolbar-sep" />

      <button
        type="button"
        className={`review-toggle-btn${includeUncommitted ? ' active' : ''}`}
        onClick={onToggleUncommitted}
        aria-pressed={includeUncommitted}
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
          <Rows3 size={11} aria-hidden="true" />
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
          <Columns2 size={11} aria-hidden="true" />
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
        <Check size={11} aria-hidden="true" />
        {reviewedCount}/{totalFiles}
      </span>
      {reviewedCount > 0 ? (
        <button type="button" className="review-clear-reviewed" onClick={onClearReviewed}>
          Clear
        </button>
      ) : null}

      <div className="review-counter">
        <button type="button" className="review-nav-btn" onClick={() => onNavigate(-1)} aria-label="Previous file (k)" disabled={currentIndex <= 0}>
          <ChevronLeft size={10} aria-hidden="true" />
        </button>
        <span>{totalFiles > 0 ? `${currentIndex + 1}/${totalFiles}` : '0/0'}</span>
        <button type="button" className="review-nav-btn" onClick={() => onNavigate(1)} aria-label="Next file (j)" disabled={currentIndex >= totalFiles - 1}>
          <ChevronRight size={10} aria-hidden="true" />
        </button>
      </div>
    </div>
  )
}
