import { lazy, Suspense } from 'react'
import { ChevronDown, ListTree, Maximize2, Minimize2, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { ThreadSnapshot } from '../../../shared/types/thread'
import type { Workspace } from '../../../shared/types/workspace'
import type { WorkbenchPanelId } from '../Workbench/panelCatalog'
import { threadPanelLabel } from './threadPanelLabels'
import { ThreadSubagentActivity } from './ThreadSubagentActivity'
import { useThreadWorkbenchStore, type ThreadPanel } from '../../store/thread-workbench.store'
import { useEditorStore } from '../../store/editor.store'
import { threadCommitDraft } from '../../../shared/threadCommitDraft'
import { EmptyState, LoadingState, Menu } from '../../ui'
import { threadWorkingRoot } from './threadChanges'
import { ThreadTurnReview } from './ThreadTurnReview'
import { ThreadSessionPanel } from './ThreadSessionPanel'

const GitControlPanel = lazy(() => import('../GitHub/GitControlPanel').then(module => ({ default: module.GitControlPanel })))
const ChangesPanel = lazy(() => import('../Changes/ChangesPanel').then(module => ({ default: module.ChangesPanel })))
const EditorPane = lazy(() => import('../Editor/EditorPane').then(module => ({ default: module.EditorPane })))
const SearchPanel = lazy(() => import('../Search/SearchPanel').then(module => ({ default: module.SearchPanel })))
const ScriptsPanel = lazy(() => import('../Scripts/ScriptsPanel').then(module => ({ default: module.ScriptsPanel })))
const BackgroundJobsPanel = lazy(() => import('../Background/BackgroundJobsPanel').then(module => ({ default: module.BackgroundJobsPanel })))
const WebPreviewPanel = lazy(() => import('../WebPreview/WebPreviewPanel').then(module => ({ default: module.WebPreviewPanel })))
const ThreadProjectTerminal = lazy(() => import('./ThreadProjectTerminal').then(module => ({ default: module.ThreadProjectTerminal })))
/** Thread panels named as everywhere else (src/components/Workbench/panelCatalog.ts). */
const PANEL_ID: Record<ThreadPanel, WorkbenchPanelId> = { session: 'session', changes: 'changes', git: 'git', files: 'files', search: 'search', scripts: 'scripts', background: 'background', preview: 'browser', terminal: 'terminal' }

export function ThreadChangesPanel({ snapshot, workspace, panel, onClose, onSendToConversation, onCompact, maximized = false, onToggleMaximized }: { snapshot: ThreadSnapshot; workspace?: Workspace; panel: ThreadPanel; onClose(): void; onSendToConversation?(prompt: string): void; /** Runs /compact in the conversation; without it the session panel offers no Compact. */ onCompact?(): void; maximized?: boolean; onToggleMaximized?(): void }) {
  const { t } = useTranslation('thread')
  const subagents = snapshot.events.filter(event => event.type === 'subagent')
  const id = snapshot.thread.id
  const unavailable = <EmptyState compact title={t('workbench.unavailable')} />
  // Changes, Git, files and search follow the worktree the provider moved into, when it reported one.
  const root = threadWorkingRoot(snapshot.thread)
  const setPanel = (value: ThreadPanel) => { useThreadWorkbenchStore.getState().setView(id, { panel: value }) }
  const turnId = useThreadWorkbenchStore(state => state.views[id]?.turnId)
  const scopedWorkspace = workspace ? { ...workspace, id: snapshot.thread.workspaceId, rootPath: root } : undefined
  const openSearchFile = (relativePath: string) => {
    void useEditorStore.getState().openFile({ workspaceId: snapshot.thread.workspaceId, rootPath: root, relativePath })
    useThreadWorkbenchStore.getState().setView(id, { panel: 'files' })
  }
  return <aside className="thread-review-panel" aria-label={t('workbench.label')}>
    <header className="thread-review-heading"><div className="thread-review-menu"><Menu label={t('workbench.panels')} items={[{ type: 'radio', value: panel, onValueChange: value => setPanel(value as ThreadPanel), options: (Object.keys(PANEL_ID) as ThreadPanel[]).map(value => ({ value, label: threadPanelLabel(PANEL_ID[value]) })) }]}
      trigger={<button type="button" aria-label={t('workbench.select', { panel: threadPanelLabel(PANEL_ID[panel]) })}><ListTree size={14} />{threadPanelLabel(PANEL_ID[panel])}<ChevronDown size={12} /></button>} /></div>
      {onToggleMaximized && <button type="button" aria-label={maximized ? t('workbench.restore') : t('workbench.maximize')} aria-pressed={maximized} title={maximized ? t('workbench.restoreTitle') : t('workbench.maximizeTitle')} onClick={onToggleMaximized}>{maximized ? <Minimize2 size={14} /> : <Maximize2 size={14} />}</button>}
      <button type="button" aria-label={t('workbench.close')} title={t('common.close')} onClick={onClose}><X size={14} /></button></header>
    {panel === 'session' ? <div className="thread-review-body thread-tool-surface"><ThreadSessionPanel snapshot={snapshot} workspace={workspace} running={snapshot.thread.status === 'running' || snapshot.thread.status === 'approval'} onOpenPanel={setPanel} onCompact={onCompact} /></div>
      : panel === 'changes' && turnId ? <div className="thread-review-body thread-tool-surface"><ThreadTurnReview key={turnId} snapshot={snapshot} turnId={turnId} onShowAll={() => useThreadWorkbenchStore.getState().setView(id, { panel: 'changes', turnId: undefined })} onComment={text => onSendToConversation?.(text)} /></div>
      : panel === 'changes' ? <div className="thread-review-body thread-tool-surface"><Suspense fallback={<LoadingState label={t('workbench.loadingChanges')} />}><ChangesPanel workspaceId={snapshot.thread.workspaceId} rootPath={root} onSendComments={onSendToConversation ? text => { onSendToConversation(text); return true } : undefined} /></Suspense></div>
      : panel === 'git' ? <div className="thread-review-body thread-tool-surface"><Suspense fallback={<LoadingState label={t('workbench.loadingGit')} />}><GitControlPanel workspaceId={snapshot.thread.workspaceId} rootPath={root} onOpenFile={openSearchFile} draft={() => threadCommitDraft(snapshot)} /></Suspense></div>
      : panel === 'files' ? <div className="thread-review-body thread-tool-surface">{scopedWorkspace ? <Suspense fallback={<LoadingState label={t('workbench.loadingFiles')} />}><EditorPane workspaceId={snapshot.thread.workspaceId} rootPath={root} /></Suspense> : unavailable}</div>
      : panel === 'search' ? <div className="thread-review-body thread-tool-surface">{scopedWorkspace ? <Suspense fallback={<LoadingState label={t('workbench.loadingSearch')} />}><SearchPanel workspace={scopedWorkspace} onOpenFile={openSearchFile} /></Suspense> : unavailable}</div>
      : panel === 'scripts' ? <div className="thread-review-body thread-tool-surface">{scopedWorkspace ? <Suspense fallback={<LoadingState label={t('workbench.loadingScripts')} />}><ScriptsPanel workspace={scopedWorkspace} embedded onClose={onClose} onOpenBackground={() => setPanel('background')} /></Suspense> : unavailable}</div>
      : panel === 'background' ? <div className="thread-review-body thread-tool-surface thread-background-surface"><section aria-label={t('workbench.nativeActivity')}><h3>{t('workbench.providerActivity', { count: subagents.filter(event => event.type === 'subagent' && event.state === 'running').length })}</h3>{subagents.map(event => event.type === 'subagent' && <ThreadSubagentActivity key={event.id} event={event} />)}{!subagents.length && <EmptyState compact title={t('workbench.noNativeTasks')} />}</section><Suspense fallback={<LoadingState label={t('workbench.loadingBackground')} />}><BackgroundJobsPanel workspaceId={snapshot.thread.workspaceId} /></Suspense></div>
      : panel === 'preview' ? <div className="thread-review-body thread-tool-surface">{scopedWorkspace ? <Suspense fallback={<LoadingState label={t('workbench.loadingPreview')} />}><WebPreviewPanel workspace={scopedWorkspace} threadId={id} embedded onClose={onClose} onRunCommand={() => {}} onSendToAgent={onSendToConversation} /></Suspense> : unavailable}</div>
      : <div className="thread-review-body thread-tool-surface thread-terminal-surface"><Suspense fallback={<LoadingState label={t('workbench.loadingTerminal')} />}><ThreadProjectTerminal key={id} thread={snapshot.thread} /></Suspense></div>}
  </aside>
}
