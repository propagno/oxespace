import { useEffect, useRef, type ReactElement } from 'react'
import { threadAgentName } from '../../../shared/threadProviders'
import { Archive, Download, GitFork, History, Info, ListTree, MoreHorizontal, Pencil, Pin, Plug, Plus, Trash2, Type, Waypoints } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Button, Menu, type MenuEntry } from '../../ui'
import type { ThreadActivity } from '../../../shared/types/agents'
import type { ConversationThread } from '../../../shared/types/thread'
import type { Workspace } from '../../../shared/types/workspace'
import { workspaceColorAttrs } from '../../../shared/workspace-color'
import { THREAD_FONT_DEFAULT, THREAD_FONT_MAX, useThreadPrefs } from '../../store/thread-prefs.store'
import { useThreadViewModeStore } from '../../store/thread-view-mode.store'
import type { ThreadPanel } from '../../store/thread-workbench.store'
import { useUIStore } from '../../store/ui.store'
import { WorkbenchPanelToggle } from '../Workbench/WorkbenchPanelMenu'
import { withShortcut } from '../../keyboard/keybindings'
import { threadPanelLabel, threadPanelTitle } from './threadPanelLabels'
import { NowLine, type NowLineAction } from './NowLine'
import { parityState } from './parity'
import { ThreadCellClose } from './ThreadCellClose'
import { ThreadSubline } from './ThreadSubline'
import { THREAD_MORE_ACTIONS, type ThreadMoreActionId } from './threadMoreActions'
import { THREAD_TOOL_PANELS } from './threadToolPanels'
import './ThreadHeaderChrome.css'

export function ThreadAddToolMenu({
  activePanel,
  onTogglePanel
}: {
  activePanel?: ThreadPanel | null
  onTogglePanel: (panel: ThreadPanel, keepOpen?: boolean) => void
}): ReactElement {
  const { t } = useTranslation('thread')
  const rawLabel = t('toolPanels.addTool')
  const visibleLabel = rawLabel.replace(/^\+\s*/, '')
  return (
    <Menu
      label={rawLabel}
      align="end"
      items={THREAD_TOOL_PANELS.map(item => ({
        type: 'check' as const,
        label: item.label,
        checked: activePanel === item.panel,
        onSelect: () => onTogglePanel(item.panel)
      }))}
      trigger={
        <Button size="sm" variant="ghost" className="thread-add-tool-btn" icon={<Plus size={13} aria-hidden="true" />}>
          {visibleLabel}
        </Button>
      }
    />
  )
}

