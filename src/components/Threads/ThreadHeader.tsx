import { Check, GitBranch, Globe, GitCompareArrows, Minus, MoreHorizontal, Pin, Plug, Plus, TerminalSquare, Type, Waypoints, X } from 'lucide-react'
import { DropdownMenu, Popover } from 'radix-ui'
import type { ConversationThread } from '../../../shared/types/thread'
import type { Workspace } from '../../../shared/types/workspace'
import { THREAD_FONT_DEFAULT, THREAD_FONT_MAX, THREAD_FONT_MIN, useThreadPrefs } from '../../store/thread-prefs.store'
import { THREAD_VIEW_MODES, THREAD_VIEW_MODE_HINT, THREAD_VIEW_MODE_LABEL, useThreadViewModeStore, type ThreadViewMode } from '../../store/thread-view-mode.store'
import type { ThreadPanel } from '../../store/thread-workbench.store'
import { useUIStore } from '../../store/ui.store'
import { ThreadConversationActions } from './ThreadConversationActions'

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
    <Popover.Root><Popover.Trigger asChild><button type="button" className="thread-icon-action" aria-label="Thread text size" title="Thread text size"><Type size={15} /></button></Popover.Trigger>
      <Popover.Portal><Popover.Content collisionPadding={{ top: 44, right: 8, bottom: 8, left: 8 }} className="thread-font-popover" side="bottom" align="end" sideOffset={8}>
        <strong>Conversation text</strong><span>Adjust reading size</span>
        <div className="thread-font-controls"><button type="button" aria-label="Decrease thread text size" disabled={threadFontSize <= THREAD_FONT_MIN} onClick={() => setThreadFontSize(threadFontSize - 1)}><Minus size={14} /></button><output aria-label="Thread text size">{threadFontSize}px</output><button type="button" aria-label="Increase thread text size" disabled={threadFontSize >= THREAD_FONT_MAX} onClick={() => setThreadFontSize(threadFontSize + 1)}><Plus size={14} /></button></div>
        <button type="button" className="thread-font-reset" disabled={threadFontSize === THREAD_FONT_DEFAULT} onClick={() => setThreadFontSize(THREAD_FONT_DEFAULT)}>Reset to default</button>
        <Popover.Arrow className="thread-font-arrow" /></Popover.Content></Popover.Portal></Popover.Root>
    {thread && <>
      {([['terminal', 'Terminal', TerminalSquare, 'Ctrl+`'], ['changes', 'Changes', GitCompareArrows, 'Ctrl+Shift+D'], ['preview', 'Browser', Globe, 'Ctrl+Shift+B']] as const).map(([id, label, Icon, shortcut]) =>
        <button key={id} type="button" className="thread-review-trigger thread-panel-toggle" aria-label={label} title={`${label} · ${shortcut}`} aria-pressed={activePanel === id} onClick={() => onTogglePanel(id)}><Icon size={14} /><span>{label}</span></button>)}
      <DropdownMenu.Root>
        <DropdownMenu.Trigger asChild><button type="button" className="thread-icon-action" aria-label="More workbench panels" title="Files, search, scripts, background activity and transcript view"><MoreHorizontal size={16} /></button></DropdownMenu.Trigger>
        <DropdownMenu.Portal><DropdownMenu.Content collisionPadding={{ top: 44, right: 8, bottom: 8, left: 8 }} className="thread-more-menu" align="end" sideOffset={6}>
          <DropdownMenu.Label className="thread-more-label">Panels</DropdownMenu.Label>
          <DropdownMenu.RadioGroup value={activePanel ?? ''} onValueChange={value => onTogglePanel(value as ThreadPanel, true)}>
            {([['git', 'Commit & pull request'], ['files', 'Files'], ['search', 'Find in files'], ['scripts', 'Scripts'], ['background', 'Background activity']] as const).map(([id, label]) =>
              <DropdownMenu.RadioItem key={id} value={id} className="thread-more-item" aria-label={label}>{label}<DropdownMenu.ItemIndicator><Check size={13} /></DropdownMenu.ItemIndicator></DropdownMenu.RadioItem>)}
          </DropdownMenu.RadioGroup>
          <DropdownMenu.Separator className="thread-more-separator" />
          <DropdownMenu.Label className="thread-more-label">Transcript view <kbd>Ctrl+O</kbd></DropdownMenu.Label>
          <DropdownMenu.RadioGroup value={viewMode} onValueChange={value => useThreadViewModeStore.getState().setMode(value as ThreadViewMode)}>
            {THREAD_VIEW_MODES.map(mode => <DropdownMenu.RadioItem key={mode} value={mode} className="thread-more-item" aria-label={`${THREAD_VIEW_MODE_LABEL[mode]} view`}>
              <span>{THREAD_VIEW_MODE_LABEL[mode]}<small>{THREAD_VIEW_MODE_HINT[mode]}</small></span><DropdownMenu.ItemIndicator><Check size={13} /></DropdownMenu.ItemIndicator></DropdownMenu.RadioItem>)}
          </DropdownMenu.RadioGroup>
        </DropdownMenu.Content></DropdownMenu.Portal>
      </DropdownMenu.Root>
    </>}
    {thread && <button type="button" className="thread-review-trigger" aria-label="Delegate work" title="Delegate to a persistent worktree Thread" disabled={pending || running} onClick={onDelegate}><Waypoints size={14} /><span>Delegate</span></button>}
    <button type="button" className="thread-review-trigger" aria-label="MCP connections" title="Connect MCP servers for this project" onClick={() => useUIStore.getState().openMcpPanel()}><Plug size={14} /><span>Connections</span></button>
    {thread && <button type="button" className="thread-icon-action" aria-label={thread.pinned ? 'Unpin thread' : 'Pin thread'} title={thread.pinned ? 'Unpin thread' : 'Pin thread'} disabled={pending} onClick={onPin}><Pin size={15} /></button>}
    {onCloseCell && <button type="button" className="thread-icon-action" aria-label="Close side-by-side conversation" title="Close side-by-side conversation" onClick={onCloseCell}><X size={15} /></button>}
    </div>
  </header>
}
