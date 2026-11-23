import { ArrowDown, ArrowUp, ChevronDown, ChevronRight, Network, Palette, Pencil, Settings, Trash2 } from 'lucide-react'
import { memo, useEffect, useRef, useState, type ReactElement } from 'react'
import type { Workspace } from '../../../shared/types/workspace'
import { useShallow } from 'zustand/react/shallow'
import { selectIntegrationsForWorkspace, useIntegrationStore } from '../../store/integration.store'
import { ConfirmDialog, Dialog, IconButton, Notice, SidebarGroup, SwatchPicker } from '../../ui'
import { WORKSPACE_COLORS, workspaceColorAttrs } from '../../../shared/workspace-color'
import { useTranslation } from 'react-i18next'
import { i18n } from '../../i18n'
import { RichText } from '../../i18n/RichText'
import { useUIStore } from '../../store/ui.store'
import { useWorkspaceStore } from '../../store/workspace.store'
import { useTerminalStore } from '../../store/terminal.store'
import { useWorkspaceActivity, type WorkspaceActivity } from '../../hooks/useWorkspaceActivity'

/** Position of this workspace among the ones sharing its root folder. */
export interface WorkspaceDuplicate {
  index: number
  count: number
}

interface WorkspaceGroupProps {
  workspace: Workspace
  isActive: boolean
  /**
   * Whether this row is the sidebar's selection. One selection at a time (brand 14/11): the active workspace is the
   * selection only while none of its terminals is. Defaults to isActive.
   */
  selected?: boolean
  /** Null when this workspace is the only one on its folder, which is the norm. */
  duplicate?: WorkspaceDuplicate | null
  onSelect: (id: string) => void
  onClose: (id: string) => void
  terminalsExpanded?: boolean
  terminalCount?: number
  onToggleTerminals?: () => void
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

/**
 * A workspace in the OxeCode sidebar (BRD-01, OXE-60): a src/ui SidebarGroup row, its color as the dot in the lead,
 * no card, no strip and no tint. The wrapper only carries the drag-and-drop and the menu and dialogs the row opens;
 * the terminal rows follow it in the list (the 1.4 structure).
 */
function WorkspaceGroupComponent({
  workspace,
  isActive,
  selected = isActive,
  duplicate = null,
  onSelect,
  onClose,
  terminalsExpanded = false,
  terminalCount = 0,
  onToggleTerminals,
  isDragging = false,
  dropPosition = null,
  onDragStart,
  onDragOver,
  onDragLeave,
  onDrop,
  onDragEnd,
}: WorkspaceGroupProps): ReactElement {
  // The selector filters, so it returns a new array on every read; compare by items.
  const integrations = useIntegrationStore(useShallow(selectIntegrationsForWorkspace(workspace.id)))
  const openIntegrationPanel = useUIStore((s) => s.openIntegrationPanel)
  const setActiveIntegrationGroup = useIntegrationStore((s) => s.setActiveGroup)
  const updateSettings = useWorkspaceStore((s) => s.updateSettings)
  const activity = useWorkspaceActivity(workspace)

  // Context-menu state lives next to the rename + confirm-remove state since
  // the menu triggers both. Menu coordinates are absolute viewport pixels so
  // the popup can escape the sidebar's overflow:hidden.
  const { t } = useTranslation('code')
  const { t: tc } = useTranslation('common')
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null)
  const [renaming, setRenaming] = useState(false)
  const [draftName, setDraftName] = useState(workspace.name)
  const [confirmRemove, setConfirmRemove] = useState(false)
  // CR-07: the color picker is a dialog the menu opens; focus goes back to the options gear.
  const [colorOpen, setColorOpen] = useState(false)
  const settingsButtonRef = useRef<HTMLButtonElement | null>(null)
  const renameInputRef = useRef<HTMLInputElement | null>(null)
  // Guards commitRename so the blur-on-unmount that fires when we close the
  // input doesn't trigger a second async update with the same draft value.
  const commitGuardRef = useRef(false)

