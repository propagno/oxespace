import { Check, FolderTree, GripVertical, Network, Pencil, Trash2, X } from 'lucide-react'
import { useCallback, useEffect, useRef, useState, type ReactElement } from 'react'
import type { Workspace } from '../../../shared/types/workspace'
import { selectIntegrationsForWorkspace, useIntegrationStore } from '../../store/integration.store'
import { useUIStore } from '../../store/ui.store'
import { useWorkspaceStore } from '../../store/workspace.store'
import { selectWorktrees, useWorktreeStore } from '../../store/worktree.store'
import { useWorkspaceActivity, type WorkspaceActivity } from '../../hooks/useWorkspaceActivity'

interface WorkspaceGroupProps {
  workspace: Workspace
  isActive: boolean
  onSelect: (id: string) => void
  onClose: (id: string) => void
  // Drag-and-drop handles managed by the parent Sidebar so the parent owns
  // the cross-row state (which row is the source, which is the drop target,
  // what side of the target the cursor sits on).
  isDragging?: boolean
  dropPosition?: 'before' | 'after' | null
  onDragStart?: () => void
  onDragOver?: (position: 'before' | 'after') => void
  onDragLeave?: () => void
  onDrop?: () => void
  onDragEnd?: () => void
}

export function WorkspaceGroup({
  workspace,
  isActive,
  onSelect,
  onClose,
  isDragging = false,
  dropPosition = null,
  onDragStart,
  onDragOver,
  onDragLeave,
  onDrop,
  onDragEnd,
}: WorkspaceGroupProps): ReactElement {
  const rootLabel = compactRootLabel(workspace.rootPath)
  const integrations = useIntegrationStore(selectIntegrationsForWorkspace(workspace.id))
  const openIntegrationPanel = useUIStore((s) => s.openIntegrationPanel)
  const setActiveIntegrationGroup = useIntegrationStore((s) => s.setActiveGroup)
  const worktreeSelector = useCallback(selectWorktrees(workspace.rootPath), [workspace.rootPath])
  const worktrees = useWorktreeStore(worktreeSelector)
  const refreshWorktrees = useWorktreeStore((s) => s.refresh)
  const updateWorktreeState = useWorkspaceStore((s) => s.updateWorktreeState)
  const updateSettings = useWorkspaceStore((s) => s.updateSettings)
  const nonMainWorktreeCount = worktrees.filter((wt) => !wt.isMain).length
  const activity = useWorkspaceActivity(workspace)

  // Context-menu state lives next to the rename + confirm-remove state since
  // the menu triggers both. Menu coordinates are absolute viewport pixels so
  // the popup can escape the sidebar's overflow:hidden.
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null)
  const [renaming, setRenaming] = useState(false)
  const [draftName, setDraftName] = useState(workspace.name)
  const [confirmRemove, setConfirmRemove] = useState(false)
  const renameInputRef = useRef<HTMLInputElement | null>(null)
  // Guards commitRename so the blur-on-unmount that fires when we close the
  // input doesn't trigger a second async update with the same draft value.
  const commitGuardRef = useRef(false)

  useEffect(() => {
    void refreshWorktrees(workspace.id, workspace.rootPath)
  }, [workspace.id, workspace.rootPath, refreshWorktrees])

  // Close the floating context menu on any outside click / Escape.
  useEffect(() => {
    if (!menu) return
    const onDown = (event: MouseEvent): void => setMenu(null)
    const onKey = (event: KeyboardEvent): void => { if (event.key === 'Escape') setMenu(null) }
    window.addEventListener('mousedown', onDown)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('mousedown', onDown)
      window.removeEventListener('keydown', onKey)
    }
  }, [menu])

  function handleHeaderClick() {
    if (renaming) return
    // Sidebar no longer expands to show pane rows — the workspace card is
    // a pure activation target. Pane rename + per-pane actions moved to
    // the terminal title bar where they belong contextually.
    onSelect(workspace.id)
  }

  function handleContextMenu(event: React.MouseEvent): void {
    event.preventDefault()
    event.stopPropagation()
    setMenu({ x: event.clientX, y: event.clientY })
  }

  function startRename(): void {
    setMenu(null)
    setDraftName(workspace.name)
    commitGuardRef.current = false
    setRenaming(true)
    // setTimeout pulls the focus + select out of the current event tick so
    // the input is mounted and ready. autoFocus alone landed focus but
    // sometimes lost the text selection on Windows Electron.
    setTimeout(() => {
      renameInputRef.current?.focus()
      renameInputRef.current?.select()
    }, 0)
  }

  async function commitRename(): Promise<void> {
    if (commitGuardRef.current) return
    commitGuardRef.current = true
    const next = draftName.trim()
    // Close the input immediately so a slow IPC doesn't leave the user
    // staring at a frozen field. On failure we still flip back to view
    // mode (the previous name stays visible from the workspace prop).
    setRenaming(false)
    if (!next || next === workspace.name) {
      setDraftName(workspace.name)
      return
    }
    try {
      await updateSettings({ workspaceId: workspace.id, name: next })
    } catch (err) {
      console.warn('[workspace] rename failed', err)
      setDraftName(workspace.name)
    }
  }

  function cancelRename(): void {
    commitGuardRef.current = true
    setRenaming(false)
    setDraftName(workspace.name)
  }

  function handleIntegrationBadgeClick(e: React.MouseEvent): void {
    e.stopPropagation()
    if (integrations.length === 0) return
    setActiveIntegrationGroup(integrations[0].id)
    onSelect(workspace.id)
    openIntegrationPanel()
  }

  function handleWorktreeBadgeClick(e: React.MouseEvent): void {
    e.stopPropagation()
    onSelect(workspace.id)
    void updateWorktreeState({
      workspaceId: workspace.id,
      worktreePanelVisible: true,
      worktreePanelExpanded: workspace.worktreePanelExpanded ?? false
    })
  }

  const dropClass = dropPosition === 'before'
    ? ' drop-before'
    : dropPosition === 'after'
      ? ' drop-after'
      : ''

  return (
    <div
      className={`ws-group${isActive ? ' active' : ''}${isDragging ? ' dragging' : ''}${dropClass}`}
      data-testid="sidebar-workspace-item"
      draggable={Boolean(onDragStart) && !renaming}
      onDragStart={(event) => {
        if (!onDragStart || renaming) return
        event.stopPropagation()
        event.dataTransfer.effectAllowed = 'move'
        try { event.dataTransfer.setData('text/plain', workspace.id) } catch { /* some Electron builds reject empty types */ }
        onDragStart()
      }}
      onDragOver={(event) => {
        if (!onDragOver) return
        event.preventDefault()
        event.dataTransfer.dropEffect = 'move'
        const rect = event.currentTarget.getBoundingClientRect()
        const midY = rect.top + rect.height / 2
        onDragOver(event.clientY < midY ? 'before' : 'after')
      }}
      onDragLeave={(event) => {
        if (!onDragLeave) return
        const next = event.relatedTarget as Node | null
        if (!next || !event.currentTarget.contains(next)) onDragLeave()
      }}
      onDrop={(event) => {
        if (!onDrop) return
        event.preventDefault()
        onDrop()
      }}
      onDragEnd={() => { if (onDragEnd) onDragEnd() }}
    >
      <div
        className="ws-group-header"
        role="button"
        tabIndex={0}
        onClick={handleHeaderClick}
        onKeyDown={e => !renaming && e.key === 'Enter' && handleHeaderClick()}
        onContextMenu={handleContextMenu}
        data-testid="sidebar-workspace-select"
      >
        {!renaming && (
          <GripVertical
            size={11}
            className="ws-group-grip"
            aria-hidden="true"
          />
        )}
        <span
          className={`ws-group-dot pane-activity-dot ${activity.dominant ? `activity-${activity.dominant}` : 'activity-placeholder'}`}
          title={activity.dominant ? activitySummary(activity) : undefined}
          aria-hidden="true"
        />
        <div className="ws-group-title-block">
          {renaming ? (
            <input
              ref={renameInputRef}
              type="text"
              autoFocus
              className="ws-group-rename-input"
              value={draftName}
              onChange={(e) => setDraftName(e.currentTarget.value)}
              onClick={(e) => e.stopPropagation()}
              onMouseDown={(e) => e.stopPropagation()}
              onKeyDown={(e) => {
                e.stopPropagation()
                if (e.key === 'Enter') { e.preventDefault(); void commitRename() }
                if (e.key === 'Escape') { e.preventDefault(); cancelRename() }
              }}
              onBlur={() => void commitRename()}
              aria-label={`Rename workspace ${workspace.name}`}
            />
          ) : (
            <>
              <span
                className="ws-group-name"
                title={`${workspace.name}\n${workspace.rootPath}\n(right-click for options)`}
              >
                {workspace.name}
              </span>
              <span className="ws-group-path" title={workspace.rootPath}>
                {getCompactPath(workspace.rootPath)}
              </span>
            </>
          )}
        </div>
        {integrations.length > 0 ? (
          <button
            type="button"
            className="ws-group-integration-badge"
            title={`Part of: ${integrations.map((g) => g.name).join(' · ')}`}
            aria-label={`Workspace is part of ${integrations.length} integration${integrations.length === 1 ? '' : 's'}`}
            onClick={handleIntegrationBadgeClick}
            data-testid="ws-group-integration-badge"
          >
            <Network size={11} aria-hidden="true" />
            {integrations.length > 1 ? <span className="ws-group-integration-count">{integrations.length}</span> : null}
          </button>
        ) : null}
        {nonMainWorktreeCount > 0 ? (
          <button
            type="button"
            className="ws-group-worktree-count"
            title={`${nonMainWorktreeCount} active worktree${nonMainWorktreeCount === 1 ? '' : 's'} — click to open worktree panel`}
            aria-label={`Open worktree panel — ${nonMainWorktreeCount} active worktree${nonMainWorktreeCount === 1 ? '' : 's'}`}
            onClick={handleWorktreeBadgeClick}
            data-testid="ws-group-worktree-badge"
          >
            <FolderTree size={11} aria-hidden="true" />
            {nonMainWorktreeCount > 1 ? <span>{nonMainWorktreeCount}</span> : null}
          </button>
        ) : null}
      </div>

      {menu ? (
        <div
          className="ws-group-context-menu"
          style={{ left: menu.x, top: menu.y }}
          role="menu"
          onMouseDown={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
        >
          <button type="button" role="menuitem" onClick={startRename}>
            <Pencil size={12} aria-hidden="true" />
            Rename
          </button>
          <button
            type="button"
            role="menuitem"
            className="danger"
            onClick={() => { setMenu(null); setConfirmRemove(true) }}
          >
            <Trash2 size={12} aria-hidden="true" />
            Remove workspace
          </button>
        </div>
      ) : null}

      {confirmRemove ? (
        <RemoveWorkspaceModal
          workspaceName={workspace.name}
          onCancel={() => setConfirmRemove(false)}
          onConfirm={() => {
            setConfirmRemove(false)
            onClose(workspace.id)
          }}
        />
      ) : null}
    </div>
  )
}

