import { useEffect, useRef, type ReactElement } from 'react'
import { Archive, Code, Download, ExternalLink, GitBranch, GitFork, Info, MoreHorizontal, Pencil, Pin, Plug, Plus, Trash2, Type, Waypoints } from 'lucide-react'
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
import { threadPanelLabel, threadPanelTitle } from './threadPanelLabels'
import { parityState } from './parity'
import { ThreadCellClose } from './ThreadCellClose'
import { CollisionChips } from './CollisionChips'
import { THREAD_MORE_ACTION_GROUPS, THREAD_MORE_ACTIONS, type NowLineAction, type ThreadMoreActionId } from './threadMoreActions'
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

/**
 * The quiet header of AG-10 §2.6 (OXE-167): the title, the conversation's own worktree when it has one, the collision
 * chip (frozen 1.5.0 CR-F4-8) and the ⋯ menu in four groups. The agent · workspace?.name · access line and the NowLine
 * strip are no longer drawn here: the sidebar and the composer say them, the request and failure cards own their actions.
 */
export function ThreadHeader({
  thread,
  workspace,
  pending,
  running,
  activePanel,
  showAddTool = false,
  cell,
  onTogglePanel,
  onCommand,
  onExport,
  onDelegate,
  onPin,
  onOpenInCode,
  hasPullRequest = false,
  onNowAction,
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
  showAddTool?: boolean
  cell?: 'primary' | 'secondary'
  onTogglePanel: (panel: ThreadPanel, keepOpen?: boolean) => void
  onCommand: (command: string) => void
  onExport?: () => void
  onImport?: () => void
  onDelegate: () => void
  onPin: () => void
  /** Opens a folder in OxeCode: the conversation's own worktree, else its root (the project menu's handler). */
  onOpenInCode?: (path: string) => void | Promise<void>
  onNowAction?: (action: NowLineAction) => void
  /** The pending request's own buttons are on screen. */
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
      // A checkable entry has no icon: its left column is the check (OXE-13).
      case 'show-every-tool-call': return undefined
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
    const toEntry = (entry: { id: string; label: string }): MenuEntry => {
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
            type: 'check',
            label: entry.label,
            checked: viewMode === 'verbose',
            onSelect: () => useThreadViewModeStore.getState().setMode(viewMode === 'verbose' ? 'normal' : 'verbose')
          }
        case 'details':
          return { label: entry.label, icon: iconFor(id), onSelect: () => onTogglePanel('session') }
        case 'fork':
          return {
            label: entry.label,
            icon: iconFor(id),
            disabled: pending || !forkParity.enabled,
            // Fork is a Codex feature: the reason names where it is available, not only where it is not (BRD-21).
            hint: !forkParity.enabled ? t('moreActions.forkCodexOnly') : undefined,
            onSelect: () => onCommand('/fork')
          }
        case 'export':
          return { label: entry.label, icon: iconFor(id), disabled: !onExport || pending, onSelect: () => onExport?.() }
        // Archive and delete are the destructive group: last, after one separator (BRD-21).
        case 'archive':
          return { label: entry.label, icon: iconFor(id), danger: true, disabled: pending, onSelect: () => onCommand('/archive') }
        case 'delete':
          return { label: entry.label, icon: iconFor(id), danger: true, disabled: pending, onSelect: () => onCommand('/delete') }
      }
    }
    const byId = new Map(THREAD_MORE_ACTIONS.map((entry): [string, MenuEntry] => [entry.id, toEntry(entry)]))
    const openPath = thread.ownedWorktree?.path ?? thread.rootPath
    const openInCode: MenuEntry = {
      label: thread.ownedWorktree ? t('moreActions.openWorktreeInCode') : t('moreActions.openInCode'),
      icon: <Code size={14} aria-hidden="true" />,
      disabled: !onOpenInCode,
      onSelect: () => { void onOpenInCode?.(openPath) }
    }
    const openPullRequest: MenuEntry[] = hasPullRequest && onNowAction
      ? [{ label: t('nowLine.actions.openPr'), icon: <ExternalLink size={14} aria-hidden="true" />, onSelect: () => onNowAction('open-pr') }]
      : []
    return THREAD_MORE_ACTION_GROUPS.flatMap((group, index): MenuEntry[] => [
      ...(index > 0 ? [{ type: 'separator' } as MenuEntry] : []),
      ...group.flatMap(id => id === 'open-in-code' ? [openInCode] : id === 'open-pull-request' ? openPullRequest : byId.has(id) ? [byId.get(id)!] : [])
    ])
  }

  // A conversation gets its title from its first message; until then its title is empty and the heading said nothing.
  const heading = thread?.title?.trim() || (thread ? t('view.newConversation') : t('header.projectConversations'))

  return (
    <header className="thread-heading" data-ui="chat-header" {...(workspace ? workspaceColorAttrs(workspace) : {})}>
      <div className="thread-heading-identity">
        <div className="thread-heading-title-row">
          <div className="thread-heading-title-main">
            <h1 ref={headingRef} tabIndex={-1} title={heading} data-ui="chat-title">{heading}</h1>
            {thread?.ownedWorktree && (
              <span className="thread-heading-worktree" data-ui="chat-worktree" title={thread.ownedWorktree.path}>
                <GitBranch size={12} aria-hidden="true" />
                <span>{thread.ownedWorktree.branch}</span>
              </span>
            )}
            {thread?.id && <CollisionChips threadId={thread.id} />}
          </div>
          <div className="thread-heading-actions">
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
      </div>
    </header>
  )
}
