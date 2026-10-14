import { lazy, Suspense, useState } from 'react'
import { Check, ChevronDown, ListTree, X } from 'lucide-react'
import type { ThreadSnapshot } from '../../../shared/types/thread'
import type { Workspace } from '../../../shared/types/workspace'
import { DropdownMenu } from 'radix-ui'
import { ThreadSubagentActivity } from './ThreadSubagentActivity'
import { useThreadWorkbenchStore, type ThreadPanel } from '../../store/thread-workbench.store'
import { useEditorStore } from '../../store/editor.store'
import { threadCommitDraft } from '../../../shared/threadCommitDraft'

const GitControlPanel = lazy(() => import('../GitHub/GitControlPanel').then(module => ({ default: module.GitControlPanel })))
const ChangesPanel = lazy(() => import('../Changes/ChangesPanel').then(module => ({ default: module.ChangesPanel })))
const EditorPane = lazy(() => import('../Editor/EditorPane').then(module => ({ default: module.EditorPane })))
const SearchPanel = lazy(() => import('../Search/SearchPanel').then(module => ({ default: module.SearchPanel })))
const ScriptsPanel = lazy(() => import('../Scripts/ScriptsPanel').then(module => ({ default: module.ScriptsPanel })))
const BackgroundJobsPanel = lazy(() => import('../Background/BackgroundJobsPanel').then(module => ({ default: module.BackgroundJobsPanel })))
const WebPreviewPanel = lazy(() => import('../WebPreview/WebPreviewPanel').then(module => ({ default: module.WebPreviewPanel })))
const ThreadProjectTerminal = lazy(() => import('./ThreadProjectTerminal').then(module => ({ default: module.ThreadProjectTerminal })))
const labels: Record<ThreadPanel, string> = { changes: 'Changes', git: 'Commit & pull request', files: 'Files', search: 'Find in files', scripts: 'Scripts', background: 'Background activity', preview: 'Web preview', terminal: 'Terminal' }

export function ThreadChangesPanel({ snapshot, workspace, panel, onClose, onSendToConversation }: { snapshot: ThreadSnapshot; workspace?: Workspace; panel: ThreadPanel; onClose(): void; onSendToConversation?(prompt: string): void }) {
  const [menu, setMenu] = useState(false)
  const subagents = snapshot.events.filter(event => event.type === 'subagent')
  const id = snapshot.thread.id
  const setPanel = (value: ThreadPanel) => { setMenu(false); useThreadWorkbenchStore.getState().setView(id, { panel: value }) }
  const scopedWorkspace = workspace ? { ...workspace, id: snapshot.thread.workspaceId, rootPath: snapshot.thread.rootPath } : undefined
  const openSearchFile = (relativePath: string) => {
    void useEditorStore.getState().openFile({ workspaceId: snapshot.thread.workspaceId, rootPath: snapshot.thread.rootPath, relativePath })
    useThreadWorkbenchStore.getState().setView(id, { panel: 'files' })
  }
  return <aside className="thread-review-panel" aria-label="Thread workbench">
    <header className="thread-review-heading"><div className="thread-review-menu"><DropdownMenu.Root open={menu} onOpenChange={setMenu}><DropdownMenu.Trigger asChild><button type="button" aria-label="Select workbench panel"><ListTree size={14} />{labels[panel]}<ChevronDown size={12} /></button></DropdownMenu.Trigger>
      <DropdownMenu.Portal><DropdownMenu.Content collisionPadding={{ top: 44, right: 8, bottom: 8, left: 8 }} className="thread-review-menu-items" align="start" sideOffset={6}><DropdownMenu.RadioGroup value={panel} onValueChange={value => setPanel(value as ThreadPanel)}>{(Object.keys(labels) as ThreadPanel[]).map(value => <DropdownMenu.RadioItem key={value} value={value} className="thread-review-menu-item">{labels[value]}<DropdownMenu.ItemIndicator><Check size={13} /></DropdownMenu.ItemIndicator></DropdownMenu.RadioItem>)}</DropdownMenu.RadioGroup></DropdownMenu.Content></DropdownMenu.Portal></DropdownMenu.Root></div>
      <button type="button" aria-label="Close workbench panel" title="Close" onClick={onClose}><X size={15} /></button></header>
    {panel === 'changes' ? <div className="thread-review-body thread-tool-surface"><Suspense fallback={<p className="thread-review-empty">Loading changes…</p>}><ChangesPanel workspaceId={snapshot.thread.workspaceId} rootPath={snapshot.thread.rootPath} onSendComments={onSendToConversation ? text => { onSendToConversation(text); return true } : undefined} /></Suspense></div>
      : panel === 'git' ? <div className="thread-review-body thread-tool-surface"><Suspense fallback={<p className="thread-review-empty">Loading Git…</p>}><GitControlPanel workspaceId={snapshot.thread.workspaceId} rootPath={snapshot.thread.rootPath} onOpenFile={openSearchFile} draft={() => threadCommitDraft(snapshot)} /></Suspense></div>
      : panel === 'files' ? <div className="thread-review-body thread-tool-surface">{scopedWorkspace ? <Suspense fallback={<p className="thread-review-empty">Loading files…</p>}><EditorPane workspaceId={snapshot.thread.workspaceId} rootPath={snapshot.thread.rootPath} /></Suspense> : <p className="thread-review-empty">The project is unavailable.</p>}</div>
      : panel === 'search' ? <div className="thread-review-body thread-tool-surface">{scopedWorkspace ? <Suspense fallback={<p className="thread-review-empty">Loading search…</p>}><SearchPanel workspace={scopedWorkspace} onOpenFile={openSearchFile} /></Suspense> : <p className="thread-review-empty">The project is unavailable.</p>}</div>
      : panel === 'scripts' ? <div className="thread-review-body thread-tool-surface">{scopedWorkspace ? <Suspense fallback={<p className="thread-review-empty">Loading scripts…</p>}><ScriptsPanel workspace={scopedWorkspace} embedded onClose={onClose} onOpenBackground={() => setPanel('background')} /></Suspense> : <p className="thread-review-empty">The project is unavailable.</p>}</div>
      : panel === 'background' ? <div className="thread-review-body thread-tool-surface thread-background-surface"><section aria-label="Native background activity"><h3>Provider activity · {subagents.filter(event => event.type === 'subagent' && event.state === 'running').length} running</h3>{subagents.map(event => event.type === 'subagent' && <ThreadSubagentActivity key={event.id} event={event} />)}{!subagents.length && <p>No native tasks have been reported in this conversation.</p>}</section><Suspense fallback={<p className="thread-review-empty">Loading background activity…</p>}><BackgroundJobsPanel workspaceId={snapshot.thread.workspaceId} /></Suspense></div>
      : panel === 'preview' ? <div className="thread-review-body thread-tool-surface">{scopedWorkspace ? <Suspense fallback={<p className="thread-review-empty">Loading web preview…</p>}><WebPreviewPanel workspace={scopedWorkspace} threadId={id} embedded onClose={onClose} onRunCommand={() => {}} onSendToAgent={onSendToConversation} /></Suspense> : <p className="thread-review-empty">The project is unavailable.</p>}</div>
      : <div className="thread-review-body thread-tool-surface thread-terminal-surface"><Suspense fallback={<p className="thread-review-empty">Loading terminal…</p>}><ThreadProjectTerminal key={id} thread={snapshot.thread} /></Suspense></div>}
  </aside>
}
