import { Maximize2, ChevronLeft, ChevronRight } from 'lucide-react'
import { type ReactElement } from 'react'

const BASE_OPTIONS = ['origin/main', 'origin/master', 'HEAD~1', 'HEAD~5']

interface ReviewToolbarProps {
  base: string
  includeUncommitted: boolean
  readFilter: boolean
  sortBy: 'last-edit' | 'name'
  totalFiles: number
  currentIndex: number
  onBaseChange: (base: string) => void
  onToggleUncommitted: () => void
  onToggleReadFilter: () => void
  onSortChange: (sortBy: 'last-edit' | 'name') => void
  onNavigate: (dir: -1 | 1) => void
  onFullScreen?: () => void
}

export function ReviewToolbar({
  base,
  includeUncommitted,
  readFilter,
  sortBy,
  totalFiles,
  currentIndex,
  onBaseChange,
  onToggleUncommitted,
  onToggleReadFilter,
  onSortChange,
  onNavigate,
  onFullScreen
}: ReviewToolbarProps): ReactElement {
  return (
    <div className="review-toolbar">
      {onFullScreen && (
        <>
          <button type="button" className="review-toggle-btn" onClick={onFullScreen} title="Full-screen review" aria-label="Full-screen review">
            <Maximize2 size={11} aria-hidden="true" />
          </button>
          <div className="review-toolbar-sep" />
        </>
      )}

      <span style={{ color: 'var(--tx-muted)', fontSize: 11 }}>Base:</span>
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
        className={`review-toggle-btn${readFilter ? ' active' : ''}`}
        onClick={onToggleReadFilter}
        aria-pressed={readFilter}
      >
        Unread only
      </button>

      <div className="review-toolbar-sep" />

      <span style={{ color: 'var(--tx-muted)', fontSize: 11 }}>Sort:</span>
      <select
        className="review-base-select"
        value={sortBy}
        onChange={(e) => onSortChange(e.target.value as 'last-edit' | 'name')}
        aria-label="Sort order"
      >
        <option value="last-edit">Last edit</option>
        <option value="name">Name</option>
      </select>

      <div className="review-counter">
        <button type="button" className="review-nav-btn" onClick={() => onNavigate(-1)} aria-label="Previous file" disabled={currentIndex <= 0}>
          <ChevronLeft size={10} aria-hidden="true" />
        </button>
        <span>{totalFiles > 0 ? `${currentIndex + 1}/${totalFiles}` : '0/0'}</span>
        <button type="button" className="review-nav-btn" onClick={() => onNavigate(1)} aria-label="Next file" disabled={currentIndex >= totalFiles - 1}>
          <ChevronRight size={10} aria-hidden="true" />
        </button>
      </div>
    </div>
  )
}
