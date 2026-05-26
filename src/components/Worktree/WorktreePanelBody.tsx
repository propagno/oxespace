import { Check, ChevronDown, ChevronRight, FolderOpen, FolderTree, GitBranch, Lock, Plus, RotateCw, Trash2, X } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState, type ReactElement } from 'react'
import type { WorkspacePane } from '../../../shared/types/workspace'
import { selectWorktrees, useWorktreeStore } from '../../store/worktree.store'
import { useWorkspaceStore } from '../../store/workspace.store'

interface WorktreePanelBodyProps {
  activePane: WorkspacePane | null
  workspaceId: string
  workspaceRootPath: string
}

/**
 * Worktree panel content — replaces the original modal body. Mounted inside
 * `WorkspaceWorktreePanel.tsx` which provides the side-dock chrome.
 *
 * Layout:
 *   1. Sticky "Active pane" header — names the pane being targeted by
 *      selections, and which worktree it is currently in. When no pane is
 *      selected, prompts the user to pick one first.
 *   2. Worktree list — same affordances as the modal: click to set as cwd,
 *      remove button (confirm-on-second-click), `current` highlight when the
 *      row matches the active pane's effective rootPath.
 *   3. Create form / "New worktree" trigger.
 *
 * Selecting a worktree when `activePane` is null is a no-op (UI buttons stay
 * enabled so the visual rhythm is preserved but the handler bails).
 */
