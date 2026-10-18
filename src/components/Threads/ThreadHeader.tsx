import { Check, GitBranch, Minus, MoreHorizontal, Pin, Plug, Plus, Waypoints, X } from 'lucide-react'
import { DropdownMenu } from 'radix-ui'
import type { ConversationThread } from '../../../shared/types/thread'
import type { Workspace } from '../../../shared/types/workspace'
import { THREAD_FONT_DEFAULT, THREAD_FONT_MAX, THREAD_FONT_MIN, useThreadPrefs } from '../../store/thread-prefs.store'
import { THREAD_VIEW_MODES, THREAD_VIEW_MODE_HINT, THREAD_VIEW_MODE_LABEL, useThreadViewModeStore, type ThreadViewMode } from '../../store/thread-view-mode.store'
import type { ThreadPanel } from '../../store/thread-workbench.store'
import { useUIStore } from '../../store/ui.store'
import { ThreadConversationActions } from './ThreadConversationActions'
import { THREAD_BAR_PANELS, THREAD_MENU_PANELS, WORKBENCH_PANELS, type WorkbenchPanelId } from '../Workbench/panelCatalog'
import { WorkbenchPanelToggle } from '../Workbench/WorkbenchPanelMenu'

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
  return <header className="thread-heading"><div className="thread-heading-identity"><h1>{thread?.title ?? 'Project conversations'}</h1><span className="thread-heading-context" title={thread?.rootPath ?? workspace?.rootPath}>{workspace?.name ?? 'Your projects'}{branch && <><GitBranch size={12} />{branch}</>}</span>
    {thread && <ThreadConversationActions thread={thread} disabled={pending} onCommand={onCommand} onExport={onExport} onImport={onImport} />}</div>
    <div className="thread-heading-actions">
    {thread && THREAD_BAR_PANELS.map(id => <WorkbenchPanelToggle key={id} className="thread-review-trigger thread-panel-toggle" item={{ id, active: activePanel === THREAD_PANEL[id], onToggle: () => onTogglePanel(THREAD_PANEL[id]) }} />)}
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild><button type="button" className="thread-icon-action" aria-label="More actions" title="More actions"><MoreHorizontal size={16} /></button></DropdownMenu.Trigger>
      <DropdownMenu.Portal><DropdownMenu.Content collisionPadding={{ top: 44, right: 8, bottom: 8, left: 8 }} className="thread-more-menu" align="end" sideOffset={6}>
        {thread && <>
          <DropdownMenu.Item className="thread-more-item" disabled={pending || running} onSelect={onDelegate}><Waypoints size={14} aria-hidden="true" />Delegate work</DropdownMenu.Item>
          <DropdownMenu.Item className="thread-more-item" disabled={pending} onSelect={onPin}><Pin size={14} aria-hidden="true" />{thread.pinned ? 'Unpin thread' : 'Pin thread'}</DropdownMenu.Item>
        </>}
        <DropdownMenu.Item className="thread-more-item" onSelect={() => useUIStore.getState().openMcpPanel()}><Plug size={14} aria-hidden="true" />MCP connections</DropdownMenu.Item>
        <DropdownMenu.Separator className="thread-more-separator" />
        <DropdownMenu.Label className="thread-more-label">Text size <output aria-label="Thread text size">{threadFontSize}px</output></DropdownMenu.Label>
        <DropdownMenu.Item className="thread-more-item" disabled={threadFontSize <= THREAD_FONT_MIN} onSelect={event => { event.preventDefault(); setThreadFontSize(threadFontSize - 1) }}><Minus size={14} aria-hidden="true" />Smaller text</DropdownMenu.Item>
        <DropdownMenu.Item className="thread-more-item" disabled={threadFontSize >= THREAD_FONT_MAX} onSelect={event => { event.preventDefault(); setThreadFontSize(threadFontSize + 1) }}><Plus size={14} aria-hidden="true" />Larger text</DropdownMenu.Item>
        <DropdownMenu.Item className="thread-more-item" disabled={threadFontSize === THREAD_FONT_DEFAULT} onSelect={event => { event.preventDefault(); setThreadFontSize(THREAD_FONT_DEFAULT) }}>Reset text size</DropdownMenu.Item>
        {thread && <>
          <DropdownMenu.Separator className="thread-more-separator" />
          <DropdownMenu.Label className="thread-more-label">Panels</DropdownMenu.Label>
          <DropdownMenu.RadioGroup value={activePanel ?? ''} onValueChange={value => onTogglePanel(value as ThreadPanel, true)}>
            {THREAD_MENU_PANELS.map(id => <DropdownMenu.RadioItem key={id} value={THREAD_PANEL[id]} className="thread-more-item" aria-label={WORKBENCH_PANELS[id].label}>{WORKBENCH_PANELS[id].label}<DropdownMenu.ItemIndicator><Check size={14} /></DropdownMenu.ItemIndicator></DropdownMenu.RadioItem>)}
          </DropdownMenu.RadioGroup>
          <DropdownMenu.Separator className="thread-more-separator" />
          <DropdownMenu.Label className="thread-more-label">Transcript view <kbd>Ctrl+O</kbd></DropdownMenu.Label>
          <DropdownMenu.RadioGroup value={viewMode} onValueChange={value => useThreadViewModeStore.getState().setMode(value as ThreadViewMode)}>
            {THREAD_VIEW_MODES.map(mode => <DropdownMenu.RadioItem key={mode} value={mode} className="thread-more-item" aria-label={`${THREAD_VIEW_MODE_LABEL[mode]} view`}>
              <span>{THREAD_VIEW_MODE_LABEL[mode]}<small>{THREAD_VIEW_MODE_HINT[mode]}</small></span><DropdownMenu.ItemIndicator><Check size={14} /></DropdownMenu.ItemIndicator></DropdownMenu.RadioItem>)}
          </DropdownMenu.RadioGroup>
        </>}
      </DropdownMenu.Content></DropdownMenu.Portal>
    </DropdownMenu.Root>
    {onCloseCell && <button type="button" className="thread-icon-action" aria-label="Close side-by-side conversation" title="Close side-by-side conversation" onClick={onCloseCell}><X size={14} /></button>}
    </div>
  </header>
}
