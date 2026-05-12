import { Search } from 'lucide-react'
import { useEffect, useRef, useState, type ReactElement } from 'react'
import { selectFilteredFiles, selectGitState, useGitStore } from '../../store/git.store'
import { DiffCard } from './DiffCard'
import { ReviewFileTree } from './ReviewFileTree'
import { ReviewToolbar } from './ReviewToolbar'

interface ReviewPaneProps {
  workspaceId: string
  rootPath: string
}

export function ReviewPane({ workspaceId, rootPath }: ReviewPaneProps): ReactElement {
  const {
    loadDiff, subscribeToUpdates,
    setBase, setIncludeUncommitted, markRead,
    selectFile, setViewMode, setSortBy, setSearch
  } = useGitStore()

  const ws = useGitStore(selectGitState(workspaceId))
  const [readFilter, setReadFilter] = useState(false)
  const [caseSearch, setCaseSearch] = useState(false)
  const files = useGitStore(selectFilteredFiles(workspaceId, readFilter))

  const cardRefs = useRef<Map<string, HTMLDivElement>>(new Map())

  useEffect(() => {
    void loadDiff(workspaceId, rootPath)
    return subscribeToUpdates(workspaceId)
  }, [loadDiff, subscribeToUpdates, workspaceId, rootPath, ws.base, ws.includeUncommitted])

  useEffect(() => {
    if (ws.selectedFile) {
      const el = cardRefs.current.get(ws.selectedFile)
      el?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }
  }, [ws.selectedFile])

  const currentIndex = ws.selectedFile ? files.findIndex((f) => f.path === ws.selectedFile) : 0

  function handleNavigate(dir: -1 | 1): void {
    const next = Math.max(0, Math.min(files.length - 1, currentIndex + dir))
    if (files[next]) selectFile(workspaceId, files[next].path)
  }

  return (
    <div className="review-pane">
      <ReviewToolbar
        base={ws.base}
        includeUncommitted={ws.includeUncommitted}
        readFilter={readFilter}
        sortBy={ws.sortBy}
        totalFiles={files.length}
        currentIndex={currentIndex}
        onBaseChange={(base) => setBase(workspaceId, base)}
        onToggleUncommitted={() => setIncludeUncommitted(workspaceId, !ws.includeUncommitted)}
        onToggleReadFilter={() => setReadFilter((v) => !v)}
        onSortChange={(s) => setSortBy(workspaceId, s)}
        onNavigate={handleNavigate}
      />

      <div className="review-search">
        <Search size={11} style={{ color: 'var(--tx-muted)', flexShrink: 0 }} aria-hidden="true" />
        <input
          type="text"
          className="review-search-input"
          placeholder="Search... (Ctrl+F, /)"
          value={ws.search}
          onChange={(e) => setSearch(workspaceId, e.target.value)}
          aria-label="Search files"
        />
        <button
          type="button"
          className={`review-case-btn${caseSearch ? ' active' : ''}`}
          onClick={() => setCaseSearch((v) => !v)}
          title="Case sensitive"
          aria-pressed={caseSearch}
        >Aa</button>
      </div>

      {ws.isLoading && <div className="review-pane-empty">Loading diff…</div>}
      {ws.error && (
        <div className="review-pane-alert">
          <span>{ws.error}</span>
        </div>
      )}

      {!ws.isLoading && !ws.error && (
        <>
          {files.length > 0 && (
            <ReviewFileTree
              files={files}
              viewMode={ws.viewMode}
              onViewModeChange={(m) => setViewMode(workspaceId, m)}
              selectedFile={ws.selectedFile}
              onSelectFile={(p) => selectFile(workspaceId, p)}
            />
          )}

          {files.length === 0 ? (
            <div className="review-pane-empty">
              {ws.diff ? 'No changes found' : 'No diff loaded'}
            </div>
          ) : (
            <div className="review-cards">
              {files.map((file) => (
                <div
                  key={file.path}
                  ref={(el) => {
                    if (el) cardRefs.current.set(file.path, el)
                    else cardRefs.current.delete(file.path)
                  }}
                >
                  <DiffCard
                    file={file}
                    isRead={ws.readFiles.includes(file.path)}
                    onMarkRead={() => markRead(workspaceId, file.path)}
                  />
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  )
}
