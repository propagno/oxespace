import { AlertTriangle, Check, ChevronDown, ChevronRight, FolderOpen, FolderTree, GitBranch, Lock, Plus, RotateCw, Trash2, X } from 'lucide-react'
import { Fragment, useCallback, useEffect, useMemo, useState, type ReactElement } from 'react'
import type { GitHubWorktreeBase, GitHubWorktreeStatus } from '../../../shared/types/github'
import type { WorkspacePane } from '../../../shared/types/workspace'
import { selectWorktrees, useWorktreeStore } from '../../store/worktree.store'
import { useWorkspaceStore } from '../../store/workspace.store'

/** A worktree the user asked to remove, plus what removing it would destroy. */
interface PendingRemoval {
  path: string
  branch: string | null
  /** null when the status probe failed — we then defer to git's own refusal. */
  status: GitHubWorktreeStatus | null
}

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
 *      remove button (opens a confirmation that names what would be lost),
 *      `current` highlight when the row matches the active pane's effective
 *      rootPath.
 *   3. Create form / "New worktree" trigger, including the base ref the new
 *      branch will start from.
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
  const worktreeStatus = useWorktreeStore((s) => s.status)
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
  const [pendingRemoval, setPendingRemoval] = useState<PendingRemoval | null>(null)
  // Start point for the new branch. `resolvedBase` is what the repo says the
  // default is (origin/main and friends); `baseOverride` is the user typing
  // something else. Without an explicit start point git branches off the main
  // worktree's HEAD — whatever happened to be checked out there.
  const [resolvedBase, setResolvedBase] = useState<GitHubWorktreeBase | null>(null)
  const [baseOverride, setBaseOverride] = useState<string | null>(null)
  const [fetchBase, setFetchBase] = useState(true)

  // Derived destination path. Vibe-coder flow: type branch → see the path
  // the worktree will land at. No interaction with the Path field required.
  const effectivePath = pathOverride ?? deriveWorktreePath({
    workspaceRootPath,
    branch: newBranch,
    parentOverride
  })

  const effectiveBase = (baseOverride ?? resolvedBase?.baseRef ?? '').trim()
  // Only a remote ref can be stale in a way fetching fixes. Offering the
  // checkbox for a local base (a tag, a SHA, `main`) would promise a freshness
  // it cannot deliver, so it appears only while the base names the remote.
  const baseIsRemote = resolvedBase?.remoteName
    ? effectiveBase.startsWith(`${resolvedBase.remoteName}/`)
    : false

  useEffect(() => {
    void refresh(workspaceId, workspaceRootPath)
  }, [workspaceId, workspaceRootPath, refresh])

  // Resolve the default start point once per repo. Cheap (plain git plumbing)
  // and read-only, so it runs on mount rather than waiting for the create form
  // — the base is shown as soon as the form opens, not a beat later.
  useEffect(() => {
    let cancelled = false
    setResolvedBase(null)
    setBaseOverride(null)
    window.oxe.github
      .resolveWorktreeBase({ workspaceId, rootPath: workspaceRootPath })
      .then((base) => { if (!cancelled) setResolvedBase(base) })
      .catch(() => { /* leave the field empty; git's own default still applies */ })
    return () => { cancelled = true }
  }, [workspaceId, workspaceRootPath])

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
    setBaseOverride(null)
    setFetchBase(true)
  }

  const handleCreate = async (): Promise<void> => {
    const branch = newBranch.trim()
    const path = effectivePath.trim()
    if (!branch || !path) return
    setBusy(true)
    setLocalError(null)
    try {
      await createWorktree(workspaceId, workspaceRootPath, branch, path, {
        createBranch: createNewBranch,
        baseRef: createNewBranch && effectiveBase ? effectiveBase : undefined,
        fetchBase: createNewBranch && baseIsRemote && fetchBase
      })
      setCreating(false)
      resetCreateForm()
    } catch (err) {
      setLocalError(friendlyCreateError(err, path, createNewBranch, effectiveBase))
    } finally {
      setBusy(false)
    }
  }

  /**
   * Opens the removal confirmation, probing the worktree first so the prompt
   * can name what would be destroyed instead of asking the user to click twice
   * and hope.
   */
  const askRemove = async (path: string, branch: string | null): Promise<void> => {
    setLocalError(null)
    setPendingRemoval({ path, branch, status: null })
    const status = await worktreeStatus(workspaceRootPath, path)
    // Guard against the user cancelling (or picking another row) while the
    // probe was in flight — the answer would then belong to a stale prompt.
    setPendingRemoval((current) => (current?.path === path ? { ...current, status } : current))
  }

  /**
   * `force` discards uncommitted work, so it is only ever passed when the user
   * confirmed a prompt that said so. A clean worktree goes through git's own
   * safety net: if git refuses, something changed since the probe and the user
   * gets git's reason rather than a silent `--force`.
   */
  const confirmRemove = async (path: string, force: boolean): Promise<void> => {
    setBusy(true)
    setLocalError(null)
    try {
      // Release any pane whose cwd is inside the target worktree FIRST. On
      // Windows a directory can't be deleted while a process (the pane's shell)
      // holds it as cwd — git de-registers the worktree but fails with
      // "Permission denied" on the file delete. Move those panes back to the
      // main worktree and stop their terminals so the handle is freed, then
      // give the OS a beat to release it before asking git to remove.
      const workspace = useWorkspaceStore.getState().workspaces.find((w) => w.id === workspaceId)
      const panesInTree = (workspace?.panes ?? []).filter((p) => isPathWithin(p.rootPath, path))
      for (const p of panesInTree) {
        await setPaneRootPath(p.id, null)
        try { await window.oxe.terminal.stop({ paneId: p.id }) } catch { /* maybe already idle */ }
      }
      if (panesInTree.length > 0) await new Promise((resolve) => setTimeout(resolve, 450))

      await removeWorktree(workspaceId, workspaceRootPath, path, force)
      setPendingRemoval(null)
    } catch (err) {
      setLocalError(friendlyRemoveError(err))
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
            const isPendingRemoval = pendingRemoval?.path === wt.path
            return (
              <Fragment key={wt.path}>
                <button
                  type="button"
                  className={`worktree-menu-item${isCurrent ? ' active is-active-pane' : ''}${wt.prunable ? ' prunable' : ''}${isPendingRemoval ? ' pending-removal' : ''}`}
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
                        aria-label={`Remove worktree ${wt.branch ?? wt.path}`}
                        title="Remove worktree"
                        aria-expanded={isPendingRemoval}
                        onClick={(event) => { event.stopPropagation(); void askRemove(wt.path, wt.branch) }}
                        disabled={busy}
                      >
                        <Trash2 size={12} aria-hidden="true" />
                      </button>
                    ) : null}
                  </div>
                </button>
                {isPendingRemoval ? (
                  <WorktreeRemovalConfirm
                    pending={pendingRemoval}
                    busy={busy}
                    onCancel={() => setPendingRemoval(null)}
                    onConfirm={(force) => void confirmRemove(wt.path, force)}
                  />
                ) : null}
              </Fragment>
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

          {createNewBranch ? (
            <div className="worktree-menu-create-field">
              <label htmlFor="wt-base">Starts from</label>
              <input
                id="wt-base"
                className="worktree-menu-create-base-input"
                value={effectiveBase}
                onChange={(event) => setBaseOverride(event.currentTarget.value)}
                placeholder={resolvedBase ? resolvedBase.baseRef : 'origin/main'}
                spellCheck={false}
                disabled={busy}
              />
              {baseIsRemote ? (
                <label className="worktree-menu-create-check">
                  <input
                    type="checkbox"
                    checked={fetchBase}
                    onChange={(event) => setFetchBase(event.currentTarget.checked)}
                    disabled={busy}
                  />
                  <span>Fetch {effectiveBase.split('/')[0]} first, so the branch starts at the real remote tip</span>
                </label>
              ) : null}
            </div>
          ) : null}

          {newBranch.trim() ? (
            <div className="worktree-menu-create-preview" aria-live="polite">
              <span className="worktree-menu-create-preview-label">Folder</span>
              <code title={effectivePath}>{effectivePath}</code>
            </div>
          ) : null}

          <small className="worktree-menu-create-hint">
            {createNewBranch
              ? <>
                  New branch off <code>{effectiveBase || 'the current HEAD'}</code>. Push it later with <code>git push -u</code>.
                </>
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
 * Removal confirmation. Its whole job is to answer one question before the
 * user commits: what is lost if this goes away?
 *
 * A clean worktree gets a plain confirm and git keeps its own safety net. A
 * worktree with uncommitted or unpushed work gets an itemised warning and a
 * button that says it discards — `--force` is never reached by accident.
 */
function WorktreeRemovalConfirm({ busy, onCancel, onConfirm, pending }: {
  pending: PendingRemoval
  busy: boolean
  onCancel: () => void
  onConfirm: (force: boolean) => void
}): ReactElement {
  const status = pending.status
  const losses: string[] = []
  if (status) {
    if (status.dirtyCount > 0) losses.push(`${status.dirtyCount} modified ${status.dirtyCount === 1 ? 'file' : 'files'}`)
    if (status.untrackedCount > 0) losses.push(`${status.untrackedCount} untracked ${status.untrackedCount === 1 ? 'entry' : 'entries'}`)
    if (status.ahead > 0) losses.push(`${status.ahead} unpushed ${status.ahead === 1 ? 'commit' : 'commits'}`)
    else if (status.noUpstream) losses.push('a branch that was never pushed')
  }
  // Only working-tree state blocks `git worktree remove`. Unpushed commits are
  // worth warning about but git removes the worktree without complaint — the
  // branch survives, so force is not required for them.
  const needsForce = (status?.dirtyCount ?? 0) > 0 || (status?.untrackedCount ?? 0) > 0
  const label = pending.branch ?? pending.path

  return (
    <div className="worktree-remove-confirm" role="alertdialog" aria-label={`Remove worktree ${label}`}>
      <div className="worktree-remove-confirm-head">
        <AlertTriangle size={12} aria-hidden="true" />
        <strong>Remove {label}?</strong>
      </div>
      <p className="worktree-remove-confirm-body">
        {status === null
          ? 'Checking what this worktree holds…'
          : losses.length === 0
            ? 'Everything here is committed and pushed. The folder is deleted; the branch stays.'
            : <>This worktree still holds {losses.join(', ')}. Removing it deletes {needsForce ? 'that work permanently' : 'the folder'}.</>}
      </p>
      <div className="worktree-remove-confirm-actions">
        <button type="button" className="ghost-btn" onClick={onCancel} disabled={busy}>Cancel</button>
        <button
          type="button"
          className={needsForce ? 'danger-btn' : 'primary-btn'}
          onClick={() => onConfirm(needsForce)}
          disabled={busy || status === null}
        >
          {busy ? 'Removing…' : needsForce ? 'Remove and discard changes' : 'Remove worktree'}
        </button>
      </div>
    </div>
  )
}

/**
 * True when `candidate` is the same directory as `target` or nested inside it.
 * Separator- and case-insensitive so a pane's rootPath (`C:\…\wt`) matches
 * git's porcelain path (`C:/…/wt`). `null` candidate (main worktree) is never
 * "within" a removable worktree.
 */
function isPathWithin(candidate: string | null | undefined, target: string): boolean {
  if (!candidate) return false
  const norm = (p: string): string => p.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()
  const c = norm(candidate)
  const t = norm(target)
  return c === t || c.startsWith(`${t}/`)
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
function friendlyCreateError(err: unknown, path: string, createNewBranch: boolean, baseRef: string): string {
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
  // A bad start point and a bad branch name produce the same git error, so
  // point at the start point when there is one — it is the field the user just
  // gained and the likelier culprit.
  if (/invalid reference/i.test(raw) || /not a valid object name/i.test(raw)) {
    return baseRef && new RegExp(escapeForRegExp(baseRef)).test(raw)
      ? `Git doesn't know the start point "${baseRef}". Fetch the remote, or type a ref that exists locally.`
      : 'Branch name or start point has invalid characters. Stick to letters, digits, `/`, `-`, `_`, `.`.'
  }
  return raw
}

/**
 * Removal failures the user can act on. The "removed from git but the folder
 * survived" case matters most on Windows, where a directory cannot be deleted
 * while any process holds it as cwd — the list has already refreshed to git's
 * real state by the time this renders, so the message is about the leftover
 * folder, not about the worktree.
 */
function friendlyRemoveError(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err)
  if (/main working tree/i.test(raw)) {
    return 'This is the main worktree — it can\'t be removed from inside the app. Remove other worktrees first, or delete the repo from disk.'
  }
  if (/permission denied/i.test(raw) || /failed to delete/i.test(raw) || /being used by another process/i.test(raw)) {
    return 'Worktree removed from git, but its folder couldn\'t be fully deleted — something still has it open (an editor, file explorer, or another terminal). Close those and delete the folder manually if it remains.'
  }
  if (/contains modified or untracked files/i.test(raw)) {
    return 'Something changed in this worktree since the check — it now has uncommitted work. Reopen the remove prompt to see what, and confirm again.'
  }
  return raw
}

function escapeForRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
