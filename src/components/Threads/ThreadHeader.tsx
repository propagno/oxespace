import { Folder, GitBranch, Minus, MoreHorizontal, Pin, Plug, Plus, Waypoints, X } from 'lucide-react'
import { Menu, type MenuEntry } from '../../ui'
import type { ConversationThread } from '../../../shared/types/thread'
import type { Workspace } from '../../../shared/types/workspace'
import { THREAD_FONT_DEFAULT, THREAD_FONT_MAX, THREAD_FONT_MIN, useThreadPrefs } from '../../store/thread-prefs.store'
import { THREAD_VIEW_MODES, THREAD_VIEW_MODE_HINT, THREAD_VIEW_MODE_LABEL, useThreadViewModeStore, type ThreadViewMode } from '../../store/thread-view-mode.store'
import type { ThreadPanel } from '../../store/thread-workbench.store'
import { useUIStore } from '../../store/ui.store'
import { ThreadConversationActions } from './ThreadConversationActions'
import { THREAD_BAR_PANELS, THREAD_MENU_PANELS, WORKBENCH_PANELS, type WorkbenchPanelId } from '../Workbench/panelCatalog'
import { WorkbenchPanelToggle } from '../Workbench/WorkbenchPanelMenu'
import { shortcutLabel } from '../../keyboard/keybindings'
import './ThreadHeaderChrome.css'

/** Thread's own panel ids for the shared panel names. Worktrees is Code only and never listed here. */
const THREAD_PANEL = {
  terminal: 'terminal', changes: 'changes', browser: 'preview', git: 'git', files: 'files', search: 'search', scripts: 'scripts', background: 'background'
} as Record<WorkbenchPanelId, ThreadPanel>

/** Title, project and branch, and the conversation's panel, view and pin controls. */
export function ThreadHeader({ thread, workspace, branch, pending, running, activePanel, onTogglePanel, onCommand, onExport, onImport, onDelegate, onPin, onCloseCell }: {
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
  onPin: () => void
  onCloseCell?: () => void
}) {
  const threadFontSize = useThreadPrefs(state => state.fontSize)
  const setThreadFontSize = useThreadPrefs(state => state.setFontSize)
  const viewMode = useThreadViewModeStore(state => state.mode)
  // The provider reported working in another worktree of the repository, or outside it.
  const observed = thread?.observedLocation
  const moved = Boolean(observed?.sameRepository && observed.checkoutRoot)
  const outside = observed && !observed.sameRepository ? observed.cwd : null
  return <header className="thread-heading"><div className="thread-heading-identity"><span className="thread-heading-context" data-moved={moved ? 'true' : undefined} title={moved ? `The agent is working in ${thread!.observedLocation!.checkoutRoot}\nConversation opened in ${thread!.rootPath}` : outside ? `${thread!.rootPath}\nThe agent reports working outside this repository: ${outside}` : thread?.rootPath ?? workspace?.rootPath}><Folder size={13} aria-hidden="true" /><strong>{workspace?.name ?? 'Your projects'}</strong>{branch && <span className="thread-heading-branch"><GitBranch size={11} aria-hidden="true" />{branch}</span>}{moved && <span className="thread-heading-worktree">worktree</span>}</span><h1>{thread?.title ?? 'Project conversations'}</h1>
    {thread && <ThreadConversationActions thread={thread} disabled={pending} onCommand={onCommand} onExport={onExport} onImport={onImport} />}</div>
    <div className="thread-heading-actions">
    {thread && THREAD_BAR_PANELS.map(id => <WorkbenchPanelToggle key={id} className="thread-review-trigger thread-panel-toggle" item={{ id, active: activePanel === THREAD_PANEL[id], onToggle: () => onTogglePanel(THREAD_PANEL[id]) }} />)}
    <Menu label="More actions" align="end" items={[
      ...(thread ? [
        { label: 'Delegate work', icon: <Waypoints size={14} aria-hidden="true" />, disabled: pending || running, onSelect: onDelegate },
        { label: thread.pinned ? 'Unpin conversation' : 'Pin conversation', icon: <Pin size={14} aria-hidden="true" />, disabled: pending, onSelect: onPin }
      ] : []),
      { label: 'MCP servers', icon: <Plug size={14} aria-hidden="true" />, onSelect: () => useUIStore.getState().openMcpPanel() },
      { type: 'separator' },
      { type: 'label', label: <>Text size <output aria-label="Thread text size">{threadFontSize}px</output></> },
      { label: 'Smaller text', icon: <Minus size={14} aria-hidden="true" />, keepOpen: true, disabled: threadFontSize <= THREAD_FONT_MIN, onSelect: () => setThreadFontSize(threadFontSize - 1) },
      { label: 'Larger text', icon: <Plus size={14} aria-hidden="true" />, keepOpen: true, disabled: threadFontSize >= THREAD_FONT_MAX, onSelect: () => setThreadFontSize(threadFontSize + 1) },
      { label: 'Reset text size', keepOpen: true, disabled: threadFontSize === THREAD_FONT_DEFAULT, onSelect: () => setThreadFontSize(THREAD_FONT_DEFAULT) },
      ...(thread ? [
        { type: 'separator' },
        { type: 'label', label: 'Panels' },
        { type: 'radio', value: activePanel ?? '', onValueChange: (value: string) => onTogglePanel(value as ThreadPanel, true),
          options: THREAD_MENU_PANELS.map(id => ({ value: THREAD_PANEL[id], label: WORKBENCH_PANELS[id].label })) },
        { type: 'separator' },
        { type: 'label', label: <>Transcript view <kbd>{shortcutLabel('thread.viewMode')}</kbd></> },
        { type: 'radio', value: viewMode, onValueChange: (value: string) => useThreadViewModeStore.getState().setMode(value as ThreadViewMode),
          options: THREAD_VIEW_MODES.map(mode => ({ value: mode, label: THREAD_VIEW_MODE_LABEL[mode], hint: THREAD_VIEW_MODE_HINT[mode], ariaLabel: `${THREAD_VIEW_MODE_LABEL[mode]} view` })) }
      ] satisfies MenuEntry[] : [])
    ]} trigger={<button type="button" className="thread-icon-action" aria-label="More actions" title="More actions"><MoreHorizontal size={16} /></button>} />
    {onCloseCell && <button type="button" className="thread-icon-action" aria-label="Close side-by-side conversation" title="Close side-by-side conversation" onClick={onCloseCell}><X size={14} /></button>}
    </div>
  </header>
}