  // Close the floating context menu on any outside click / Escape.
  useEffect(() => {
    if (!menu) return
    const onDown = (): void => setMenu(null)
    const onKey = (event: KeyboardEvent): void => { if (event.key === 'Escape') setMenu(null) }
    window.addEventListener('mousedown', onDown)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('mousedown', onDown)
      window.removeEventListener('keydown', onKey)
    }
  }, [menu])

  function handleHeaderClick(): void {
    if (renaming) return
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
    // staring at a frozen field.
    setRenaming(false)
    if (!next || next === workspace.name) {
      setDraftName(workspace.name)
      return
    }
    // The store shows the new name at once and puts the old one back, with a toast, if saving fails.
    await updateSettings({ workspaceId: workspace.id, name: next })
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

  const dropClass = dropPosition === 'before'
    ? ' drop-before'
    : dropPosition === 'after'
      ? ' drop-after'
      : ''
  const fullName = `${workspace.name}${duplicate ? ` #${duplicate.index}` : ''}`

  return (
    <div
      className={`ws-group${isDragging ? ' dragging' : ''}${dropClass}`}
      data-testid="sidebar-workspace-item" data-active={isActive ? '' : undefined} {...workspaceColorAttrs(workspace)}
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
      <SidebarGroup
        lead={<span className="sidebar-ws-mark" {...workspaceColorAttrs(workspace)} title={activity.dominant ? activitySummary(activity) : undefined} aria-hidden="true" />}
        title={renaming ? (
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
            aria-label={t('sidebar.rename', { name: workspace.name })}
          />
        ) : <span title={t('sidebar.rowTitle', { name: workspace.name, path: workspace.rootPath })}>{workspace.name}</span>}
        meta={duplicate ? (
          <span className="ws-group-dup-index" title={t('sidebar.duplicate', { count: duplicate.count, path: workspace.rootPath })} data-testid="ws-group-dup-index">
            #{duplicate.index}
          </span>
        ) : undefined}
        actions={renaming ? undefined : <>
          {terminalCount > 0 && onToggleTerminals ? (
            <IconButton size="sm" data-list-action label={t('sidebar.terminalsIn', { count: terminalCount, name: fullName })} title={t('sidebar.terminals', { count: terminalCount })}
              aria-expanded={terminalsExpanded} icon={terminalsExpanded ? <ChevronDown size={14} aria-hidden="true" /> : <ChevronRight size={14} aria-hidden="true" />}
              onClick={(event) => { event.stopPropagation(); onToggleTerminals() }} />
          ) : null}
          {integrations.length > 0 ? (
            <IconButton size="sm" data-list-action data-testid="ws-group-integration-badge" label={t('sidebar.partOfLabel', { count: integrations.length })}
              title={t('sidebar.partOf', { names: integrations.map((g) => g.name).join(' · ') })} icon={<Network size={12} aria-hidden="true" />} onClick={handleIntegrationBadgeClick} />
          ) : null}
          <IconButton ref={settingsButtonRef} size="sm" data-list-action data-testid="ws-group-settings-btn" label={t('sidebar.optionsLabel')} title={t('sidebar.options')}
            icon={<Settings size={14} aria-hidden="true" />} onClick={handleContextMenu} />
        </>}
        selected={selected}
        onSelect={handleHeaderClick}
        onContextMenu={handleContextMenu}
        aria-label={fullName}
        data-list-item
        data-testid="sidebar-workspace-select"
      />

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
            {t('sidebar.renameItem')}
          </button>
          <button type="button" role="menuitem" onClick={async () => {
            setMenu(null)
            await useWorkspaceStore.getState().setActiveWorkspace(workspace.id)
            useUIStore.getState().openWorkspaceSettings()
          }}><Settings size={12} aria-hidden="true" />{t('sidebar.settings')}</button>
          {(['up', 'down'] as const).map(direction => <button key={direction} type="button" role="menuitem" disabled={(() => {
            // The first workspace cannot move up, nor the last one down.
            const ids = useWorkspaceStore.getState().workspaces.map(item => item.id)
            return ids.indexOf(workspace.id) === (direction === 'up' ? 0 : ids.length - 1)
          })()} onClick={() => {
            const store = useWorkspaceStore.getState()
            const ids = store.workspaces.map(item => item.id)
            const index = ids.indexOf(workspace.id), target = index + (direction === 'up' ? -1 : 1)
            if (index >= 0 && target >= 0 && target < ids.length) {
              ;[ids[index], ids[target]] = [ids[target], ids[index]]
              void store.reorderWorkspaces(ids)
            }
            setMenu(null)
          }}>{direction === 'up' ? <ArrowUp size={12} aria-hidden="true" /> : <ArrowDown size={12} aria-hidden="true" />}{t(direction === 'up' ? 'sidebar.moveUp' : 'sidebar.moveDown')}</button>)}
          {/* A8 / CR-07: the color picker is a dialog this item opens, so no radiogroup sits inside role=menu. */}
          <div role="separator" className="ws-group-context-separator" />
          <button type="button" role="menuitem" onClick={() => { setMenu(null); setColorOpen(true) }}>
            <Palette size={12} aria-hidden="true" />
            {tc('workspaceColor.open')}
          </button>
          {/* G-08: the destructive item stands apart. */}
          <div role="separator" className="ws-group-context-separator" />
          <button
            type="button"
            role="menuitem"
            className="danger"
            onClick={() => { setMenu(null); setConfirmRemove(true) }}
          >
            <Trash2 size={12} aria-hidden="true" />
            {t('sidebar.remove')}
          </button>
        </div>
      ) : null}

      {colorOpen ? (
        <WorkspaceColorDialog
          workspace={workspace}
          returnFocusTo={() => settingsButtonRef.current}
          onClose={() => setColorOpen(false)}
          onChoose={color => { setColorOpen(false); void updateSettings({ workspaceId: workspace.id, color }) }}
        />
      ) : null}

      {confirmRemove ? (
        <RemoveWorkspaceModal
          workspaceName={workspace.name}
          paneIds={workspace.panes.map(pane => pane.id)}
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

export const WorkspaceGroup = memo(
  WorkspaceGroupComponent,
  (previous, next) =>
    previous.workspace === next.workspace &&
    previous.isActive === next.isActive &&
    previous.selected === next.selected &&
    previous.duplicate?.index === next.duplicate?.index &&
    previous.duplicate?.count === next.duplicate?.count &&
    previous.terminalsExpanded === next.terminalsExpanded &&
    previous.terminalCount === next.terminalCount &&
    previous.isDragging === next.isDragging &&
    previous.dropPosition === next.dropPosition
)

interface RemoveWorkspaceModalProps {
  workspaceName: string
  /** This workspace's panes; the ones running or starting are stopped by the removal (OXE-367). */
  paneIds: string[]
  onCancel: () => void
  onConfirm: () => void
}

/**
 * Confirmation modal for "Remove workspace". Removing only detaches the
 * workspace from OXESpace's catalogue — the underlying folder on disk is
 * untouched, which the copy makes explicit so the user doesn't fear losing
 * their code.
 */
function RemoveWorkspaceModal({ workspaceName, paneIds, onCancel, onConfirm }: RemoveWorkspaceModalProps): ReactElement {
  const { t } = useTranslation('code')
  // OXE-367 / A8: only this workspace's agents and terminals that are running or starting; the selector returns a number.
  const running = useTerminalStore(s => paneIds.filter(id => {
    const status = s.panes[id]?.status
    return status === 'running' || status === 'starting'
  }).length)
  return <ConfirmDialog title={t('sidebar.removeTitle')} danger confirmLabel={t('sidebar.remove')} onCancel={onCancel} onConfirm={onConfirm}
    description={<RichText text={t('sidebar.removeBody', { name: workspaceName })} />}>
    {running > 0 ? <Notice intent="warning">{t('sidebar.removeRunning', { count: running })}</Notice> : null}
  </ConfirmDialog>
}

function activitySummary(a: WorkspaceActivity): string {
  if (!a.total) return ''
  const parts = (['needs-decision', 'thinking', 'awaiting', 'starting', 'error', 'idle', 'exited'] as const)
    .filter(state => a.counts[state]).map(state => i18n.t(`sidebar.activity.${state}`, { ns: 'code', count: a.counts[state] }))
  const agents = i18n.t('sidebar.activity.agents', { ns: 'code', count: a.total })
  return parts.length ? `${agents} · ${parts.join(', ')}` : agents
}

/**
 * A8 / CR-07: the eight palette swatches and Automatic, in a dialog the workspace menu opens, so no radiogroup sits
 * inside role=menu. The choice is saved through workspace:update-settings; Automatic clears it to the id's color.
 */
function WorkspaceColorDialog({ workspace, onClose, onChoose, returnFocusTo }: {
  workspace: Workspace
  onClose: () => void
  onChoose: (color: number | null) => void
  returnFocusTo: () => HTMLElement | null
}): ReactElement {
  const { t: tc } = useTranslation('common')
  return <Dialog title={tc('workspaceColor.label')} size="sm" onClose={onClose} returnFocusTo={returnFocusTo} testId="workspace-color-dialog">
    <SwatchPicker
      label={tc('workspaceColor.label')}
      value={workspace.color === null ? '' : String(workspace.color)}
      options={[{ value: '', label: tc('workspaceColor.auto') }, ...WORKSPACE_COLORS.map(n => ({ value: String(n), label: tc(`workspaceColor.swatch.${n}`), color: `var(--ws-${n})` }))]}
      onChange={value => onChoose(value === '' ? null : Number(value))}
    />
  </Dialog>
}
