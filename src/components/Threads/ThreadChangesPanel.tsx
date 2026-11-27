import { Suspense, useId, useMemo, type KeyboardEvent } from 'react'
import { ChevronDown, ListTree, Maximize2, Minimize2, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { PreviewElementRef } from '../../../shared/types/design-mode'
import type { ThreadEvent, ThreadRequest, ThreadSnapshot } from '../../../shared/types/thread'
import type { Workspace } from '../../../shared/types/workspace'
import type { PreviewAttachment } from '../WebPreview/WebPreviewPanel'
import type { WorkbenchPanelId } from '../Workbench/panelCatalog'
import { threadPanelLabel } from './threadPanelLabels'
import { ThreadPlan } from './ThreadPlan'
import { ThreadRequestCard } from './ThreadRequestCard'
import { ThreadSubagentActivity } from './ThreadSubagentActivity'
import { useThreadWorkbenchStore, type ThreadPanel } from '../../store/thread-workbench.store'
import { useEditorStore } from '../../store/editor.store'
import { threadCommitDraft } from '../../../shared/threadCommitDraft'
import { Button, EmptyState, IconButton, LoadingState, Menu } from '../../ui'
import { threadWorkingRoot } from './threadChanges'
import { ThreadTurnReview } from './ThreadTurnReview'
import { ThreadSessionPanel } from './ThreadSessionPanel'
import { PlacesChanges } from './PlacesChanges'
import { placesBridge } from './placesModel'
import { THREAD_TOOL_PANELS } from './threadToolPanels'
import { lazyFrom } from '../../lib/chunk'
import { SHARED_PANEL_CHUNKS } from '../../lib/panelChunks'

const GitControlPanel = lazyFrom(SHARED_PANEL_CHUNKS.git, module => module.GitControlPanel)
const ChangesPanel = lazyFrom(SHARED_PANEL_CHUNKS.changes, module => module.ChangesPanel)
const EditorPane = lazyFrom(SHARED_PANEL_CHUNKS.files, module => module.EditorPane)
const SearchPanel = lazyFrom(SHARED_PANEL_CHUNKS.search, module => module.SearchPanel)
const BackgroundJobsPanel = lazyFrom(SHARED_PANEL_CHUNKS.background, module => module.BackgroundJobsPanel)
const WebPreviewPanel = lazyFrom(SHARED_PANEL_CHUNKS.webPreview, module => module.WebPreviewPanel)
const ThreadProjectTerminal = lazyFrom(SHARED_PANEL_CHUNKS.threadTerminal, module => module.ThreadProjectTerminal)
/** Thread panels named as everywhere else (src/components/Workbench/panelCatalog.ts). */
const ThreadNetworkPanel = lazyFrom(SHARED_PANEL_CHUNKS.threadNetwork, module => module.ThreadNetworkPanel)
const AndroidPanel = lazyFrom(SHARED_PANEL_CHUNKS.android, module => module.AndroidPanel)
/** The conversation's Queries and Containers, which main lists as its tool tabs (OXC-4: from Mais painéis, no tab row). */
const ActivityPanel = lazyFrom(SHARED_PANEL_CHUNKS.activity, module => module.ActivityPanel)
const ContainersPanel = lazyFrom(SHARED_PANEL_CHUNKS.containers, module => module.ContainersPanel)

const PANEL_ID: Partial<Record<ThreadPanel, WorkbenchPanelId>> = {
  session: 'session', changes: 'changes', git: 'git', files: 'files', search: 'search',
  background: 'background', preview: 'browser', terminal: 'terminal', network: 'httpCalls',
  android: 'android', queries: 'queries', containers: 'containers'
}

const AUX_TABS: ReadonlyArray<{ panel: ThreadPanel; key: 'changes' | 'plan' | 'preview' | 'terminal' | 'requests' }> = [
  { panel: 'changes', key: 'changes' },
  { panel: 'plan', key: 'plan' },
  { panel: 'preview', key: 'preview' },
  { panel: 'terminal', key: 'terminal' },
  { panel: 'requests', key: 'requests' }
]

const AUX_TAB_SET = new Set<ThreadPanel>(AUX_TABS.map(tab => tab.panel))

function collectRequests(snapshot: ThreadSnapshot): ThreadRequest[] {
  const byId = new Map<string, ThreadRequest>()
  for (const req of snapshot.pendingRequests ?? []) byId.set(req.id, req)
  const resolved = new Map<string, Extract<ThreadEvent, { type: 'request-resolved' }>>()
  for (const event of snapshot.events) {
    if (event.type === 'request-resolved') resolved.set(event.id, event)
  }
  for (const event of snapshot.events) {
    if (event.type !== 'request') continue
    if (byId.has(event.request.id)) continue
    const outcome = resolved.get(event.request.id) ?? resolved.get(event.id)
    byId.set(event.request.id, outcome ? { ...event.request, state: outcome.state, resolution: outcome.resolution, resolvedAt: outcome.resolvedAt } : event.request)
  }
  return [...byId.values()].sort((a, b) => Number(b.state === 'pending') - Number(a.state === 'pending') || b.createdAt - a.createdAt)
}

export function ThreadChangesPanel({ snapshot, workspace, panel, onClose, onSendToConversation, onCompact, maximized = false, onToggleMaximized }: { snapshot: ThreadSnapshot; workspace?: Workspace; panel: ThreadPanel; onClose(): void; onSendToConversation?(prompt: string, extra?: { images?: PreviewAttachment[]; elements?: PreviewElementRef[] }): void | boolean | Promise<void | boolean>; /** Runs /compact in the conversation; without it the session panel offers no Compact. */ onCompact?(): void; maximized?: boolean; onToggleMaximized?(): void }) {
  const { t } = useTranslation('thread')
  const tabBase = useId()
  const subagents = snapshot.events.filter(event => event.type === 'subagent')
  const latestPlan = useMemo(
    () => snapshot.events.filter((event): event is Extract<ThreadEvent, { type: 'plan' }> => event.type === 'plan').at(-1) ?? null,
    [snapshot.events]
  )
  const requests = useMemo(() => collectRequests(snapshot), [snapshot])
  const pendingRequestCount = useMemo(() => requests.filter(req => req.state === 'pending').length, [requests])
  const id = snapshot.thread.id
  const unavailable = <EmptyState compact title={t('workbench.unavailable')} />
  // Changes, Git, files and search follow the worktree the provider moved into, when it reported one.
  const root = threadWorkingRoot(snapshot.thread)
  const setPanel = (value: ThreadPanel) => { useThreadWorkbenchStore.getState().setView(id, { panel: value }) }
  const turnId = useThreadWorkbenchStore(state => state.views[id]?.turnId)
  // U4.1: with main's places bridge, Changes groups the conversation's changes by place; without it, the project diff.
  const bridge = placesBridge()
  const hasPlaces = Boolean(bridge?.places && bridge.placeDiff)
  const turnIds = snapshot.events.flatMap(event => event.type === 'turn-diff' ? [event.turnId] : [])
  const lastTurnId = turnIds.length ? turnIds[turnIds.length - 1] : undefined
  const scopedWorkspace = workspace ? { ...workspace, id: snapshot.thread.workspaceId, rootPath: root } : undefined
  const openSearchFile = (relativePath: string) => {
    void useEditorStore.getState().openFile({ workspaceId: snapshot.thread.workspaceId, rootPath: root, relativePath })
    useThreadWorkbenchStore.getState().setView(id, { panel: 'files' })
  }
  const currentLabel = panel === 'android' ? t('toolPanels.android')
    : panel === 'plan' ? t('panels.plan')
    : panel === 'requests' ? t('panels.requests')
    : threadPanelLabel(PANEL_ID[panel] ?? 'changes')
  const radioOptions = THREAD_TOOL_PANELS.some(item => item.panel === panel)
    ? THREAD_TOOL_PANELS.map(item => ({ value: item.panel, label: item.label }))
    : [{ value: panel, label: currentLabel }, ...THREAD_TOOL_PANELS.map(item => ({ value: item.panel, label: item.label }))]
  const activeIsPrimaryTab = AUX_TAB_SET.has(panel)
  const tabId = (tabPanel: ThreadPanel): string => `${tabBase}-aux-${tabPanel}`
  const onTabKeyDown = (event: KeyboardEvent<HTMLElement>, currentPanel: ThreadPanel) => {
    const index = AUX_TABS.findIndex(item => item.panel === currentPanel)
    if (index < 0) return
    let nextIndex = -1
    if (event.key === 'ArrowRight') nextIndex = (index + 1) % AUX_TABS.length
    else if (event.key === 'ArrowLeft') nextIndex = (index + AUX_TABS.length - 1) % AUX_TABS.length
    else if (event.key === 'Home') nextIndex = 0
    else if (event.key === 'End') nextIndex = AUX_TABS.length - 1
    if (nextIndex < 0) return
    event.preventDefault()
    const next = AUX_TABS[nextIndex].panel
    setPanel(next)
    document.getElementById(tabId(next))?.focus()
  }
  const planBadge = latestPlan ? `${latestPlan.steps.filter(step => step.status === 'completed').length}/${latestPlan.steps.length}` : undefined
  const requestsBadge = pendingRequestCount > 0 ? String(pendingRequestCount) : undefined
  return <aside className="thread-review-panel" aria-label={t('workbench.label')}>
    <header className="thread-review-heading">
      <div className="thread-aux-tabs" role="tablist" data-ui="aux-tabs" aria-label={t('workbench.tabs.label')}>
        {AUX_TABS.map((tab, index) => {
          const selected = panel === tab.panel
          const count = tab.panel === 'plan' ? planBadge : tab.panel === 'requests' ? requestsBadge : undefined
          return <Button
            key={tab.panel}
            id={tabId(tab.panel)}
            variant="ghost"
            size="sm"
            role="tab"
            className="thread-aux-tab"
            aria-selected={selected}
            tabIndex={selected || (!activeIsPrimaryTab && index === 0) ? 0 : -1}
            data-panel={tab.panel}
            onClick={() => setPanel(tab.panel)}
            onKeyDown={event => onTabKeyDown(event, tab.panel)}
          >
            <span>{t(`workbench.tabs.${tab.key}`)}</span>
            {count && <span className="thread-aux-tab-count">{count}</span>}
          </Button>
        })}
      </div>
      <div className="thread-aux-actions">
        <div className="thread-review-menu"><Menu label={t('workbench.panels')} items={[{ type: 'radio', value: panel, onValueChange: value => setPanel(value as ThreadPanel), options: radioOptions }]}
          trigger={<Button variant="ghost" size="sm" aria-label={t('workbench.select', { panel: currentLabel })}><ListTree size={14} aria-hidden="true" />{!activeIsPrimaryTab && <span>{currentLabel}</span>}<ChevronDown size={12} aria-hidden="true" /></Button>} /></div>
        {onToggleMaximized && <IconButton size="sm" label={maximized ? t('workbench.restore') : t('workbench.maximize')} aria-pressed={maximized} title={maximized ? t('workbench.restoreTitle') : t('workbench.maximizeTitle')} icon={maximized ? <Minimize2 size={14} aria-hidden="true" /> : <Maximize2 size={14} aria-hidden="true" />} onClick={onToggleMaximized} />}
        <IconButton size="sm" label={t('workbench.close')} title={t('common.close')} icon={<X size={14} aria-hidden="true" />} onClick={onClose} />
      </div>
    </header>
    {panel === 'session' ? <div className="thread-review-body thread-tool-surface"><ThreadSessionPanel snapshot={snapshot} workspace={workspace} running={snapshot.thread.status === 'running' || snapshot.thread.status === 'approval'} onOpenPanel={setPanel} onCompact={onCompact} /></div>
      : panel === 'plan' ? <div className="thread-review-body thread-aux-body" role="tabpanel" aria-labelledby={tabId('plan')}>{latestPlan ? <ThreadPlan event={latestPlan} /> : <EmptyState compact title={t('workbench.tabs.noPlan')} />}</div>
      : panel === 'requests' ? <div className="thread-review-body thread-aux-body thread-aux-requests" role="tabpanel" aria-labelledby={tabId('requests')}>{requests.length ? requests.map(req => <ThreadRequestCard key={req.id} request={req} agent={snapshot.thread.provider} conversationId={id} disabled={req.state !== 'pending'} onRespond={async response => { await window.oxe?.thread?.respond?.(id, req.id, response) }} />) : <EmptyState compact title={t('workbench.tabs.noRequests')} />}</div>
      : panel === 'changes' && turnId ? <div className="thread-review-body thread-tool-surface" role="tabpanel" aria-labelledby={tabId('changes')}><ThreadTurnReview key={turnId} snapshot={snapshot} turnId={turnId} onShowAll={() => useThreadWorkbenchStore.getState().setView(id, { panel: 'changes', turnId: undefined })} onComment={text => onSendToConversation?.(text)} /></div>
      : panel === 'changes' && hasPlaces ? <div className="thread-review-body thread-tool-surface" role="tabpanel" aria-labelledby={tabId('changes')}><PlacesChanges threadId={id} workspaceId={snapshot.thread.workspaceId} onSend={onSendToConversation} onByTurn={lastTurnId ? () => useThreadWorkbenchStore.getState().setView(id, { panel: 'changes', turnId: lastTurnId }) : undefined} /></div>
      : panel === 'changes' ? <div className="thread-review-body thread-tool-surface" role="tabpanel" aria-labelledby={tabId('changes')}><Suspense fallback={<LoadingState label={t('workbench.loadingChanges')} />}><ChangesPanel workspaceId={snapshot.thread.workspaceId} rootPath={root} threadId={snapshot.thread.id} currentProvider={snapshot.thread.provider} onSendComments={onSendToConversation ? async text => (await onSendToConversation(text)) !== false : undefined} /></Suspense></div>
      : panel === 'git' ? <div className="thread-review-body thread-tool-surface"><Suspense fallback={<LoadingState label={t('workbench.loadingGit')} />}><GitControlPanel workspaceId={snapshot.thread.workspaceId} rootPath={root} onOpenFile={openSearchFile} draft={() => threadCommitDraft(snapshot)} /></Suspense></div>
      : panel === 'files' ? <div className="thread-review-body thread-tool-surface">{scopedWorkspace ? <Suspense fallback={<LoadingState label={t('workbench.loadingFiles')} />}><EditorPane workspaceId={snapshot.thread.workspaceId} rootPath={root} /></Suspense> : unavailable}</div>
      : panel === 'search' ? <div className="thread-review-body thread-tool-surface">{scopedWorkspace ? <Suspense fallback={<LoadingState label={t('workbench.loadingSearch')} />}><SearchPanel workspace={scopedWorkspace} onOpenFile={openSearchFile} /></Suspense> : unavailable}</div>
      : panel === 'background' ? <div className="thread-review-body thread-tool-surface thread-background-surface"><section aria-label={t('workbench.nativeActivity')}><h3>{t('workbench.providerActivity', { count: subagents.filter(event => event.type === 'subagent' && event.state === 'running').length })}</h3>{subagents.map(event => event.type === 'subagent' && <ThreadSubagentActivity key={event.id} event={event} />)}{!subagents.length && <EmptyState compact title={t('workbench.noNativeTasks')} />}</section><Suspense fallback={<LoadingState label={t('workbench.loadingBackground')} />}><BackgroundJobsPanel workspaceId={snapshot.thread.workspaceId} /></Suspense></div>
      : panel === 'preview' ? <div className="thread-review-body thread-tool-surface" role="tabpanel" aria-labelledby={tabId('preview')}>{scopedWorkspace ? <Suspense fallback={<LoadingState label={t('workbench.loadingPreview')} />}><WebPreviewPanel workspace={scopedWorkspace} threadId={id} embedded onClose={onClose} onRunCommand={() => {}} onSendToAgent={onSendToConversation ? prompt => { void onSendToConversation(prompt) } : undefined} onOpenFile={openSearchFile} /></Suspense> : unavailable}</div>
      : panel === 'network' ? <div className="thread-review-body thread-tool-surface"><Suspense fallback={<LoadingState label={t('workbench.loadingNetwork')} />}><ThreadNetworkPanel threadId={id} workspaceId={snapshot.thread.workspaceId} /></Suspense></div>
      : panel === 'android' ? <div className="thread-review-body thread-tool-surface"><Suspense fallback={<LoadingState label={t('workbench.loadingAndroid')} />}><AndroidPanel /></Suspense></div>
      : panel === 'queries' ? <div className="thread-review-body thread-tool-surface"><Suspense fallback={null}><ActivityPanel active scope="database" /></Suspense></div>
      : panel === 'containers' ? <div className="thread-review-body thread-tool-surface"><Suspense fallback={null}><ContainersPanel /></Suspense></div>
      : <div className="thread-review-body thread-tool-surface thread-terminal-surface" role="tabpanel" aria-labelledby={tabId('terminal')}><Suspense fallback={<LoadingState label={t('workbench.loadingTerminal')} />}><ThreadProjectTerminal key={id} thread={snapshot.thread} /></Suspense></div>}
  </aside>
}
