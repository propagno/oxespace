import { Check, FolderTree, GitBranch, Lock, Plus, RotateCw, Trash2, X } from 'lucide-react'
import { useCallback, useEffect, useState, type ReactElement } from 'react'
import type { WorkspacePane } from '../../../shared/types/workspace'
import { selectWorktrees, useWorktreeStore } from '../../store/worktree.store'
import { useWorkspaceStore } from '../../store/workspace.store'

interface WorktreeMenuProps {
  pane: WorkspacePane
  workspaceId: string
  workspaceRootPath: string
  onClose: () => void
}

export function WorktreeMenu({ pane, workspaceId, workspaceRootPath, onClose }: WorktreeMenuProps): ReactElement {
  const worktreesSelector = useCallback(selectWorktrees(workspaceRootPath), [workspaceRootPath])
  const worktrees = useWorktreeStore(worktreesSelector)
  const loading = useWorktreeStore((s) => s.loading[workspaceRootPath] === true)
  const error = useWorktreeStore((s) => s.error[workspaceRootPath] ?? null)
  const refresh = useWorktreeStore((s) => s.refresh)
  const createWorktree = useWorktreeStore((s) => s.create)
  const removeWorktree = useWorktreeStore((s) => s.remove)
  const setPaneRootPath = useWorkspaceStore((s) => s.setPaneRootPath)

  const [creating, setCreating] = useState(false)
  const [newBranch, setNewBranch] = useState('')
  const [newPath, setNewPath] = useState('')
  const [createNewBranch, setCreateNewBranch] = useState(true)
  const [busy, setBusy] = useState(false)
  const [localError, setLocalError] = useState<string | null>(null)
  const [confirmRemovePath, setConfirmRemovePath] = useState<string | null>(null)

  useEffect(() => {
    void refresh(workspaceId, workspaceRootPath)
  }, [workspaceId, workspaceRootPath, refresh])

  const handleSelect = async (path: string | null): Promise<void> => {
    setBusy(true)
    try {
      await setPaneRootPath(pane.id, path)
      // Restart so the new cwd takes effect
      try { await window.oxe.terminal.restart({ paneId: pane.id }) } catch { /* maybe idle */ }
      onClose()
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  const handleCreate = async (): Promise<void> => {
    if (!newBranch.trim() || !newPath.trim()) return
    setBusy(true)
    setLocalError(null)
    try {
      await createWorktree(workspaceRootPath, newBranch.trim(), newPath.trim(), createNewBranch)
      setCreating(false)
      setNewBranch('')
      setNewPath('')
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  const handleRemove = async (path: string): Promise<void> => {
    if (confirmRemovePath !== path) {
      setConfirmRemovePath(path)
      return
    }
    setBusy(true)
    setLocalError(null)
    try {
      await removeWorktree(workspaceRootPath, path, true)
      setConfirmRemovePath(null)
      // If this pane was using that worktree, reset to workspace root
      if (pane.rootPath === path) await setPaneRootPath(pane.id, null)
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  const currentPath = pane.rootPath ?? worktrees.find((w) => w.isMain)?.path ?? workspaceRootPath

  return (
    <div className="worktree-menu-backdrop" role="presentation" onMouseDown={onClose}>
      <section
        className="worktree-menu"
        role="dialog"
        aria-modal="true"
        aria-label="Worktrees"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="worktree-menu-header">
          <div className="worktree-menu-title">
            <FolderTree size={14} aria-hidden="true" />
            <strong>Worktrees</strong>
            <span className="worktree-menu-sub">{pane.displayName ?? `Pane ${pane.rowIndex + 1}.${pane.columnIndex + 1}`}</span>
          </div>
          <div className="worktree-menu-actions">
            <button
              type="button"
              className="icon-button"
              aria-label="Refresh"
              onClick={() => void refresh(workspaceId, workspaceRootPath)}
              disabled={loading}
            >
              <RotateCw size={13} className={loading ? 'usage-spin' : ''} aria-hidden="true" />
            </button>
            <button type="button" className="icon-button" aria-label="Close" onClick={onClose}>
              <X size={14} aria-hidden="true" />
            </button>
          </div>
        </header>

        {error || localError ? (
          <div className="worktree-menu-error">{localError ?? error}</div>
        ) : null}

        <div className="worktree-menu-list">
          {worktrees.length === 0 && !loading ? (
            <div className="worktree-menu-empty">
              <FolderTree size={32} aria-hidden="true" />
              <strong>No worktrees</strong>
              <span>Create a worktree below to isolate work on another branch without affecting this pane.</span>
            </div>
          ) : (
            worktrees.map((wt) => {
              const isCurrent = wt.path === currentPath
              return (
                <button
                  key={wt.path}
                  type="button"
                  className={`worktree-menu-item${isCurrent ? ' active' : ''}${wt.prunable ? ' prunable' : ''}`}
                  onClick={() => void handleSelect(wt.isMain ? null : wt.path)}
                  disabled={busy}
                >
                  <div className="worktree-menu-item-main">
                    <div className="worktree-menu-item-row">
                      <GitBranch size={11} aria-hidden="true" />
                      <strong>{wt.branch ?? '(detached)'}</strong>
                      {wt.isMain ? <span className="worktree-tag main">main</span> : null}
                      {wt.locked ? <span className="worktree-tag locked"><Lock size={9} aria-hidden="true" /> locked</span> : null}
                      {wt.prunable ? <span className="worktree-tag prunable">prunable</span> : null}
                    </div>
                    <span className="worktree-menu-item-path">{wt.path}</span>
                  </div>
                  <div className="worktree-menu-item-aside">
                    {isCurrent ? <div className="worktree-menu-check"><Check size={13} aria-hidden="true" /></div> : null}
                    {!wt.isMain ? (
                      <button
                        type="button"
                        className="icon-button worktree-menu-remove"
                        aria-label={confirmRemovePath === wt.path ? 'Confirm worktree removal' : 'Remove worktree'}
                        title={confirmRemovePath === wt.path ? 'Click again to remove' : 'Remove worktree'}
                        onClick={(event) => { event.stopPropagation(); void handleRemove(wt.path) }}
                        disabled={busy}
                      >
                        <Trash2 size={12} aria-hidden="true" />
                      </button>
                    ) : null}
                  </div>
                </button>
              )
            })
          )}
        </div>

        {creating ? (
          <div className="worktree-menu-create">
            <div className="worktree-menu-create-field">
              <label htmlFor="wt-branch">Branch</label>
              <input
                id="wt-branch"
                autoFocus
                value={newBranch}
                onChange={(event) => setNewBranch(event.currentTarget.value)}
                placeholder="feat/new-feature"
                disabled={busy}
              />
            </div>
            <div className="worktree-menu-create-field">
              <label htmlFor="wt-path">Path</label>
              <input
                id="wt-path"
                value={newPath}
                onChange={(event) => setNewPath(event.currentTarget.value)}
                placeholder="../oxespace-feat-new"
                disabled={busy}
              />
            </div>
            <label className="worktree-menu-create-check">
              <input
                type="checkbox"
                checked={createNewBranch}
                onChange={(event) => setCreateNewBranch(event.currentTarget.checked)}
                disabled={busy}
              />
              <span>Create new branch (`-b`)</span>
            </label>
            <div className="worktree-menu-create-actions">
              <button type="button" className="ghost-btn" onClick={() => { setCreating(false); setLocalError(null) }} disabled={busy}>
                Cancel
              </button>
              <button
                type="button"
                className="primary-btn"
                onClick={() => void handleCreate()}
                disabled={busy || !newBranch.trim() || !newPath.trim()}
              >
                Create worktree
              </button>
            </div>
          </div>
        ) : (
          <button
            type="button"
            className="worktree-menu-create-trigger"
            onClick={() => setCreating(true)}
            disabled={busy}
          >
            <Plus size={12} aria-hidden="true" />
            <span>New worktree</span>
          </button>
        )}

        <footer className="worktree-menu-footer">
          <span>Select a worktree to use it as this pane's <code>cwd</code>. Automatic restart after selection.</span>
        </footer>
      </section>
    </div>
  )
}
