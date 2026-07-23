import { Search } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState, type ReactElement } from 'react'
import { formatDiffComments } from '../../../shared/types/diff-comments'
import { useDiffCommentsStore } from '../../store/diff-comments.store'
import { pasteIntoAgentTerminal } from '../../lib/sendToAgent'
import { selectGitState, useGitStore } from '../../store/git.store'
import { DiffCard } from './DiffCard'
import { ReviewFileTree } from './ReviewFileTree'
import { ReviewToolbar } from './ReviewToolbar'

interface ReviewPaneProps {
  workspaceId: string
  rootPath: string
}

export function ReviewPane({ workspaceId, rootPath }: ReviewPaneProps): ReactElement {
  // Subscribe per slice. Calling useGitStore() without a selector returns a new
  // state-object reference on every set(), which causes useEffect deps that
  // mention destructured actions to re-fire on each unrelated store update.
  // Individual selectors return stable function references (actions are set
  // once in create()), so React only re-runs effects when *their* slice changed.
  const ws = useGitStore(selectGitState(workspaceId))
  const loadDiff = useGitStore((s) => s.loadDiff)
  const subscribeToUpdates = useGitStore((s) => s.subscribeToUpdates)
  const setBase = useGitStore((s) => s.setBase)
  const setIncludeUncommitted = useGitStore((s) => s.setIncludeUncommitted)
  const toggleReviewed = useGitStore((s) => s.toggleReviewed)
  const clearReviewed = useGitStore((s) => s.clearReviewed)
  const setHideReviewed = useGitStore((s) => s.setHideReviewed)
  const selectFile = useGitStore((s) => s.selectFile)
  const setTreeMode = useGitStore((s) => s.setTreeMode)
  const setDiffMode = useGitStore((s) => s.setDiffMode)
  const toggleDirCollapsed = useGitStore((s) => s.toggleDirCollapsed)
  const setSortBy = useGitStore((s) => s.setSortBy)
  const setSearch = useGitStore((s) => s.setSearch)

  // Filter/sort lives in a memo, NOT in a Zustand selector. The previous
  // selector did `[...files].sort()` on every call, which under React 19 +
  // useSyncExternalStore is treated as a state change (new reference) and
  // re-triggers render synchronously — easily becomes an unresponsive loop in
  // certain interaction sequences. Computing here only when the relevant
  // slices change is bulletproof.
  const files = useMemo(() => {
    if (!ws.diff) return []
    let result = ws.diff.files
    if (ws.search) {
      const q = ws.search.toLowerCase()
      result = result.filter((f) => f.path.toLowerCase().includes(q))
    }
    if (ws.hideReviewed) {
      result = result.filter((f) => !ws.reviewedFiles.includes(f.path))
    }
    if (ws.sortBy === 'name') {
      result = [...result].sort((a, b) => a.path.localeCompare(b.path))
    } else {
      result = [...result].sort((a, b) => (b.mtime ?? 0) - (a.mtime ?? 0))
    }
    return result
  }, [ws.diff, ws.search, ws.hideReviewed, ws.sortBy, ws.reviewedFiles])

  const totalReviewed = useMemo(
    () => files.filter((f) => ws.reviewedFiles.includes(f.path)).length,
    [files, ws.reviewedFiles]
  )

  // #7 Annotate AI Diffs — pending comments for this workspace + ship-to-agent.
  const allComments = useDiffCommentsStore((s) => s.comments)
  const clearComments = useDiffCommentsStore((s) => s.clear)
  const wsComments = useMemo(
    () => allComments.filter((c) => c.workspaceId === workspaceId),
    [allComments, workspaceId]
  )
  const [sendNotice, setSendNotice] = useState<string | null>(null)

  const sendCommentsToAgent = useCallback(async (): Promise<void> => {
    if (wsComments.length === 0) return
    const result = await pasteIntoAgentTerminal(workspaceId, formatDiffComments(wsComments))
    if (!result.ok) {
      setSendNotice('Nenhum terminal disponível para receber os comentários.')
      return
    }
    clearComments(workspaceId)
    setSendNotice(`${wsComments.length} comentário(s) colados no agente — pressione Enter para submeter.`)
    window.setTimeout(() => setSendNotice(null), 6000)
  }, [wsComments, workspaceId, clearComments])

  useEffect(() => {
    void loadDiff(workspaceId, rootPath)
    return subscribeToUpdates(workspaceId)
  }, [loadDiff, subscribeToUpdates, workspaceId, rootPath, ws.base, ws.includeUncommitted])

  // Auto-select the first file once the diff arrives. Without this the right
  // pane stays empty until the user clicks — confusing for fresh reviewers.
  useEffect(() => {
    if (!ws.selectedFile && files.length > 0) {
      selectFile(workspaceId, files[0].path)
    }
  }, [files, ws.selectedFile, selectFile, workspaceId])

  const currentIndex = ws.selectedFile ? files.findIndex((f) => f.path === ws.selectedFile) : 0
  const selectedFile = currentIndex >= 0 ? files[currentIndex] : null

  const handleNavigate = useCallback((dir: -1 | 1): void => {
    const next = Math.max(0, Math.min(files.length - 1, currentIndex + dir))
    if (files[next]) selectFile(workspaceId, files[next].path)
  }, [files, currentIndex, selectFile, workspaceId])

  // j/k = next/prev file, r = toggle reviewed on current file. Effect deps are
  // a function (memoized) + scalars, so this only re-binds when nav state
  // actually changes.
  useEffect(() => {
    function onKey(e: KeyboardEvent): void {
      const t = e.target as HTMLElement
      if (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable) return
      if (e.key === 'j') { e.preventDefault(); handleNavigate(1) }
      else if (e.key === 'k') { e.preventDefault(); handleNavigate(-1) }
      else if (e.key === 'r' && ws.selectedFile) { e.preventDefault(); toggleReviewed(workspaceId, ws.selectedFile) }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [handleNavigate, ws.selectedFile, workspaceId, toggleReviewed])

  return (
    <div className="review-pane review-pane-v2">
      <ReviewToolbar
        base={ws.base}
        includeUncommitted={ws.includeUncommitted}
        hideReviewed={ws.hideReviewed}
        sortBy={ws.sortBy}
        diffMode={ws.diffMode}
        totalFiles={files.length}
        reviewedCount={totalReviewed}
        currentIndex={currentIndex}
        onBaseChange={(base) => setBase(workspaceId, base)}
        onToggleUncommitted={() => setIncludeUncommitted(workspaceId, !ws.includeUncommitted)}
        onToggleHideReviewed={() => setHideReviewed(workspaceId, !ws.hideReviewed)}
        onSortChange={(s) => setSortBy(workspaceId, s)}
        onDiffModeChange={(m) => setDiffMode(workspaceId, m)}
        onClearReviewed={() => clearReviewed(workspaceId)}
        onNavigate={handleNavigate}
        commentCount={wsComments.length}
        onSendComments={() => void sendCommentsToAgent()}
      />

      {sendNotice && (
        <div className="review-pane-alert review-pane-alert--info" data-testid="review-send-notice">
          <span>{sendNotice}</span>
        </div>
      )}

      {ws.isLoading && <div className="review-pane-empty">Loading diff…</div>}
      {ws.error && (
        <div className="review-pane-alert">
          <span>{ws.error}</span>
        </div>
      )}

      {!ws.isLoading && !ws.error && (
        <div className="review-pane-split">
          <aside className="review-pane-tree">
            <div className="review-search">
              <Search size={11} style={{ color: 'var(--tx-muted)', flexShrink: 0 }} aria-hidden="true" />
              <input
                type="text"
                className="review-search-input"
                placeholder="Filter files…"
                value={ws.search}
                onChange={(e) => setSearch(workspaceId, e.target.value)}
                aria-label="Search files"
              />
            </div>
            <ReviewFileTree
              files={files}
              treeMode={ws.treeMode}
              reviewedFiles={ws.reviewedFiles}
              collapsedDirs={ws.collapsedDirs}
              selectedFile={ws.selectedFile}
              onTreeModeChange={(m) => setTreeMode(workspaceId, m)}
              onSelectFile={(p) => selectFile(workspaceId, p)}
              onToggleReviewed={(p) => toggleReviewed(workspaceId, p)}
              onToggleDirCollapsed={(d) => toggleDirCollapsed(workspaceId, d)}
            />
          </aside>

          <div className="review-pane-diffs">
            {files.length === 0 ? (
              <div className="review-pane-empty">
                {ws.diff ? 'No changes match the current filters.' : 'No diff loaded yet.'}
              </div>
            ) : selectedFile ? (
              // Render only the selected file's diff. Rendering every file at
              // once made the renderer freeze on large diffs (300 files × N
              // lines of <table> rows is too much DOM). Codex Desktop also
              // uses single-file view — the tree on the left is the navigator.
              <DiffCard
                key={selectedFile.path}
                file={selectedFile}
                workspaceId={workspaceId}
                isReviewed={ws.reviewedFiles.includes(selectedFile.path)}
                diffMode={ws.diffMode}
                isSelected
                onToggleReviewed={() => toggleReviewed(workspaceId, selectedFile.path)}
                onSelect={() => undefined}
              />
            ) : (
              <div className="review-pane-empty">Select a file in the tree to view its diff.</div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
