import { Check, GitBranch, Globe, GitCompareArrows, Minus, MoreHorizontal, Pin, Plug, Plus, TerminalSquare, Waypoints, X } from 'lucide-react'
import { DropdownMenu } from 'radix-ui'
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
  // The provider reported working in another worktree of the repository, or outside it.
  const observed = thread?.observedLocation
  const moved = Boolean(observed?.sameRepository && observed.checkoutRoot)
  const outside = observed && !observed.sameRepository ? observed.cwd : null
  return <header className="thread-heading"><div className="thread-heading-identity"><h1>{thread?.title ?? 'Project conversations'}</h1><span className="thread-heading-context" data-moved={moved ? 'true' : undefined} title={moved ? `The agent is working in ${thread!.observedLocation!.checkoutRoot}\nConversation opened in ${thread!.rootPath}` : outside ? `${thread!.rootPath}\nThe agent reports working outside this repository: ${outside}` : thread?.rootPath ?? workspace?.rootPath}>{workspace?.name ?? 'Your projects'}{branch && <><GitBranch size={12} />{branch}</>}{moved && <span className="thread-heading-worktree"> · worktree</span>}</span>
    {thread && <ThreadConversationActions thread={thread} disabled={pending} onCommand={onCommand} onExport={onExport} onImport={onImport} />}</div>
    <div className="thread-heading-actions">
    {thread && ([['terminal', 'Terminal', TerminalSquare, 'Ctrl+`'], ['changes', 'Changes', GitCompareArrows, 'Ctrl+Shift+D'], ['preview', 'Browser', Globe, 'Ctrl+Shift+B']] as const).map(([id, label, Icon, shortcut]) =>
      <button key={id} type="button" className="thread-review-trigger thread-panel-toggle" aria-label={label} title={`${label} · ${shortcut}`} aria-pressed={activePanel === id} onClick={() => onTogglePanel(id)}><Icon size={14} /><span>{label}</span></button>)}
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
            {([['git', 'Commit & pull request'], ['files', 'Files'], ['search', 'Find in files'], ['scripts', 'Scripts'], ['background', 'Background activity']] as const).map(([id, label]) =>
              <DropdownMenu.RadioItem key={id} value={id} className="thread-more-item" aria-label={label}>{label}<DropdownMenu.ItemIndicator><Check size={14} /></DropdownMenu.ItemIndicator></DropdownMenu.RadioItem>)}
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