export function WorktreePanelBody({ activePane, workspaceId, workspaceRootPath }: WorktreePanelBodyProps): ReactElement {
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
  // Path layering: derived = workspaceParent + repo + slug(branch). Browse
  // sets parentOverride (keeps slug syncing with the branch field). Editing
  // the Path input directly sets pathOverride (full lock, ignores branch
  // changes — escape hatch for power users). Both null = pure auto.
  const [parentOverride, setParentOverride] = useState<string | null>(null)
  const [pathOverride, setPathOverride] = useState<string | null>(null)
  const [createNewBranch, setCreateNewBranch] = useState(true)
  const [showAdvanced, setShowAdvanced] = useState(false)
  const [busy, setBusy] = useState(false)
  const [localError, setLocalError] = useState<string | null>(null)
  const [confirmRemovePath, setConfirmRemovePath] = useState<string | null>(null)

  // Derived destination path. Vibe-coder flow: type branch → see the path
  // the worktree will land at. No interaction with the Path field required.
  const effectivePath = pathOverride ?? deriveWorktreePath({
    workspaceRootPath,
    branch: newBranch,
    parentOverride
  })

  useEffect(() => {
    void refresh(workspaceId, workspaceRootPath)
  }, [workspaceId, workspaceRootPath, refresh])

  const activeCurrentPath = useMemo(() => {
    if (!activePane) return null
    return activePane.rootPath ?? worktrees.find((w) => w.isMain)?.path ?? workspaceRootPath
  }, [activePane, worktrees, workspaceRootPath])

  const activeWorktree = useMemo(() => {
    if (!activeCurrentPath) return null
    return worktrees.find((w) => w.path === activeCurrentPath) ?? null
  }, [worktrees, activeCurrentPath])

  const paneLabel = activePane
    ? activePane.displayName ?? `Pane ${activePane.rowIndex + 1}.${activePane.columnIndex + 1}`
    : null

  const handleSelect = async (path: string | null): Promise<void> => {
    if (!activePane) {
      setLocalError('Select an active pane first — click any pane in the grid before choosing a worktree.')
      return
    }
    setBusy(true)
    setLocalError(null)
    try {
      await setPaneRootPath(activePane.id, path)
      try { await window.oxe.terminal.restart({ paneId: activePane.id }) } catch { /* maybe idle */ }
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  const resetCreateForm = (): void => {
    setNewBranch('')
    setParentOverride(null)
    setPathOverride(null)
    setShowAdvanced(false)
    setCreateNewBranch(true)
  }

  const handleCreate = async (): Promise<void> => {
    const branch = newBranch.trim()
    const path = effectivePath.trim()
    if (!branch || !path) return
    setBusy(true)
    setLocalError(null)
    try {
      await createWorktree(workspaceRootPath, branch, path, createNewBranch)
      setCreating(false)
      resetCreateForm()
    } catch (err) {
      setLocalError(friendlyCreateError(err, path, createNewBranch))
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
      if (activePane && activePane.rootPath === path) {
        await setPaneRootPath(activePane.id, null)
      }
    } catch (err) {
      // Surface the most common case (user tried to remove the main) with a
      // friendlier message — the raw git "fatal: 'X' is a main working tree"
      // is correct but cryptic and looks like an internal bug to non-git users.
      const raw = err instanceof Error ? err.message : String(err)
      const friendly = /main working tree/i.test(raw)
        ? 'This is the main worktree — it can\'t be removed from inside the app. Remove other worktrees first, or delete the repo from disk.'
        : raw
      setLocalError(friendly)
    } finally {
      setBusy(false)
    }
  }

  const dismissError = (): void => {
    setLocalError(null)
    // Also clear the store-level error for this rootPath so reopening the
    // panel after a transient failure doesn't keep the red banner around.
    useWorktreeStore.setState((s) => ({
      error: { ...s.error, [workspaceRootPath]: null }
    }))
  }

  const handleBrowse = async (): Promise<void> => {
    // Lock in the parent the user picked, but keep the slug live so that
    // continuing to type in the Branch field updates the destination
    // automatically. Clears any full pathOverride so the relationship
    // (parent + slug) is restored.
    try {
      const picked = await window.oxe.workspace.pickFolder()
      if (!picked) return
      setParentOverride(picked.replace(/[\\/]+$/, ''))
      setPathOverride(null)
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : String(err))
    }
  }

  // When only the main worktree exists, the list is technically non-empty
  // (master is there) but the value proposition is empty: there's nothing
  // to switch to. We surface a hint pointing the user to the create form.
  const onlyMainExists = worktrees.length > 0 && worktrees.every((wt) => wt.isMain)

  return (
    <div className="worktree-panel-body">
      <section className="worktree-panel-active-pane" aria-label="Active pane worktree">
        <div className="worktree-panel-active-row">
          <FolderTree size={11} aria-hidden="true" />
          {activePane ? (
            <>
              <span className="worktree-panel-active-label">Active pane</span>
              <strong>{paneLabel}</strong>
              <span className="worktree-panel-active-arrow" aria-hidden="true">·</span>
              <span className="worktree-panel-active-worktree">
                {activeWorktree
                  ? <>{activeWorktree.branch ?? '(detached)'} {activeWorktree.isMain ? <em>(main)</em> : null}</>
                  : 'unknown worktree'}
              </span>
            </>
          ) : (
            <span className="worktree-panel-active-hint">No active pane — click a pane to target it.</span>
          )}
        </div>
        <button
          type="button"
          className="icon-button worktree-panel-refresh"
          aria-label="Refresh worktree list"
          title="Refresh"
          onClick={() => void refresh(workspaceId, workspaceRootPath)}
          disabled={loading}
        >
          <RotateCw size={11} className={loading ? 'usage-spin' : ''} aria-hidden="true" />
        </button>
      </section>

      {error || localError ? (
        <div className="worktree-menu-error" role="alert">
          <span>{localError ?? error}</span>
          <button
            type="button"
            className="worktree-menu-error-dismiss"
            aria-label="Dismiss error"
            title="Dismiss"
            onClick={dismissError}
          >
            <X size={11} aria-hidden="true" />
          </button>
        </div>
      ) : null}

      {onlyMainExists ? (
        <div className="worktree-panel-solo-hint" role="note">
          <FolderTree size={13} aria-hidden="true" />
          <span>This repo has only the main worktree. Create one below to isolate work on another branch without affecting the current pane.</span>
        </div>
      ) : null}

      <div className="worktree-menu-list">
        {worktrees.length === 0 && !loading ? (
          <div className="worktree-menu-empty">
            <FolderTree size={32} aria-hidden="true" />
            <strong>No worktrees</strong>
            <span>Create a worktree below to isolate work on another branch without affecting the current pane.</span>
          </div>
        ) : (
          worktrees.map((wt) => {
            const isCurrent = wt.path === activeCurrentPath
            const itemTitle = !activePane
              ? 'Click a pane in the grid to target it first'
              : isCurrent
                ? `Active pane is already on ${wt.branch ?? wt.path}`
                : 'Set this worktree as the active pane cwd'
            return (
              <button
                key={wt.path}
                type="button"
                className={`worktree-menu-item${isCurrent ? ' active is-active-pane' : ''}${wt.prunable ? ' prunable' : ''}`}
                onClick={() => { if (!isCurrent) void handleSelect(wt.isMain ? null : wt.path) }}
                disabled={busy || !activePane || isCurrent}
                title={itemTitle}
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
            <label htmlFor="wt-branch">Branch name</label>
            <input
              id="wt-branch"
              autoFocus
              value={newBranch}
              onChange={(event) => setNewBranch(event.currentTarget.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && newBranch.trim() && !busy) {
                  event.preventDefault()
                  void handleCreate()
                }
              }}
              placeholder="feat/login-v2"
              disabled={busy}
            />
          </div>

          {newBranch.trim() ? (
            <div className="worktree-menu-create-preview" aria-live="polite">
              <span className="worktree-menu-create-preview-label">Folder</span>
              <code title={effectivePath}>{effectivePath}</code>
            </div>
          ) : null}

          <small className="worktree-menu-create-hint">
            {createNewBranch
              ? <>A new local branch will be created. Push it later with <code>git push -u</code>.</>
              : <>Existing branch will be checked out. Make sure it isn't already used by another worktree.</>}
          </small>

          <button
            type="button"
            className="worktree-menu-create-advanced-toggle"
            onClick={() => setShowAdvanced((value) => !value)}
            aria-expanded={showAdvanced}
            disabled={busy}
          >
            {showAdvanced ? <ChevronDown size={11} aria-hidden="true" /> : <ChevronRight size={11} aria-hidden="true" />}
            <span>Advanced</span>
          </button>

          {showAdvanced ? (
            <div className="worktree-menu-create-advanced">
              <div className="worktree-menu-create-field">
                <label htmlFor="wt-path">Custom path</label>
                <div className="worktree-menu-create-path-row">
                  <input
                    id="wt-path"
                    value={effectivePath}
                    onChange={(event) => setPathOverride(event.currentTarget.value)}
                    placeholder="Auto-derived from branch — edit to override"
                    disabled={busy}
                  />
                  <button
                    type="button"
                    className="worktree-menu-create-browse"
                    onClick={() => void handleBrowse()}
                    disabled={busy}
                    title="Pick a parent folder; the branch slug is appended automatically"
                    aria-label="Browse for parent folder"
                  >
                    <FolderOpen size={12} aria-hidden="true" />
                    <span>Browse</span>
                  </button>
                </div>
                {pathOverride !== null ? (
                  <button
                    type="button"
                    className="worktree-menu-create-reset"
                    onClick={() => setPathOverride(null)}
                    disabled={busy}
                  >
                    Reset to auto
                  </button>
                ) : null}
              </div>
              <label className="worktree-menu-create-check">
                <input
                  type="checkbox"
                  checked={!createNewBranch}
                  onChange={(event) => setCreateNewBranch(!event.currentTarget.checked)}
                  disabled={busy}
                />
                <span>Use existing branch instead of creating a new one</span>
              </label>
            </div>
          ) : null}

          <div className="worktree-menu-create-actions">
            <button
              type="button"
              className="ghost-btn"
              onClick={() => { setCreating(false); setLocalError(null); resetCreateForm() }}
              disabled={busy}
            >
              Cancel
            </button>
            <button
              type="button"
              className="primary-btn"
              onClick={() => void handleCreate()}
              disabled={busy || !newBranch.trim()}
            >
              {busy ? 'Creating…' : 'Create worktree'}
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
    </div>
  )
}

/**
 * Returns the last segment of a path — works for both forward and backslash
 * separators (Windows + POSIX). Used to construct a sensible sibling
 * directory name for new worktrees ("oxespace" → "oxespace-feature-x").
 */
function repoBaseName(rootPath: string): string {
  const normalized = rootPath.replace(/[\\/]+$/, '')
  const segments = normalized.split(/[\\/]/)
  return segments[segments.length - 1] || 'repo'
}

/**
 * Returns the parent directory of the workspace, separator-preserving where
 * possible so the suggestion lands in a form the user is used to seeing.
 */
function parentDir(rootPath: string): string {
  const normalized = rootPath.replace(/[\\/]+$/, '')
  const lastSep = Math.max(normalized.lastIndexOf('/'), normalized.lastIndexOf('\\'))
  if (lastSep <= 0) return '..'
  return normalized.slice(0, lastSep)
}

/**
 * Detects which separator style the user's rootPath uses so the suggestion
 * doesn't mix `/` and `\` (git accepts both on Windows but mixed paths are
 * jarring in the input field).
 */
function pathSeparator(rootPath: string): '/' | '\\' {
  return rootPath.includes('\\') && !rootPath.includes('/') ? '\\' : '/'
}

/**
 * Turns a branch name into a folder-safe slug:
 *   "feat/login-v2" → "feat-login-v2"
 *   "user/Eduardo Carvalho" → "user-eduardo-carvalho"
 * Git allows slashes in branch names but Windows doesn't allow them in paths.
 */
function slugifyBranch(branch: string): string {
  return branch
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
}

/**
 * Builds the worktree destination path from three pieces:
 *   - parent dir: user-picked (parentOverride) or computed from workspace
 *   - repo basename: derived from workspaceRootPath
 *   - branch slug: live-derived from the branch input
 *
 * Keeping the slug separate from the parent lets us refresh the destination
 * as the user types the branch name even after they've used Browse. The
 * earlier implementation re-built the entire path on Browse and then locked
 * it, which made branch edits stale — that surfaced as "feature/teste"
 * being created at `<dir>/oxespace-worktree` because the user clicked
 * Browse before typing the branch name.
 */
function deriveWorktreePath(options: {
  workspaceRootPath: string
  branch: string
  parentOverride: string | null
}): string {
  const parent = options.parentOverride ?? parentDir(options.workspaceRootPath)
  const sep = pathSeparator(parent)
  const repo = repoBaseName(options.workspaceRootPath)
  const slug = slugifyBranch(options.branch.trim()) || 'worktree'
  return `${parent.replace(/[\\/]+$/, '')}${sep}${repo}-${slug}`
}

/**
 * Translates the most common `git worktree add` failures into messages a
 * non-git user can act on. Raw git errors are correct but cryptic — we
 * preserve them as a fallback when we don't recognise the failure mode.
 */
function friendlyCreateError(err: unknown, path: string, createNewBranch: boolean): string {
  const raw = err instanceof Error ? err.message : String(err)
  if (/already exists/i.test(raw)) {
    return `Folder "${path}" already exists. Pick a different path — git refuses to create a worktree where files are already present.`
  }
  if (/already used by worktree/i.test(raw)) {
    return 'This branch is already checked out in another worktree. Pick a different branch, or remove that worktree first.'
  }
  if (/no possible source branch/i.test(raw)) {
    return createNewBranch
      ? 'Git couldn\'t infer a starting point for the new branch — make sure the repo has at least one commit on the current branch.'
      : 'Branch not found. Type an existing branch name, or check "Create new branch" to start fresh.'
  }
  if (/not a git repository/i.test(raw)) {
    return 'This workspace isn\'t a git repository. Worktrees only work inside repos initialised with `git init`.'
  }
  if (/invalid reference/i.test(raw) || /not a valid object name/i.test(raw)) {
    return 'Branch name has invalid characters. Stick to letters, digits, `/`, `-`, `_`, `.`.'
  }
  return raw
}
