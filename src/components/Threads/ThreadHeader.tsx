import { Folder, GitBranch, Minus, MoreHorizontal, Pin, Plug, Plus, Waypoints, X, MessagesSquare } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Menu, type MenuEntry } from '../../ui'
import type { ConversationThread } from '../../../shared/types/thread'
import type { Workspace } from '../../../shared/types/workspace'
import { THREAD_FONT_DEFAULT, THREAD_FONT_MAX, THREAD_FONT_MIN, useThreadPrefs } from '../../store/thread-prefs.store'
import { THREAD_VIEW_MODES, useThreadViewModeStore, type ThreadViewMode } from '../../store/thread-view-mode.store'
import type { ThreadPanel } from '../../store/thread-workbench.store'
import { useUIStore } from '../../store/ui.store'
import { ThreadConversationActions } from './ThreadConversationActions'
import { THREAD_BAR_PANELS, THREAD_MENU_PANELS, type WorkbenchPanelId } from '../Workbench/panelCatalog'
import { threadPanelLabel, threadPanelTitle } from './threadPanelLabels'
import { WorkbenchPanelToggle } from '../Workbench/WorkbenchPanelMenu'
import { shortcutLabel } from '../../keyboard/keybindings'
import { ThreadCoordinatorOverview } from './ThreadCoordinatorOverview'
import './ThreadHeaderChrome.css'

/** Thread's own panel ids for the shared panel names. Worktrees is Code only and never listed here. */
const THREAD_PANEL = {
  terminal: 'terminal', changes: 'changes', browser: 'preview', git: 'git', files: 'files', search: 'search', scripts: 'scripts', background: 'background'
} as Record<WorkbenchPanelId, ThreadPanel>