/** Title row, A19 sub-line without cost, NowLine, "+ Tool", and the cockpit ⋯ menu (DESIGN U6.1, U6.5). */
export function ThreadHeader({
  thread,
  workspace,
  branch,
  moved,
  activity,
  irreversible,
  hasPullRequest,
  pending,
  running,
  activePanel,
  historyOpen,
  showAddTool = false,
  cell,
  onTogglePanel,
  onToggleHistory,
  onCommand,
  onExport,
  onDelegate,
  onPin,
  onNowAction,
  requestInView,
  onCloseCell
}: {
  thread?: ConversationThread
  workspace?: Workspace
  branch?: string
  moved?: string | null
  activity?: ThreadActivity | null
  irreversible?: boolean
  hasPullRequest?: boolean
  pending: boolean
  running: boolean
  activePanel?: ThreadPanel | null
  historyOpen?: boolean
  showAddTool?: boolean
  cell?: 'primary' | 'secondary'
  onTogglePanel: (panel: ThreadPanel, keepOpen?: boolean) => void
  onToggleHistory?: () => void
  onCommand: (command: string) => void
  onExport?: () => void
  onImport?: () => void
  onDelegate: () => void
  onPin: () => void
  onNowAction?: (action: NowLineAction) => void
  /** The pending request's own buttons are on screen: the status line shows no second pair. */
  requestInView?: boolean
  onCloseCell?: () => void
}) {
  const { t } = useTranslation('thread')
  const headingRef = useRef<HTMLHeadingElement>(null)
  const threadFontSize = useThreadPrefs(state => state.fontSize)
  const setThreadFontSize = useThreadPrefs(state => state.setFontSize)
  const viewMode = useThreadViewModeStore(state => state.mode)

  useEffect(() => {
    if (thread?.id && document.activeElement === document.body) {
      headingRef.current?.focus({ preventScroll: true })
    }
  }, [thread?.id])

  const iconFor = (id: ThreadMoreActionId) => {
    switch (id) {
      case 'rename': return <Pencil size={14} aria-hidden="true" />
      case 'pin': return <Pin size={14} aria-hidden="true" />
      case 'delegate': return <Waypoints size={14} aria-hidden="true" />
      case 'mcp': return <Plug size={14} aria-hidden="true" />
      case 'larger-text': return <Type size={14} aria-hidden="true" />
      case 'show-every-tool-call': return <ListTree size={14} aria-hidden="true" />
      case 'details': return <Info size={14} aria-hidden="true" />
      case 'fork': return <GitFork size={14} aria-hidden="true" />
      case 'export': return <Download size={14} aria-hidden="true" />
      case 'archive': return <Archive size={14} aria-hidden="true" />
      case 'delete': return <Trash2 size={14} aria-hidden="true" />
    }
  }

  const buildMenuItems = (): MenuEntry[] => {
    if (!thread) {
      return [{
        label: t('moreActions.mcp'),
        icon: <Plug size={14} aria-hidden="true" />,
        onSelect: () => useUIStore.getState().openMcpPanel()
      }]
    }
    const forkParity = parityState({ manifest: thread.capabilities, provider: thread.provider }, 'fork')
    return THREAD_MORE_ACTIONS.map((entry): MenuEntry => {
      const id = entry.id as ThreadMoreActionId
      switch (id) {
        case 'rename':
          return { label: entry.label, icon: iconFor(id), disabled: pending, onSelect: () => onCommand('/rename') }
        case 'pin':
          return { label: thread.pinned ? t('moreActions.unpin') : entry.label, icon: iconFor(id), disabled: pending, onSelect: onPin }
        case 'delegate':
          return { label: entry.label, icon: iconFor(id), disabled: pending || running, onSelect: onDelegate }
        case 'mcp':
          return { label: entry.label, icon: iconFor(id), onSelect: () => useUIStore.getState().openMcpPanel() }
        case 'larger-text':
          return {
            label: entry.label,
            icon: iconFor(id),
            keepOpen: true,
            onSelect: () => setThreadFontSize(threadFontSize >= THREAD_FONT_MAX ? THREAD_FONT_DEFAULT : threadFontSize + 1)
          }
        case 'show-every-tool-call':
          return {
            label: entry.label,
            icon: iconFor(id),
            onSelect: () => useThreadViewModeStore.getState().setMode(viewMode === 'verbose' ? 'normal' : 'verbose')
          }
        case 'details':
          return { label: entry.label, icon: iconFor(id), onSelect: () => onTogglePanel('session') }
        case 'fork':
          return {
            label: entry.label,
            icon: iconFor(id),
            disabled: pending || !forkParity.enabled,
            hint: !forkParity.enabled ? (forkParity.reason ?? t('moreActions.forkCodexOnly')) : undefined,
            onSelect: () => onCommand('/fork')
          }
        case 'export':
          return { label: entry.label, icon: iconFor(id), disabled: !onExport || pending, onSelect: () => onExport?.() }
        case 'archive':
          return { label: entry.label, icon: iconFor(id), disabled: pending, onSelect: () => onCommand('/archive') }
        case 'delete':
          return { label: entry.label, icon: iconFor(id), danger: true, disabled: pending, onSelect: () => onCommand('/delete') }
      }
    })
  }

  const sublineWorkspace = workspace
    ? { id: workspace.id, name: workspace?.name, color: workspace.color, rootPath: thread?.rootPath ?? workspace.rootPath }
    : undefined

  const statusKind = activity?.kind
    ?? (thread?.status === 'approval' ? 'needs-you'
      : running ? 'working'
        : thread?.status === 'failed' ? 'error'
          : thread?.status === 'interrupted' ? 'paused'
            : thread ? 'ready' : undefined)

  return (
    <header className="thread-heading" {...(workspace ? workspaceColorAttrs(workspace) : {})}>
      <div className="thread-heading-identity">
        <div className="thread-heading-title-row">
          <div className="thread-heading-title-main">
            {statusKind && <span className="thread-heading-glyph" data-kind={statusKind} aria-hidden="true" />}
            <h1 ref={headingRef} tabIndex={-1} title={thread?.title ?? t('header.projectConversations')}>
              {thread?.title ?? t('header.projectConversations')}
            </h1>
          </div>
          <div className="thread-heading-actions">
            {thread && onToggleHistory && (
              <Button
                size="sm"
                variant="ghost"
                icon={<History size={13} aria-hidden="true" />}
                aria-pressed={Boolean(historyOpen)}
                title={withShortcut(t('timeTravel.button'), 'thread.history')}
                onClick={onToggleHistory}
              >
                {t('timeTravel.button')}
              </Button>
            )}
            {thread && showAddTool && (
              <ThreadAddToolMenu activePanel={activePanel} onTogglePanel={onTogglePanel} />
            )}
            {thread && (
              <WorkbenchPanelToggle
                className="thread-review-trigger thread-panel-toggle"
                item={{
                  id: 'session',
                  label: threadPanelLabel('session'),
                  title: threadPanelTitle('session'),
                  active: activePanel === 'session',
                  onToggle: () => onTogglePanel('session')
                }}
              />
            )}
            <Menu
              label={t('header.moreActions')}
              align="end"
              items={buildMenuItems()}
              trigger={
                <button
                  type="button"
                  className="thread-icon-action"
                  aria-label={t('header.moreActions')}
                  title={t('header.moreActions')}
                >
                  <MoreHorizontal size={16} />
                </button>
              }
            />
            {(cell === 'secondary' || onCloseCell) && <ThreadCellClose cell={cell ?? 'secondary'} onClose={onCloseCell} />}
          </div>
        </div>
        <ThreadSubline
          provider={thread?.provider}
          model={thread?.model}
          workspace={sublineWorkspace}
          branch={branch}
          moved={moved}
          ownedWorktree={thread?.ownedWorktree ?? null}
          access={thread?.access}
          startedAt={thread?.createdAt}
          threadId={thread?.id}
        />
        {thread && activity && (
          <NowLine
            activity={activity}
            agent={threadAgentName(thread.provider)}
            irreversible={irreversible}
            hasPullRequest={hasPullRequest}
            requestInView={requestInView}
            onAction={action => onNowAction?.(action)}
          />
        )}
      </div>
    </header>
  )
}