interface RemoveWorkspaceModalProps {
  workspaceName: string
  onCancel: () => void
  onConfirm: () => void
}

/**
 * Confirmation modal for "Remove workspace". Removing only detaches the
 * workspace from OXESpace's catalogue — the underlying folder on disk is
 * untouched, which the copy makes explicit so the user doesn't fear losing
 * their code.
 */
function RemoveWorkspaceModal({ workspaceName, onCancel, onConfirm }: RemoveWorkspaceModalProps): ReactElement {
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onCancel()
      if (event.key === 'Enter') onConfirm()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onCancel, onConfirm])

  return (
    <div className="ws-remove-backdrop" role="presentation" onMouseDown={onCancel}>
      <div
        className="ws-remove-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="ws-remove-title"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <header className="ws-remove-modal-header">
          <h2 id="ws-remove-title">Remove workspace?</h2>
          <button type="button" className="ws-remove-modal-close" aria-label="Cancel" onClick={onCancel}>
            <X size={13} aria-hidden="true" />
          </button>
        </header>
        <p className="ws-remove-modal-body">
          <strong>{workspaceName}</strong> will be removed from the sidebar. The folder on disk
          stays untouched — you can re-add it later via <em>New workspace</em>.
        </p>
        <footer className="ws-remove-modal-actions">
          <button type="button" className="ghost-btn" onClick={onCancel}>
            Cancel
          </button>
          <button type="button" className="ws-remove-modal-confirm" onClick={onConfirm}>
            <Check size={13} aria-hidden="true" />
            Remove workspace
          </button>
        </footer>
      </div>
    </div>
  )
}

function activitySummary(a: WorkspaceActivity): string {
  if (!a.total) return ''
  const parts: string[] = []
  if (a.counts.thinking) parts.push(`${a.counts.thinking} thinking`)
  if (a.counts.awaiting) parts.push(`${a.counts.awaiting} awaiting`)
  if (a.counts.starting) parts.push(`${a.counts.starting} starting`)
  if (a.counts.error) parts.push(`${a.counts.error} error`)
  if (a.counts.idle) parts.push(`${a.counts.idle} idle`)
  if (a.counts.exited) parts.push(`${a.counts.exited} exited`)
  return `${a.total} agent${a.total === 1 ? '' : 's'}${parts.length ? ` · ${parts.join(', ')}` : ''}`
}

function compactRootLabel(rootPath: string): string {
  const parts = rootPath.split(/[\\/]/).filter(Boolean)
  return parts.at(-1) ?? 'workspace'
}

function getCompactPath(rootPath: string): string {
  const parts = rootPath.split(/[\\/]/).filter(Boolean)
  if (parts.length >= 2) {
    return `${parts.at(-2)}/${parts.at(-1)}`
  }
  return parts.at(-1) ?? ''
}
