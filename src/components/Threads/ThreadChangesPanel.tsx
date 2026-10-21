import { lazy, Suspense } from 'react'
import { ChevronDown, ListTree, X } from 'lucide-react'
import type { ThreadSnapshot } from '../../../shared/types/thread'
import type { Workspace } from '../../../shared/types/workspace'
import { WORKBENCH_PANELS } from '../Workbench/panelCatalog'
import { ThreadSubagentActivity } from './ThreadSubagentActivity'
import { useThreadWorkbenchStore, type ThreadPanel } from '../../store/thread-workbench.store'
import { useEditorStore } from '../../store/editor.store'
import { threadCommitDraft } from '../../../shared/threadCommitDraft'
import { EmptyState, Menu } from '../../ui'
import { threadWorkingRoot } from './threadChanges'
import { ThreadTurnReview } from './ThreadTurnReview'

const GitControlPanel = lazy(() => import('../GitHub/GitControlPanel').then(module => ({ default: module.GitControlPanel })))
const ChangesPanel = lazy(() => import('../Changes/ChangesPanel').then(module => ({ default: module.ChangesPanel })))
const EditorPane = lazy(() => import('../Editor/EditorPane').then(module => ({ default: module.EditorPane })))
const SearchPanel = lazy(() => import('../Search/SearchPanel').then(module => ({ default: module.SearchPanel })))
const ScriptsPanel = lazy(() => import('../Scripts/ScriptsPanel').then(module => ({ default: module.ScriptsPanel })))
const BackgroundJobsPanel = lazy(() => import('../Background/BackgroundJobsPanel').then(module => ({ default: module.BackgroundJobsPanel })))
const WebPreviewPanel = lazy(() => import('../WebPreview/WebPreviewPanel').then(module => ({ default: module.WebPreviewPanel })))
const ThreadProjectTerminal = lazy(() => import('./ThreadProjectTerminal').then(module => ({ default: module.ThreadProjectTerminal })))
/** Thread panels named as everywhere else (src/components/Workbench/panelCatalog.ts). */
const labels: Record<ThreadPanel, string> = { changes: WORKBENCH_PANELS.changes.label, git: WORKBENCH_PANELS.git.label, files: WORKBENCH_PANELS.files.label, search: WORKBENCH_PANELS.search.label, scripts: WORKBENCH_PANELS.scripts.label, background: WORKBENCH_PANELS.background.label, preview: WORKBENCH_PANELS.browser.label, terminal: WORKBENCH_PANELS.terminal.label }

export function ThreadChangesPanel({ snapshot, workspace, panel, onClose, onSendToConversation }: { snapshot: ThreadSnapshot; workspace?: Workspace; panel: ThreadPanel; onClose(): void; onSendToConversation?(prompt: string): void }) {
  const subagents = snapshot.events.filter(event => event.type === 'subagent')
  const id = snapshot.thread.id
  // Changes, Git, files and search follow the worktree the provider moved into, when it reported one.
  const root = threadWorkingRoot(snapshot.thread)
  const setPanel = (value: ThreadPanel) => { useThreadWorkbenchStore.getState().setView(id, { panel: value }) }
  const turnId = useThreadWorkbenchStore(state => state.views[id]?.turnId)
  const scopedWorkspace = workspace ? { ...workspace, id: snapshot.thread.workspaceId, rootPath: root } : undefined
  const openSearchFile = (relativePath: string) => {
    void useEditorStore.getState().openFile({ workspaceId: snapshot.thread.workspaceId, rootPath: root, relativePath })
    useThreadWorkbenchStore.getState().setView(id, { panel: 'files' })
  }
  return <aside className="thread-review-panel" aria-label="Thread workbench">
    <header className="thread-review-heading"><div className="thread-review-menu"><Menu label="Workbench panels" items={[{ type: 'radio', value: panel, onValueChange: value => setPanel(value as ThreadPanel), options: (Object.keys(labels) as ThreadPanel[]).map(value => ({ value, label: labels[value] })) }]}
      trigger={<button type="button" aria-label="Select workbench panel"><ListTree size={14} />{labels[panel]}<ChevronDown size={12} /></button>} /></div>
      <button type="button" aria-label="Close workbench panel" title="Close" onClick={onClose}><X size={14} /></button></header>
    {panel === 'changes' && turnId ? <div className="thread-review-body thread-tool-surface"><ThreadTurnReview key={turnId} snapshot={snapshot} turnId={turnId} onShowAll={() => useThreadWorkbenchStore.getState().setView(id, { panel: 'changes', turnId: undefined })} onComment={text => onSendToConversation?.(text)} /></div>
      : panel === 'changes' ? <div className="thread-review-body thread-tool-surface"><Suspense fallback={<EmptyState compact title="Loading changes…" />}><ChangesPanel workspaceId={snapshot.thread.workspaceId} rootPath={root} onSendComments={onSendToConversation ? text => { onSendToConversation(text); return true } : undefined} /></Suspense></div>
      : panel === 'git' ? <div className="thread-review-body thread-tool-surface"><Suspense fallback={<EmptyState compact title="Loading Git…" />}><GitControlPanel workspaceId={snapshot.thread.workspaceId} rootPath={root} onOpenFile={openSearchFile} draft={() => threadCommitDraft(snapshot)} /></Suspense></div>
      : panel === 'files' ? <div className="thread-review-body thread-tool-surface">{scopedWorkspace ? <Suspense fallback={<EmptyState compact title="Loading files…" />}><EditorPane workspaceId={snapshot.thread.workspaceId} rootPath={root} /></Suspense> : <EmptyState compact title="The project is unavailable." />}</div>
      : panel === 'search' ? <div className="thread-review-body thread-tool-surface">{scopedWorkspace ? <Suspense fallback={<EmptyState compact title="Loading search…" />}><SearchPanel workspace={scopedWorkspace} onOpenFile={openSearchFile} /></Suspense> : <EmptyState compact title="The project is unavailable." />}</div>
      : panel === 'scripts' ? <div className="thread-review-body thread-tool-surface">{scopedWorkspace ? <Suspense fallback={<EmptyState compact title="Loading scripts…" />}><ScriptsPanel workspace={scopedWorkspace} embedded onClose={onClose} onOpenBackground={() => setPanel('background')} /></Suspense> : <EmptyState compact title="The project is unavailable." />}</div>
      : panel === 'background' ? <div className="thread-review-body thread-tool-surface thread-background-surface"><section aria-label="Native background activity"><h3>Provider activity · {subagents.filter(event => event.type === 'subagent' && event.state === 'running').length} running</h3>{subagents.map(event => event.type === 'subagent' && <ThreadSubagentActivity key={event.id} event={event} />)}{!subagents.length && <p>No native tasks have been reported in this conversation.</p>}</section><Suspense fallback={<EmptyState compact title="Loading background activity…" />}><BackgroundJobsPanel workspaceId={snapshot.thread.workspaceId} /></Suspense></div>
      : panel === 'preview' ? <div className="thread-review-body thread-tool-surface">{scopedWorkspace ? <Suspense fallback={<EmptyState compact title="Loading web preview…" />}><WebPreviewPanel workspace={scopedWorkspace} threadId={id} embedded onClose={onClose} onRunCommand={() => {}} onSendToAgent={onSendToConversation} /></Suspense> : <EmptyState compact title="The project is unavailable." />}</div>
      : <div className="thread-review-body thread-tool-surface thread-terminal-surface"><Suspense fallback={<EmptyState compact title="Loading terminal…" />}><ThreadProjectTerminal key={id} thread={snapshot.thread} /></Suspense></div>}
  </aside>
}