/** Title, project and branch, and the conversation's panel, view and pin controls. */
export function ThreadHeader({ thread, workspace, branch, pending, running, activePanel, onTogglePanel, onCommand, onExport, onImport, onDelegate, sideChatOpen = false, onSideChat, onPin, onCloseCell }: {
  thread?: ConversationThread
  workspace?: Workspace
  branch?: string
  pending: boolean
  running: boolean
  activePanel?: ThreadPanel | null
  onTogglePanel: (panel: ThreadPanel, keepOpen?: boolean) => void
  onCommand: (command: string) => void
  onExport?: () => void
  onImport?: () => void
  onDelegate: () => void
  /** The side chat drawer (B1.2): open, and its toggle. */
  sideChatOpen?: boolean
  onSideChat?: () => void
  onPin: () => void
  onCloseCell?: () => void
}) {
  const { t } = useTranslation('thread')
  const threadFontSize = useThreadPrefs(state => state.fontSize)
  const setThreadFontSize = useThreadPrefs(state => state.setFontSize)
  const viewMode = useThreadViewModeStore(state => state.mode)
  // The provider reported working in another worktree of the repository, or outside it.
  const observed = thread?.observedLocation
  const moved = Boolean(observed?.sameRepository && observed.checkoutRoot)
  const outside = observed && !observed.sameRepository ? observed.cwd : null
  // The conversation was started in a worktree of its own: its branch is shown even before Git answers.
  const owned = thread?.ownedWorktree
  return <header className="thread-heading"><div className="thread-heading-identity"><span className="thread-heading-context" data-moved={moved ? 'true' : undefined} title={moved ? t('header.movedTitle', { checkout: thread!.observedLocation!.checkoutRoot, root: thread!.rootPath }) : outside ? t('header.outsideTitle', { root: thread!.rootPath, cwd: outside }) : thread?.rootPath ?? workspace?.rootPath}><Folder size={13} aria-hidden="true" /><strong>{workspace?.name ?? t('header.yourProjects')}</strong>{(branch ?? owned?.branch) && <span className="thread-heading-branch"><GitBranch size={11} aria-hidden="true" />{branch ?? owned?.branch}</span>}{(moved || owned) && <span className="thread-heading-worktree" title={owned ? t('header.ownedTitle', { branch: owned.branch, root: owned.projectRoot }) : undefined}>{t('header.worktree')}</span>}</span><h1>{thread?.title ?? t('header.projectConversations')}</h1>
    {thread && <ThreadConversationActions thread={thread} disabled={pending} onCommand={onCommand} onExport={onExport} onImport={onImport} />}</div>
    <div className="thread-heading-actions">
    {thread && THREAD_BAR_PANELS.map(id => <WorkbenchPanelToggle key={id} className="thread-review-trigger thread-panel-toggle" item={{ id, label: threadPanelLabel(id), title: threadPanelTitle(id), active: activePanel === THREAD_PANEL[id], onToggle: () => onTogglePanel(THREAD_PANEL[id]) }} />)}
    {thread && <ThreadCoordinatorOverview thread={thread} />}
    <Menu label={t('header.moreActions')} align="end" items={[
      ...(thread ? [
        { label: t('header.delegate'), icon: <Waypoints size={14} aria-hidden="true" />, disabled: pending || running, onSelect: onDelegate },
        ...(onSideChat ? [{ label: t(sideChatOpen ? 'side.closeMenu' : 'side.openMenu'), shortcut: shortcutLabel('thread.sideChat'), icon: <MessagesSquare size={14} aria-hidden="true" />, onSelect: onSideChat }] : []),
        { label: thread.pinned ? t('header.unpin') : t('header.pin'), icon: <Pin size={14} aria-hidden="true" />, disabled: pending, onSelect: onPin }
      ] : []),
      { label: t('header.mcp'), icon: <Plug size={14} aria-hidden="true" />, onSelect: () => useUIStore.getState().openMcpPanel() },
      { type: 'separator' },
      { type: 'label', label: <>{t('header.textSize')} <output aria-label={t('header.textSizeValue')}>{threadFontSize}px</output></> },
      { label: t('header.smaller'), icon: <Minus size={14} aria-hidden="true" />, keepOpen: true, disabled: THREAD_FONT_MIN >= threadFontSize, onSelect: () => setThreadFontSize(threadFontSize - 1) },
      { label: t('header.larger'), icon: <Plus size={14} aria-hidden="true" />, keepOpen: true, disabled: threadFontSize >= THREAD_FONT_MAX, onSelect: () => setThreadFontSize(threadFontSize + 1) },
      { label: t('header.resetSize'), keepOpen: true, disabled: threadFontSize === THREAD_FONT_DEFAULT, onSelect: () => setThreadFontSize(THREAD_FONT_DEFAULT) },
      ...(thread ? [
        { type: 'separator' },
        { type: 'label', label: t('workbench.panels') },
        { type: 'radio', value: activePanel ?? '', onValueChange: (value: string) => onTogglePanel(value as ThreadPanel, true),
          options: THREAD_MENU_PANELS.map(id => ({ value: THREAD_PANEL[id], label: threadPanelLabel(id) })) },
        { type: 'separator' },
        { type: 'label', label: <>{t('header.transcriptView')} <kbd>{shortcutLabel('thread.viewMode')}</kbd></> },
        { type: 'radio', value: viewMode, onValueChange: (value: string) => useThreadViewModeStore.getState().setMode(value as ThreadViewMode),
          options: THREAD_VIEW_MODES.map(mode => ({ value: mode, label: t(`viewMode.${mode}.label`), hint: t(`viewMode.${mode}.hint`), ariaLabel: t('viewMode.ariaLabel', { mode: t(`viewMode.${mode}.label`) }) })) }
      ] satisfies MenuEntry[] : [])
    ]} trigger={<button type="button" className="thread-icon-action" aria-label={t('header.moreActions')} title={t('header.moreActions')}><MoreHorizontal size={16} /></button>} />
    {onCloseCell && <button type="button" className="thread-icon-action" aria-label={t('header.closeSide')} title={t('header.closeSide')} onClick={onCloseCell}><X size={14} /></button>}
    </div>
  </header>
}
