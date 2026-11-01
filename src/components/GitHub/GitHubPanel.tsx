import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from 'react'
import { AlertTriangle, ArrowDownToLine, ArrowLeft, ArrowUpFromLine, CheckCircle2, ChevronDown, ChevronRight, CircleDot, Clock, Copy, Download, ExternalLink, GitCompareArrows, GitBranch, GitPullRequest, Link2, Minus, Play, Plus, RefreshCw, Tag, Terminal, TrendingUp } from 'lucide-react'
import { Github } from '../Brand/GithubIcon'; import { openExternalLink } from '../../lib/externalLinks'; import { ExternalAnchor } from '../ExternalLinks/ExternalAnchor'
import { openInChanges } from '../../store/changes-request.store'
import { WORKBENCH_PANELS } from '../Workbench/panelCatalog'
import { copyText, Button, Checkbox, TextField, TextArea, Select, EmptyState, ErrorState, LoadingState } from '../../ui'
import { useTranslation } from 'react-i18next'
import { i18n } from '../../i18n'
import type { GitHubBranch, GitHubCliStatus, GitHubCommit, GitHubCommitDetails, GitHubConnectedRepository, GitHubFileChange, GitHubPanelTab, GitHubPullRequest, GitHubRelease, GitHubWorkflow, GitHubWorkflowJob, GitHubWorkflowRun, GitHubWorkflowRunDetails, GitHubWorkspaceStatus } from '../../../shared/types/github'
import { selectGitHubWorkspace, useGitHubStore } from '../../store/github.store'
import { useWorkspaceStore } from '../../store/workspace.store'
import { useEditorStore } from '../../store/editor.store'
import { useResolvedTerminalPrefs } from '../../store/terminal-prefs.store'
import { TerminalView } from '../Terminal/TerminalView'
import { GITHUB_PANEL_TABS as TABS, buildStatusHeadline, describeSyncState } from './githubPanelModel'
import { humanizeError } from '../../utils/humanizeError'
import { RichText } from '../../i18n/RichText'
import { formatDateTime, formatRelative } from '../../utils/formatTime'
export { buildStatusHeadline, describeSyncState } from './githubPanelModel'

/** The code catalog in the language on screen; the panel re-renders on a language change through its root's useTranslation. */
const tc = i18n.getFixedT(null, 'code')

interface GitHubPanelProps {
  workspaceId: string
  rootPath: string
  activeTab: GitHubPanelTab
  onTabChange: (tab: GitHubPanelTab) => void
  onOpenFile?: (path: string) => void
  onRunCommand?: (command: string) => void
}

interface ConfirmAction {
  title: string
  detail: string
  run: () => Promise<void>
}

export function GitHubPanel({ activeTab: propTab, onOpenFile, onRunCommand, onTabChange, rootPath, workspaceId }: GitHubPanelProps): ReactElement {
  useTranslation('code')
  const selector = useMemo(() => selectGitHubWorkspace(workspaceId), [workspaceId])
  const state = useGitHubStore(selector)
  const input = useMemo(() => ({ workspaceId, rootPath }), [workspaceId, rootPath])
  const [confirmAction, setConfirmAction] = useState<ConfirmAction | null>(null)
  const [pendingCommand, setPendingCommand] = useState<string | null>(null)
  const [activeTab, setActiveTab] = useState<GitHubPanelTab>(propTab)

  // Sync local tab when the persisted value changes (e.g., workspace switch)
  useEffect(() => { setActiveTab(propTab) }, [propTab])

  // The panel follows the active pane, so `rootPath` can change while
  // `workspaceId` stays put. Everything cached below is keyed by workspace,
  // which means it now describes the wrong directory. Declared above the load
  // effects so React runs it first: clear, then fetch.
  const loadedRootPath = useRef(rootPath)
  useEffect(() => {
    if (loadedRootPath.current === rootPath) return
    loadedRootPath.current = rootPath
    useGitHubStore.getState().resetWorkspace(workspaceId)
  }, [rootPath, workspaceId])

  // Prefetch cheap tabs in background once when the panel opens.
  // Network-bound tabs (prs, releases) are NOT included — they only fetch on demand.
  useEffect(() => {
    void useGitHubStore.getState().prefetchOnOpen(input)
  }, [input])

  useEffect(() => {
    void useGitHubStore.getState().loadTab(input, activeTab)
  }, [activeTab, input])

  const handleTabChange = (tab: GitHubPanelTab): void => {
    setActiveTab(tab)   // immediate visual update
    onTabChange(tab)    // async persistence to DB
  }

  const status = state.status
  const cli = status?.cli ?? null
  const tabMeta = TABS.find((t) => t.id === activeTab)
  const blocked = status !== null && (tabMeta?.remote === true) && (!cli?.available || !cli.authenticated)
  const hasTabData = state.loadedTabs[activeTab] === true
  const showSkeleton = state.loading && !hasTabData && !blocked

  const requestConfirm = (title: string, detail: string, run: () => Promise<void>): void => setConfirmAction({ title, detail, run })

  const openChangedFile = (path: string): void => {
    if (onOpenFile) { onOpenFile(path); return }
    const workspace = useWorkspaceStore.getState().workspaces.find((item) => item.id === workspaceId)
    if (!workspace) return
    void useWorkspaceStore.getState().updateEditorState({
      workspaceId,
      editorVisible: true,
      editorExpanded: false,
      editorWidthPercent: workspace.editorWidthPercent ?? 48
    })
    void useEditorStore.getState().openFile({ workspaceId, rootPath, relativePath: path })
  }

  const runCommand = (command: string): void => onRunCommand ? onRunCommand(command) : setPendingCommand(command)
  const loadWorkflowRunDetails = useCallback(
    (runId: number) => useGitHubStore.getState().loadWorkflowRunDetails({ ...input, runId }),
    [input]
  )

  return (
    <section className="github-panel">
      <nav className="github-tabs" aria-label={tc('github.tabs')}>
        {TABS.map((tab) => (
          <button key={tab.id} type="button" className={activeTab === tab.id ? 'github-tab active' : 'github-tab'} onClick={() => handleTabChange(tab.id)}>
            {tab.label}
          </button>
        ))}
        {state.refreshing && !state.loading ? (
          <span className="github-refreshing" aria-live="polite">
            <RefreshCw size={12} className="github-refreshing-spin" aria-hidden="true" />
            {tc('github.refreshing')}
          </span>
        ) : null}
      </nav>

      {state.error && !blocked ? <ErrorState compact title={tc('github.failed')} message={state.error} /> : null}
      {state.lastMessage ? <div className="github-message"><CheckCircle2 size={14} aria-hidden="true" />{state.lastMessage}</div> : null}

      <div className="github-panel-body">
        {blocked ? (
          <GitHubCliSetup cli={cli} onRunCommand={runCommand} />
        ) : showSkeleton ? (
          <GitHubTabSkeleton tab={activeTab} />
        ) : (
          <>
            {activeTab === 'status' && (
              <StatusTab
                loading={state.loading}
                status={status}
                onFetch={() => void useGitHubStore.getState().fetch(input)}
                onPullFfOnly={() => requestConfirm(
                  tc('github.confirm.pull'),
                  status?.behind ? tc('github.confirm.pullCount', { count: status.behind }) : tc('github.confirm.pullAny'),
                  () => useGitHubStore.getState().pullFfOnly(input)
                )}
                onPush={() => requestConfirm(
                  tc('github.confirm.push'),
                  status?.ahead ? tc('github.confirm.pushCount', { count: status.ahead }) : tc('github.confirm.pushAny'),
                  () => useGitHubStore.getState().push(input)
                )}
                onStageAll={() => requestConfirm(tc('github.confirm.stageAll'), buildStageAllPreview(status), () => useGitHubStore.getState().stageAll(input))}
                onStageFile={(path) => void useGitHubStore.getState().stageFile({ ...input, path })}
                onUnstageFile={(path) => void useGitHubStore.getState().unstageFile({ ...input, path })}
                onCommit={(msg) => requestConfirm(tc('github.confirm.commit'), msg, () => useGitHubStore.getState().commit({ ...input, message: msg }))}
                onGenerateMessage={() => useGitHubStore.getState().generateCommitMessage(input)}
                onOpenFile={openChangedFile}
                onRefresh={() => void useGitHubStore.getState().loadTab(input, 'status')}
              />
            )}
            {activeTab === 'checkpoints' && (
              <CheckpointsTab
                checkpoints={state.checkpoints}
                loading={state.loading}
                onCreate={(name, description) => requestConfirm(tc('github.confirm.createCheckpoint'), name, () => useGitHubStore.getState().createCheckpoint({ ...input, name, description }))}
                onRestore={(id, name) => requestConfirm(tc('github.confirm.restoreCheckpoint'), name, () => useGitHubStore.getState().restoreCheckpoint({ ...input, checkpointId: id }))}
                onDelete={(id, name) => requestConfirm(tc('github.confirm.deleteCheckpoint'), name, () => useGitHubStore.getState().deleteCheckpoint(workspaceId, id))}
                onRefresh={() => void useGitHubStore.getState().loadTab(input, 'checkpoints')}
              />
            )}
            {activeTab === 'repos' && (
              <ReposTab
                connectedRepositories={state.connectedRepositories}
                rootPath={rootPath}
                workspaceId={workspaceId}
                status={status}
                onOpenFile={openChangedFile}
                onConnect={(fullName) => requestConfirm(tc('github.confirm.connect'), fullName, () => useGitHubStore.getState().connectRepository({ ...input, fullName }))}
                onPush={() => requestConfirm(tc('github.confirm.pushGitHub'), tc('github.confirm.pushAny'), () => useGitHubStore.getState().push(input))}
                onRefresh={() => void useGitHubStore.getState().loadTab(input, 'repos')}
              />
            )}
            {activeTab === 'branches' && (
              <BranchesTab
                branches={state.branches}
                status={status}
                onCheckout={(name) => requestConfirm(tc('github.confirm.checkout'), name, () => useGitHubStore.getState().checkoutBranch({ ...input, name }))}
                onCreate={(name) => requestConfirm(tc('github.confirm.createBranch'), name, () => useGitHubStore.getState().createBranch({ ...input, name, checkout: true }))}
                onRefresh={() => void useGitHubStore.getState().loadTab(input, 'branches')}
              />
            )}
            {activeTab === 'prs' && (
              <PullRequestsTab
                prs={state.pullRequests}
                status={status}
                loading={state.loading}
                input={input}
                onCreate={(title, body) => requestConfirm(tc('github.confirm.createPr'), title, () => useGitHubStore.getState().createPullRequest({ ...input, title, body }))}
                onRefresh={() => void useGitHubStore.getState().loadTab(input, 'prs')}
              />
            )}
            {activeTab === 'commits' && (
              <CommitsTab
                commitDetails={state.commitDetails}
                commits={state.commits}
                loading={state.loading}
                status={status}
                onLoadDetails={(oid) => useGitHubStore.getState().loadCommitDetails({ ...input, oid })}
                onRefresh={() => void useGitHubStore.getState().loadTab(input, 'commits')}
              />
            )}
            {activeTab === 'releases' && (
              <ReleasesTab
                releases={state.releases}
                status={status}
                loading={state.loading}
                onCreate={(release) => requestConfirm(tc('github.confirm.createRelease'), release.tagName, () => useGitHubStore.getState().createRelease({ ...input, ...release }))}
                onRefresh={() => void useGitHubStore.getState().loadTab(input, 'releases')}
              />
            )}
            {activeTab === 'actions' && (
              <ActionsTab
                workflows={state.workflows}
                workflowRuns={state.workflowRuns}
                workflowRunDetails={state.workflowRunDetails}
                loading={state.loading}
                workspaceId={workspaceId}
                rootPath={rootPath}
                onLoadRunDetails={loadWorkflowRunDetails}
                onRun={(workflowId, ref, fields) => requestConfirm(tc('github.confirm.runWorkflow'), workflowId, () => useGitHubStore.getState().runWorkflow({ ...input, workflowId, ref, fields }))}
                onRerun={(runId, failedOnly) => requestConfirm(failedOnly ? tc('github.confirm.rerunFailed') : tc('github.confirm.rerun'), tc('github.actions.runNumber', { id: runId }), () => useGitHubStore.getState().rerunRun({ ...input, runId, failedOnly }))}
                onRefresh={() => void useGitHubStore.getState().loadTab(input, 'actions')}
              />
            )}
            {activeTab === 'settings' && (
              <SettingsTab
                status={status}
                rootPath={rootPath}
                connectedRepositories={state.connectedRepositories}
                onRunCommand={runCommand}
                onRefresh={() => void useGitHubStore.getState().loadTab(input, 'settings')}
              />
            )}
          </>
        )}
      </div>

      {pendingCommand ? (
        <GitHubEmbeddedTerminal
          workspaceId={workspaceId}
          command={pendingCommand}
          onDismiss={() => setPendingCommand(null)}
        />
      ) : null}

      {confirmAction ? (
        <div className="github-confirm-bar">
          <div>
            <strong>{confirmAction.title}</strong>
            <span>{confirmAction.detail}</span>
          </div>
          <Button variant="ghost" onClick={() => setConfirmAction(null)}>{tc('github.cancel')}</Button>
          <Button variant="primary" disabled={state.loading} onClick={() => { const c = confirmAction; setConfirmAction(null); void c.run() }}>{tc('github.confirmAction')}</Button>
        </div>
      ) : null}
    </section>
  )
}

// ─── Status ────────────────────────────────────────────────────────────────

function StatusTab({ loading, status, onFetch, onPullFfOnly, onPush, onStageAll, onStageFile, onUnstageFile, onCommit, onGenerateMessage, onOpenFile, onRefresh }: {
  loading: boolean
  status: GitHubWorkspaceStatus | null
  onFetch: () => void
  onPullFfOnly: () => void
  onPush: () => void
  onStageAll: () => void
  onStageFile: (path: string) => void
  onUnstageFile: (path: string) => void
  onCommit: (msg: string) => void
  onGenerateMessage: () => Promise<string>
  onOpenFile: (path: string) => void
  onRefresh: () => void
}): ReactElement {
  const [message, setMessage] = useState('')
  const [autoGenerate, setAutoGenerate] = useState(false)
  const [generating, setGenerating] = useState(false)
  const commitMessage = message.trim()
  const totalFiles = (status?.staged ?? 0) + (status?.modified ?? 0) + (status?.untracked ?? 0)
  const changes = status?.changes ?? []
  const stagedChanges = changes.filter((change) => change.staged)
  const unstagedChanges = changes.filter((change) => change.unstaged)
  const ahead = status?.ahead ?? 0
  const behind = status?.behind ?? 0
  const dirty = status?.hasUncommittedChanges === true
  const hasRemote = Boolean(status?.repository?.remoteUrl || status?.lastPushRelative)
  const canPull = behind > 0 && !dirty && !loading
  const canPush = ahead > 0 && !loading
  const sync = describeSyncState({ ahead, behind, dirty, hasRemote, totalFiles })
  const headline = buildStatusHeadline({ ahead, behind, dirty, totalFiles, hasRemote })

  const pullTitle = behind <= 0 ? tc('github.status.nothingToPull') : dirty ? tc('github.status.pullBlocked') : tc('github.status.pullTitle', { count: behind })
  const pushTitle = ahead <= 0 ? tc('github.status.nothingToPush') : tc('github.confirm.pushCount', { count: ahead })

  const handleAutoGenerate = async (checked: boolean): Promise<void> => {
    setAutoGenerate(checked)
    if (!checked) return
    setGenerating(true)
    try {
      const msg = await onGenerateMessage()
      setMessage(msg)
    } catch {
      setAutoGenerate(false)
    } finally {
      setGenerating(false)
    }
  }

  return (
    <div className="github-tab-layout">
      <div className="github-tab-scroll">
        <div className="github-tab-header">
          <div className="github-tab-header-title">
            <GitBranch size={14} aria-hidden="true" />
            <span>{status?.branch ?? tc('github.noBranch')}</span>
          </div>
          <div className="github-tab-header-actions">
            <Button
             
              variant="ghost" size="sm" square
              title={tc('github.status.refreshTitle')}
              aria-label={tc('github.status.refresh')}
              data-testid="github-status-refresh"
              disabled={loading}
              onClick={onRefresh}
            >
              <RefreshCw size={14} aria-hidden="true" />
            </Button>
          </div>
        </div>
        <div className="github-tab-sep" />

        {sync.kind !== 'no-remote' && <p className="github-status-headline" data-testid="github-status-headline">{headline}</p>}

        {/* Sync block — primary, VS Code-like: what to do with the remote */}
        <section
          className={`github-sync-card state-${sync.kind}`}
          data-testid="github-sync-banner"
          aria-live="polite"
        >
          <div className="github-sync-card-main">
            <span className={`github-sync-icon state-${sync.kind}`} aria-hidden="true">
              {sync.kind === 'behind' || sync.kind === 'diverged' ? <ArrowDownToLine size={16} />
                : sync.kind === 'ahead' ? <ArrowUpFromLine size={16} />
                  : sync.kind === 'dirty-behind' ? <AlertTriangle size={16} />
                    : sync.kind === 'no-remote' ? <AlertTriangle size={16} />
                      : <CheckCircle2 size={16} />}
            </span>
            <div className="github-sync-copy">
              <strong data-testid="github-sync-title">{sync.title}</strong>
              <span data-testid="github-sync-detail">{sync.detail}</span>
              {(ahead > 0 || behind > 0) ? (
                <div className="github-sync-pills" aria-label={tc('github.status.vsRemote')}>
                  <span className={`github-sync-pill${ahead > 0 ? ' active up' : ''}`} title={tc('github.status.outgoingTitle')}>
                    <ArrowUpFromLine size={12} aria-hidden="true" />
                    {tc('github.status.outgoing', { count: ahead })}
                  </span>
                  <span className={`github-sync-pill${behind > 0 ? ' active down' : ''}`} title={tc('github.status.incomingTitle')}>
                    <ArrowDownToLine size={12} aria-hidden="true" />
                    {tc('github.status.incoming', { count: behind })}
                  </span>
                </div>
              ) : null}
            </div>
          </div>
          {hasRemote && <div className="github-sync-actions">
            <Button
              variant="secondary"
              size="sm"
              data-testid="github-status-fetch"
              disabled={loading || !status?.isGitRepository || !hasRemote}
              title={tc('github.status.fetchTitle')}
              onClick={onFetch}
            >
              <Download size={14} aria-hidden="true" />
              {tc('github.status.fetch')}
            </Button>
            <Button
              variant={behind > 0 && !dirty ? 'primary' : 'secondary'}
              size="sm"
              data-testid="github-status-update"
              disabled={!canPull}
              title={pullTitle}
              onClick={onPullFfOnly}
            >
              <ArrowDownToLine size={14} aria-hidden="true" />
              {tc('github.status.pull')}{behind > 0 ? ` ${behind}` : ''}
            </Button>
            <Button
              variant={ahead > 0 && behind === 0 ? 'primary' : 'secondary'}
              size="sm"
              data-testid="github-status-push"
              disabled={!canPush}
              title={pushTitle}
              onClick={onPush}
            >
              <ArrowUpFromLine size={14} aria-hidden="true" />
              {tc('github.status.push')}{ahead > 0 ? ` ${ahead}` : ''}
            </Button>
          </div>}
          {sync.kind === 'dirty-behind' ? (
            <div className="github-sync-callout" data-testid="github-dirty-behind-callout" role="status">
              <AlertTriangle size={14} aria-hidden="true" />
              <span>{tc('github.status.dirtyBlocksPull')}</span>
            </div>
          ) : null}
          {sync.kind === 'no-remote' ? (
            <div className="github-sync-callout" data-testid="github-no-remote-callout" role="status">
              <AlertTriangle size={14} aria-hidden="true" />
              <span><RichText text={tc('github.status.addRemote')} /></span>
            </div>
          ) : null}
        </section>

        {/* Local working tree — secondary, like VS Code "Changes" */}
        <section className="github-changes-card" data-testid="github-changes-card">
          <div className="github-changes-header">
            <CircleDot size={14} aria-hidden="true" />
            <strong>{tc('github.status.changes')}</strong>
            <span className={`github-changes-total${totalFiles > 0 ? ' has-changes' : ''}`}>
              {totalFiles === 0 ? tc('github.status.noChanges') : tc('github.status.files', { count: totalFiles })}
            </span>
          </div>
          <div className="github-changes-rows" aria-label={tc('changes.files')}>
            {stagedChanges.length > 0 ? (
              <GitChangeGroup
                title={tc('github.status.staged')}
                changes={stagedChanges}
                action="unstage"
                disabled={loading}
                onAction={onUnstageFile}
                onOpenFile={onOpenFile}
              />
            ) : null}
            {unstagedChanges.length > 0 ? (
              <GitChangeGroup
                title={tc('github.status.changes')}
                changes={unstagedChanges}
                action="stage"
                disabled={loading}
                onAction={onStageFile}
                onOpenFile={onOpenFile}
              />
            ) : null}
            {changes.length === 0 ? <EmptyState compact title={tc('git.control.clean')} /> : null}
          </div>
          <div className="github-changes-meta">
            <span>{tc('github.status.lastCommit', { when: status?.lastCommitRelative ?? '—' })}</span>
            <span>·</span>
            <span>{tc('github.status.upstream', { when: status?.lastPushRelative ?? tc('github.status.notSet') })}</span>
          </div>
        </section>
      </div>
      {(unstagedChanges.length > 0 || stagedChanges.length > 0) && <div className="github-status-footer">
        {unstagedChanges.length > 0 && <Button variant="ghost" size="sm" disabled={loading} onClick={onStageAll}>
          {tc('github.status.stageAll', { count: unstagedChanges.length })}
        </Button>}
        {stagedChanges.length > 0 && <>
          <label className="github-auto-row">
            <input type="checkbox" checked={autoGenerate} disabled={generating || loading} onChange={(e) => void handleAutoGenerate(e.target.checked)} />
            <span>{tc('github.status.autoMessage')}</span>
          </label>
          <textarea className="github-commit-ta" aria-label={tc('git.control.message')} value={message} placeholder={tc('git.control.messagePlaceholder')} onChange={(e) => setMessage(e.target.value)} />
          <Button variant="primary" className="github-block-btn" disabled={loading || !commitMessage} onClick={() => onCommit(commitMessage)}>
            {tc('git.control.commit', { count: stagedChanges.length })}
          </Button>
        </>}
      </div>}
    </div>
  )
}

function GitChangeGroup({ action, changes, disabled, onAction, onOpenFile, title }: {
  action: 'stage' | 'unstage'
  changes: GitHubFileChange[]
  disabled: boolean
  onAction: (path: string) => void
  onOpenFile: (path: string) => void
  title: string
}): ReactElement {
  return (
    <section className="github-change-group">
      <header className="github-change-group-header">
        <span>{title}</span>
        <span>{changes.length}</span>
      </header>
      {changes.map((change) => {
        const slash = Math.max(change.path.lastIndexOf('/'), change.path.lastIndexOf('\\'))
        const name = slash >= 0 ? change.path.slice(slash + 1) : change.path
        const directory = slash >= 0 ? change.path.slice(0, slash) : ''
        const statusCode = change.untracked ? 'U' : change.deleted ? 'D' : change.renamed ? 'R' : 'M'
        return (
          <div key={`${action}:${change.path}`} className="github-change-file" data-testid={`github-change-${action}`}>
            <button
              type="button"
              className="github-change-file-name"
              disabled={change.deleted}
              title={change.deleted ? tc('github.status.deleted', { path: change.path }) : tc('git.control.open', { path: change.path })}
              onClick={() => onOpenFile(change.path)}
            >
              <span>{name}</span>
              {directory ? <small>{directory}</small> : null}
            </button>
            <span className={`github-change-code status-${statusCode.toLowerCase()}`}>{statusCode}</span>
            <button
              type="button"
              className="github-change-action"
              disabled={disabled}
              aria-label={`${action === 'stage' ? tc('git.control.stage') : tc('git.control.unstage')} ${change.path}`}
              title={`${action === 'stage' ? tc('git.control.stage') : tc('git.control.unstage')} ${change.path}`}
              onClick={() => onAction(change.path)}
            >
              {action === 'stage' ? <Plus size={14} aria-hidden="true" /> : <Minus size={14} aria-hidden="true" />}
            </button>
          </div>
        )
      })}
    </section>
  )
}

// ─── Checkpoints ───────────────────────────────────────────────────────────

function CheckpointsTab({ checkpoints, loading, onCreate, onRestore, onDelete, onRefresh }: {
  checkpoints: Array<{ id: string; name: string; description: string | null; branch: string | null; createdAt: number }>
  loading: boolean
  onCreate: (name: string, description?: string) => void
  onRestore: (id: string, name: string) => void
  onDelete: (id: string, name: string) => void
  onRefresh: () => void
}): ReactElement {
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const trimmedName = name.trim()

  return (
    <div className="github-tab-layout">
      <div className="github-tab-scroll">
        <div className="github-tab-header">
          <div className="github-tab-header-title">
            <Clock size={14} aria-hidden="true" />
            <span>{tc('github.checkpoints.title', { count: checkpoints.length })}</span>
          </div>
          <Button variant="ghost" size="sm" square title={tc('github.refresh')} aria-label={tc('github.refresh')} onClick={onRefresh}><RefreshCw size={14} aria-hidden="true" /></Button>
        </div>
        <div className="github-tab-sep" />
        {checkpoints.length === 0 ? (
          <EmptyState icon={<Clock size={20} />} title={tc('github.checkpoints.none')}>{tc('github.checkpoints.noneHint')}</EmptyState>
        ) : (
          <div className="github-list">
            {checkpoints.map((cp) => (
              <div key={cp.id} className="github-list-row">
                <div className="github-list-row-main">
                  <strong>{cp.name}</strong>
                  <span>{cp.branch ?? tc('github.noBranch')} · {formatDate(cp.createdAt)}</span>
                  {cp.description ? <p>{cp.description}</p> : null}
                </div>
                <div className="github-list-row-actions">
                  <Button variant="ghost" onClick={() => onRestore(cp.id, cp.name)}>{tc('github.checkpoints.restore')}</Button>
                  <Button variant="ghost" onClick={() => onDelete(cp.id, cp.name)}>{tc('github.checkpoints.delete')}</Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
      <div className="github-checkpoints-footer">
        <TextField value={name} aria-label={tc('github.checkpoints.name')} placeholder={tc('github.checkpoints.namePlaceholder')} onChange={(e) => setName(e.target.value)} />
        <TextField value={description} aria-label={tc('github.checkpoints.description')} placeholder={tc('github.checkpoints.descriptionPlaceholder')} onChange={(e) => setDescription(e.target.value)} />
        <Button variant="primary" className="github-block-btn" disabled={loading || !trimmedName} onClick={() => { onCreate(trimmedName, description.trim() || undefined); setName(''); setDescription('') }}>
          {tc('github.checkpoints.create')}
        </Button>
      </div>
    </div>
  )
}

// ─── Repos ─────────────────────────────────────────────────────────────────

function ReposTab({ connectedRepositories, rootPath, workspaceId, status, onConnect, onPush, onRefresh, onOpenFile }: {
  onOpenFile: (path: string) => void
  rootPath: string
  workspaceId: string
  status: GitHubWorkspaceStatus | null
  connectedRepositories: GitHubConnectedRepository[]
  onConnect: (fullName: string) => void
  onPush: () => void
  onRefresh: () => void
}): ReactElement {
  const [connectInput, setConnectInput] = useState('')
  const [showConnectForm, setShowConnectForm] = useState(false)
  const repo = status?.repository
  const isGitRepo = status?.isGitRepository ?? false
  const branch = status?.branch

  return (
    <div className="github-tab-layout">
      <div className="github-tab-scroll">
        <div className="github-tab-header">
          <div className="github-tab-header-title"><span>{tc('github.repos.title')}</span></div>
          <Button variant="ghost" size="sm" square title={tc('github.refresh')} aria-label={tc('github.refresh')} onClick={onRefresh}><RefreshCw size={14} aria-hidden="true" /></Button>
        </div>
        <div className="github-tab-sep" />

        <div className="github-repo-dir-card">
          <span className="github-repo-dir-label">{tc('github.repos.directory')}</span>
          <span className="github-repo-dir-path">{rootPath}</span>
        </div>

        <div className="github-git-status-card">
          {isGitRepo ? (
            <>
              <div className="github-git-status-title">
                <span className="github-git-check">✓</span>
                <strong>{tc('github.repos.isGit')}</strong>
              </div>
              <div className="github-git-status-lines">
                {branch ? <span>{tc('github.repos.branch')} <strong className="github-cyan">{branch}</strong></span> : null}
                {!repo?.fullName && !repo?.remoteUrl ? <span className="github-amber">{tc('github.repos.noRemote')}</span> : null}
                {status?.hasUncommittedChanges ? <span className="github-amber">{tc('github.repos.uncommitted')}</span> : null}
              </div>
            </>
          ) : (
            <span className="github-muted">{tc('github.repos.notGit')}</span>
          )}
        </div>

        <Button variant="primary" className="github-block-btn" disabled={!isGitRepo || (!repo?.fullName && !repo?.remoteUrl)} onClick={onPush}>
          {tc('github.confirm.pushGitHub')}
        </Button>

        <GitignoreRow rootPath={rootPath} workspaceId={workspaceId} onOpenFile={onOpenFile} />

        <div className="github-connected-header">
          <span>{tc('github.repos.connected')}</span>
          <Button variant="ghost" size="sm" aria-expanded={showConnectForm} onClick={() => setShowConnectForm((v) => !v)}>{tc('github.repos.connectOpen')}</Button>
        </div>
        {showConnectForm ? (
          <div className="github-connect-form">
            <TextField value={connectInput} aria-label={tc('github.repos.repoName')} placeholder="owner/repo" onChange={(e) => setConnectInput(e.target.value)} />
            <Button variant="ghost" disabled={!/^[\w.-]+\/[\w.-]+$/.test(connectInput.trim())} onClick={() => { onConnect(connectInput.trim()); setConnectInput(''); setShowConnectForm(false) }}>{tc('github.repos.connect')}</Button>
          </div>
        ) : null}
        {connectedRepositories.length === 0 ? (
          <EmptyState compact title={tc('github.repos.noneConnected')} />
        ) : (
          <div className="github-list">
            {connectedRepositories.map((r) => (
              <div key={r.id} className="github-list-row">
                <div className="github-list-row-main">
                  <strong>{r.fullName}</strong>
                  {r.url ? <span>{r.url}</span> : null}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function GitignoreRow({ rootPath, workspaceId, onOpenFile }: { rootPath: string; workspaceId: string; onOpenFile: (path: string) => void }): ReactElement {
  const [info, setInfo] = useState<{ exists: boolean; lines: number } | null>(null)

  useEffect(() => {
    window.oxe.fs.readFile({ workspaceId, rootPath, relativePath: '.gitignore' }).then((result) => {
      const lines = result.content.split('\n').filter((l) => l.trim().length > 0).length
      setInfo({ exists: true, lines })
    }).catch(() => setInfo({ exists: false, lines: 0 }))
  }, [rootPath])

  if (!info) return <div className="github-gitignore-row"><span>.gitignore</span><span className="github-muted">{tc('github.repos.gitignoreLoading')}</span></div>

  return (
    <div className="github-gitignore-row">
      <span>.gitignore</span>
      {info.exists ? (
        <>
          <span className="github-gitignore-exists">{tc('github.repos.gitignoreExists')}</span>
          <div className="github-gitignore-right">
            <span className="github-muted">{tc('github.repos.lines', { count: info.lines })}</span>
            <Button variant="ghost" className="github-edit-btn" onClick={() => onOpenFile('.gitignore')}>{tc('github.repos.edit')}</Button>
          </div>
        </>
      ) : (
        <span className="github-muted">{tc('github.repos.gitignoreMissing')}</span>
      )}
    </div>
  )
}

// ─── Branches ──────────────────────────────────────────────────────────────

function BranchesTab({ branches, status, onCheckout, onCreate, onRefresh }: {
  branches: GitHubBranch[]
  status: GitHubWorkspaceStatus | null
  onCheckout: (name: string) => void
  onCreate: (name: string) => void
  onRefresh: () => void
}): ReactElement {
  const [newName, setNewName] = useState('')
  const [showCreate, setShowCreate] = useState(false)
  const repoName = status?.repository?.fullName
  const detected = status?.repository?.detected

  return (
    <div className="github-tab-layout">
      <div className="github-tab-scroll">
        <div className="github-tab-header">
          <div className="github-tab-header-title"><span>{tc('git.tabs.branches')}</span></div>
          <div className="github-tab-header-actions">
            <Button variant="ghost" size="sm" square title={tc('github.refresh')} aria-label={tc('github.refresh')} onClick={onRefresh}><RefreshCw size={14} aria-hidden="true" /></Button>
            <Button variant="secondary" size="sm" aria-expanded={showCreate} onClick={() => setShowCreate((v) => !v)}>{tc('github.branches.new')}</Button>
          </div>
        </div>
        <div className="github-tab-sep" />

        {repoName ? (
          <div className="github-repo-badge">
            <Link2 size={14} aria-hidden="true" />
            <span>{repoName}</span>
            {detected ? <span className="github-detected">{tc('github.detected')}</span> : null}
          </div>
        ) : null}

        {showCreate ? (
          <div className="github-connect-form">
            <TextField value={newName} aria-label={tc('worktree.create.branch')} placeholder="new-branch-name" autoFocus onChange={(e) => setNewName(e.target.value)} />
            <Button variant="ghost" disabled={!newName.trim()} onClick={() => { onCreate(newName.trim()); setNewName(''); setShowCreate(false) }}>{tc('github.create')}</Button>
            <Button variant="ghost" onClick={() => setShowCreate(false)}>{tc('github.cancel')}</Button>
          </div>
        ) : null}

        <div className="github-list">
          {branches.map((branch) => (
            <div key={`${branch.remote ? 'r' : 'l'}-${branch.name}`} className={`github-branch-row${branch.current ? ' current' : ''}`}>
              <div className="github-branch-left">
                <TrendingUp size={14} aria-hidden="true" />
                <div className="github-branch-info">
                  <strong>{branch.name}</strong>
                  {branch.sha ? <span className="github-sha-text">{branch.sha}</span> : null}
                </div>
              </div>
              <div className="github-branch-right">
                {branch.isProtected ? <span className="github-protected-badge">{tc('github.branches.protected')}</span> : null}
                {branch.current ? (
                  <span className="github-current-badge">{tc('github.branches.current')}</span>
                ) : (
                  <Button variant="ghost" className="github-branch-action-btn" aria-label={tc('github.branches.checkoutLabel', { name: branch.name })} onClick={() => onCheckout(branch.name)}>{tc('github.branches.checkout')}</Button>
                )}
              </div>
            </div>
          ))}
          {branches.length === 0 ? <EmptyState compact title={tc('github.branches.none')} /> : null}
        </div>
      </div>
    </div>
  )
}

// ─── Pull Requests ─────────────────────────────────────────────────────────

function PullRequestsTab({ prs, status, loading, input, onCreate, onRefresh }: {
  prs: GitHubPullRequest[]
  status: GitHubWorkspaceStatus | null
  loading: boolean
  input: { workspaceId: string; rootPath: string }
  onCreate: (title: string, body: string) => void
  onRefresh: () => void
}): ReactElement {
  const [selected, setSelected] = useState<GitHubPullRequest | null>(null)
  const [filter, setFilter] = useState<'open' | 'closed' | 'all'>('open')
  const [localPrs, setLocalPrs] = useState<GitHubPullRequest[] | null>(null)
  const repoName = status?.repository?.fullName
  const detected = status?.repository?.detected
  const displayPrs = localPrs ?? prs
  const filtered = filter === 'all' ? displayPrs : displayPrs.filter((pr) => pr.state.toLowerCase() === filter)

  const changeFilter = async (next: 'open' | 'closed' | 'all'): Promise<void> => {
    setFilter(next)
    try {
      const result = await window.oxe.github.listPullRequests({ ...input, state: next === 'all' ? 'all' : next })
      setLocalPrs(result)
    } catch {
      setLocalPrs(null)
    }
  }

  if (selected) {
    return (
      <div className="github-tab-layout">
        <div className="github-tab-scroll">
          <div className="github-detail-header-row">
            <Button variant="ghost" size="sm" square aria-label={tc('github.back')} onClick={() => setSelected(null)}><ArrowLeft size={14} aria-hidden="true" /></Button>
            <span className="github-detail-title">#{selected.number} {selected.title}</span>
          </div>
          <div className="github-tab-sep" />
          <div className="github-pr-meta-row">
            <span className={`github-pr-state-badge ${selected.state.toLowerCase()}`}>{tc(`github.prs.state.${selected.state.toLowerCase() === 'merged' ? 'merged' : selected.state.toLowerCase() === 'closed' ? 'closed' : 'open'}`)}</span>
            <span className="github-pr-branches-text">{selected.headRefName ?? '?'} {'→'} {selected.baseRefName ?? 'main'}</span>
          </div>
          {selected.author ? <div className="github-detail-line">{tc('github.author')} <strong>{selected.author}</strong></div> : null}
          {selected.createdAt ? <div className="github-detail-line">{tc('github.created')} <strong>{formatDate(selected.createdAt)}</strong></div> : null}
          {selected.body ? (
            <div className="github-detail-body-card">
              <pre className="github-detail-body-text">{selected.body}</pre>
            </div>
          ) : null}
        </div>
        <div className="github-detail-footer">
          {selected.headRefName ? (
            <Button variant="ghost" size="sm" data-testid="github-pr-open-in-changes"
              title={tc('github.prs.compareTitle', { base: selected.baseRefName ?? 'main', head: selected.headRefName, panel: WORKBENCH_PANELS.changes.label })}
              onClick={() => openInChanges(input.workspaceId, { base: selected.baseRefName ?? 'main', head: selected.headRefName ?? undefined })}>
              {tc('github.prs.viewIn', { panel: WORKBENCH_PANELS.changes.label })} <GitCompareArrows size={12} aria-hidden="true" />
            </Button>
          ) : null}
          {selected.url ? (
            <Button variant="ghost" size="sm" onClick={() => void openExternalLink(selected.url ?? '', { source: 'github' })}>
              {tc('github.viewOnGitHub')} <ExternalLink size={12} aria-hidden="true" />
            </Button>
          ) : null}
        </div>
      </div>
    )
  }

  return (
    <div className="github-tab-layout">
      <div className="github-tab-scroll">
        <div className="github-tab-header">
          <div className="github-tab-header-title"><span>{tc('github.prs.title')}</span></div>
          <div className="github-tab-header-actions">
            <Button variant="ghost" size="sm" square title={tc('github.refresh')} aria-label={tc('github.refresh')} onClick={onRefresh}><RefreshCw size={14} aria-hidden="true" /></Button>
            <Button variant="secondary" size="sm" disabled={!repoName} title={tc('github.prs.newTitle')} onClick={() => repoName && void openExternalLink(`https://github.com/${repoName}/compare`, { source: 'github' })}>{tc('github.prs.new')}</Button>
          </div>
        </div>
        <div className="github-tab-sep" />

        {repoName ? (
          <div className="github-repo-badge">
            <Link2 size={14} aria-hidden="true" />
            <span>{repoName}</span>
            {detected ? <span className="github-detected">{tc('github.detected')}</span> : null}
          </div>
        ) : null}

        <div className="github-filter-tabs">
          {(['open', 'closed', 'all'] as const).map((f) => (
            <button key={f} type="button" className={`github-filter-tab${filter === f ? ' active' : ''}`} aria-pressed={filter === f} onClick={() => void changeFilter(f)}>
              {tc(`github.prs.filter.${f}`)}
            </button>
          ))}
        </div>

        <div className="github-list">
          {filtered.map((pr) => (
            <button key={pr.number} type="button" className="github-pr-row" onClick={() => setSelected(pr)}>
              <GitPullRequest size={14} className="github-pr-icon" aria-hidden="true" />
              <div className="github-pr-info">
                <strong>#{pr.number} {pr.title}</strong>
                <span>{pr.headRefName ?? '?'} {'→'} {pr.baseRefName ?? 'main'}</span>
              </div>
              <span className="github-pr-author-name">{pr.author ?? ''}</span>
            </button>
          ))}
          {filtered.length === 0 ? <EmptyState compact title={tc('github.prs.none')} /> : null}
        </div>
      </div>
    </div>
  )
}

// ─── Commits ───────────────────────────────────────────────────────────────

function CommitsTab({ commitDetails, commits, loading, status, onLoadDetails, onRefresh }: {
  commitDetails: Record<string, GitHubCommitDetails>
  commits: GitHubCommit[]
  loading: boolean
  status: GitHubWorkspaceStatus | null
  onLoadDetails: (oid: string) => Promise<GitHubCommitDetails>
  onRefresh: () => void
}): ReactElement {
  const [selectedOid, setSelectedOid] = useState<string | null>(null)
  const selected = selectedOid ? commitDetails[selectedOid] ?? null : null
  const repoName = status?.repository?.fullName
  const detected = status?.repository?.detected

  const openCommit = (oid: string): void => {
    setSelectedOid(oid)
    if (!commitDetails[oid]) void onLoadDetails(oid)
  }

  if (selectedOid) {
    return (
      <div className="github-tab-layout">
        <div className="github-tab-scroll">
          <div className="github-detail-header-row">
            <Button variant="ghost" size="sm" square aria-label={tc('github.back')} onClick={() => setSelectedOid(null)}><ArrowLeft size={14} aria-hidden="true" /></Button>
            <code className="github-detail-sha">{selected?.shortOid ?? selectedOid.slice(0, 7)}</code>
          </div>
          <div className="github-tab-sep" />
          {!selected && loading ? <EmptyState compact title={tc('github.commits.loading')} /> : null}
          {selected ? <CommitDetailView details={selected} /> : null}
        </div>
      </div>
    )
  }

  return (
    <div className="github-tab-layout">
      <div className="github-tab-scroll">
        <div className="github-tab-header">
          <div className="github-tab-header-title"><span>{tc('git.tabs.commits')}</span></div>
          <Button variant="ghost" size="sm" square title={tc('github.refresh')} aria-label={tc('github.refresh')} onClick={onRefresh}><RefreshCw size={14} aria-hidden="true" /></Button>
        </div>
        <div className="github-tab-sep" />

        {repoName ? (
          <div className="github-repo-badge">
            <Link2 size={14} aria-hidden="true" />
            <span>{repoName}</span>
            {detected ? <span className="github-detected">{tc('github.detected')}</span> : null}
          </div>
        ) : null}

        <div className="github-list">
          {commits.map((commit) => (
            <button key={commit.oid} type="button" className="github-commit-item" onClick={() => openCommit(commit.oid)}>
              <code className="github-commit-item-sha">{commit.shortOid}</code>
              <div className="github-commit-item-body">
                <strong>{commit.message}</strong>
                <span>{[commit.author, commit.committedDate ? formatDate(commit.committedDate) : null].filter(Boolean).join(' · ')}</span>
              </div>
            </button>
          ))}
          {commits.length === 0 ? <EmptyState compact title={tc('github.commits.none')} /> : null}
        </div>
      </div>
    </div>
  )
}

function CommitDetailView({ details }: { details: GitHubCommitDetails }): ReactElement {
  return (
    <>
      {details.body ? (
        <div className="github-detail-body-card">
          <pre className="github-detail-body-text">{details.body}</pre>
        </div>
      ) : null}
      <div className="github-detail-meta-rows">
        <div>{tc('github.author')} <strong>{details.author ?? '-'}</strong></div>
        <div>{tc('github.date')} <strong>{formatDate(details.committedDate)}</strong></div>
        <div className="github-sha-line">SHA: <code>{details.oid}</code></div>
      </div>
      <div className="github-change-summary">
        <span className="github-addition">+{details.additions}</span>
        <span className="github-deletion">-{details.deletions}</span>
        <span>{tc('github.commits.changes', { count: details.files.length })}</span>
      </div>
      <div className="github-changed-files-section">
        <strong className="github-changed-files-title">{tc('github.commits.files', { count: details.files.length })}</strong>
        {details.files.map((file) => (
          <div key={file.path} className="github-file-row">
            <span>{file.path}</span>
            <small>{file.binary ? tc('github.commits.binary') : <><span className="github-addition">+{file.additions}</span>{' '}<span className="github-deletion">-{file.deletions}</span></>}</small>
          </div>
        ))}
      </div>
      {details.url ? (
        <Button variant="ghost" size="sm" onClick={() => void openExternalLink(details.url ?? '', { source: 'github' })}>
          {tc('github.viewOnGitHub')} <ExternalLink size={12} aria-hidden="true" />
        </Button>
      ) : null}
    </>
  )
}

// ─── Releases ──────────────────────────────────────────────────────────────

function ReleasesTab({ releases, status, loading, onCreate, onRefresh }: {
  releases: GitHubRelease[]
  status: GitHubWorkspaceStatus | null
  loading: boolean
  onCreate: (r: { tagName: string; title?: string; notes?: string; draft?: boolean; prerelease?: boolean; generateNotes?: boolean }) => void
  onRefresh: () => void
}): ReactElement {
  const [selected, setSelected] = useState<GitHubRelease | null>(null)
  const [showCreate, setShowCreate] = useState(false)
  const [tagName, setTagName] = useState('')
  const [title, setTitle] = useState('')
  const [notes, setNotes] = useState('')
  const [draft, setDraft] = useState(false)
  const [prerelease, setPrerelease] = useState(false)
  const repoName = status?.repository?.fullName
  const detected = status?.repository?.detected

  if (selected) {
    return (
      <div className="github-tab-layout">
        <div className="github-tab-scroll">
          <div className="github-detail-header-row">
            <Button variant="ghost" size="sm" square aria-label={tc('github.back')} onClick={() => setSelected(null)}><ArrowLeft size={14} aria-hidden="true" /></Button>
            <span className="github-detail-title">{selected.name ?? selected.tagName}</span>
          </div>
          <div className="github-tab-sep" />
          <div className="github-release-tag-badge">{selected.tagName}</div>
          <div className="github-detail-meta-rows">
            {selected.publishedAt ? <div>{tc('github.releases.published')} <strong>{formatDate(selected.publishedAt)}</strong></div> : null}
            <div>{selected.isDraft ? tc('github.releases.draft') : selected.isPrerelease ? tc('github.releases.prerelease') : tc('github.releases.release')}</div>
          </div>
          {selected.url ? (
            <Button variant="ghost" size="sm" onClick={() => void openExternalLink(selected.url ?? '', { source: 'github' })}>
              {tc('github.viewOnGitHub')} <ExternalLink size={12} aria-hidden="true" />
            </Button>
          ) : null}
        </div>
      </div>
    )
  }

  if (showCreate) {
    return (
      <div className="github-tab-layout">
        <div className="github-tab-scroll">
          <div className="github-detail-header-row">
            <Button variant="ghost" size="sm" square aria-label={tc('github.back')} onClick={() => setShowCreate(false)}><ArrowLeft size={14} aria-hidden="true" /></Button>
            <span className="github-detail-title">{tc('github.releases.newTitle')}</span>
          </div>
          <div className="github-tab-sep" />
          <div className="github-release-form-body">
            <label>{tc('github.releases.tag')}<TextField value={tagName} placeholder="v1.0.0" onChange={(e) => setTagName(e.target.value)} /></label>
            <label>{tc('github.releases.titleOptional')}<TextField value={title} placeholder={tc('github.releases.titlePlaceholder')} onChange={(e) => setTitle(e.target.value)} /></label>
            <label>{tc('github.releases.notes')}<TextArea value={notes} placeholder={tc('github.releases.notesPlaceholder')} onChange={(e) => setNotes(e.target.value)} /></label>
            <div className="github-check-row">
              <Checkbox checked={draft} onChange={(e) => setDraft(e.target.checked)} label={tc('github.releases.draft')} />
              <Checkbox checked={prerelease} onChange={(e) => setPrerelease(e.target.checked)} label={tc('github.releases.prerelease')} />
            </div>
            <Button variant="primary" className="github-block-btn" disabled={loading || !tagName.trim()} onClick={() => onCreate({ tagName: tagName.trim(), title: title.trim() || undefined, notes: notes.trim() || undefined, draft, prerelease, generateNotes: !notes.trim() })}>
              {tc('github.releases.create')}
            </Button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="github-tab-layout">
      <div className="github-tab-scroll">
        <div className="github-tab-header">
          <div className="github-tab-header-title"><span>{tc('git.tabs.releases')}</span></div>
          <div className="github-tab-header-actions">
            <Button variant="ghost" size="sm" square title={tc('github.refresh')} aria-label={tc('github.refresh')} onClick={onRefresh}><RefreshCw size={14} aria-hidden="true" /></Button>
            <Button variant="secondary" size="sm" onClick={() => setShowCreate(true)}>{tc('github.releases.new')}</Button>
          </div>
        </div>
        <div className="github-tab-sep" />

        {repoName ? (
          <div className="github-repo-badge">
            <Link2 size={14} aria-hidden="true" />
            <span>{repoName}</span>
            {detected ? <span className="github-detected">{tc('github.detected')}</span> : null}
          </div>
        ) : null}

        <div className="github-list">
          {releases.map((release) => (
            <button key={release.tagName} type="button" className="github-release-row" onClick={() => setSelected(release)}>
              <Tag size={14} aria-hidden="true" className="github-release-tag-icon" />
              <div className="github-release-info">
                <span className="github-release-tag-name">{release.tagName}</span>
                <strong>{release.name ?? release.tagName}</strong>
                {release.publishedAt ? <span>{formatDate(release.publishedAt)}</span> : null}
              </div>
            </button>
          ))}
          {releases.length === 0 ? <EmptyState compact title={tc('github.releases.none')} /> : null}
        </div>
      </div>
    </div>
  )
}

// ─── Settings ──────────────────────────────────────────────────────────────

// Onda 5: rewritten as a tree (workflows → runs) + right-side run detail panel, matching the VS Code GitHub Actions extension layout.
function ActionsTab({ workflows, workflowRuns, workflowRunDetails, loading, workspaceId, rootPath, onLoadRunDetails, onRun, onRerun, onRefresh }: {
  workflows: GitHubWorkflow[]
  workflowRuns: GitHubWorkflowRun[]
  workflowRunDetails: Record<number, GitHubWorkflowRunDetails>
  loading: boolean
  workspaceId: string
  rootPath: string
  onLoadRunDetails: (runId: number) => Promise<GitHubWorkflowRunDetails>
  onRun: (workflowId: string, ref?: string, fields?: Record<string, string>) => void
  onRerun: (runId: number, failedOnly: boolean) => void
  onRefresh: () => void
}): ReactElement {
  const [filter, setFilter] = useState<'all' | 'failed' | 'in_progress'>('all')
  const [selectedRunId, setSelectedRunId] = useState<number | null>(null)
  const [collapsedWorkflows, setCollapsedWorkflows] = useState<Set<string>>(new Set())
  const [showRunForm, setShowRunForm] = useState(false)

  // Group runs under their workflow. gh's `--json name` returns the workflow
  // display name on each run — we match against the workflow list and bucket.
  // Workflows with zero runs still appear (empty parent) so users can spot
  // workflows that never ran.
  const groups = useMemo(() => {
    const filtered = workflowRuns.filter((run) => {
      if (filter === 'failed') return run.conclusion === 'failure' || run.status === 'failure'
      if (filter === 'in_progress') return run.status === 'in_progress' || run.status === 'queued'
      return true
    })
    const byWorkflow = new Map<string, GitHubWorkflowRun[]>()
    for (const run of filtered) {
      const key = run.name ?? tc('github.actions.unknownWorkflow')
      const bucket = byWorkflow.get(key) ?? []
      bucket.push(run)
      byWorkflow.set(key, bucket)
    }
    const out: Array<{ workflow: GitHubWorkflow | { id: number; name: string; path: string; state: string }; runs: GitHubWorkflowRun[] }> = []
    for (const workflow of workflows) {
      out.push({ workflow, runs: (byWorkflow.get(workflow.name) ?? []).sort((a, b) => (b.createdAt ?? '').localeCompare(a.createdAt ?? '')) })
      byWorkflow.delete(workflow.name)
    }
    // Surface runs from workflows not in the workflow list (e.g. renamed/deleted)
    for (const [name, runs] of byWorkflow) {
      out.push({ workflow: { id: -1, name, path: '', state: 'unknown' }, runs })
    }
    return out
  }, [workflows, workflowRuns, filter])

  const selectedRun = workflowRuns.find((r) => r.databaseId === selectedRunId) ?? null
  const selectedDetails = selectedRunId !== null ? workflowRunDetails[selectedRunId] ?? null : null

  useEffect(() => {
    if (selectedRunId !== null || workflowRuns.length === 0) return
    setSelectedRunId(workflowRuns[0].databaseId)
  }, [selectedRunId, workflowRuns])

  useEffect(() => {
    if (!selectedRun) return
    void onLoadRunDetails(selectedRun.databaseId).catch(() => undefined)
  }, [onLoadRunDetails, selectedRun?.databaseId])

  useEffect(() => {
    if (!selectedRun || (selectedRun.status !== 'in_progress' && selectedRun.status !== 'queued')) return
    const id = window.setInterval(() => {
      void onLoadRunDetails(selectedRun.databaseId).catch(() => undefined)
      onRefresh()
    }, 5000)
    return () => window.clearInterval(id)
  }, [onLoadRunDetails, onRefresh, selectedRun?.databaseId, selectedRun?.status])

  const toggleWorkflow = (name: string): void => {
    setCollapsedWorkflows((prev) => {
      const next = new Set(prev)
      if (next.has(name)) next.delete(name); else next.add(name)
      return next
    })
  }

  return (
    <div className="github-actions-v2">
      <header className="github-actions-v2-toolbar">
        <div className="github-actions-v2-title">
          <Play size={14} aria-hidden="true" />
          <span>{tc('git.tabs.actions')}</span>
        </div>
        <div className="github-actions-v2-filters">
          {(['all', 'failed', 'in_progress'] as const).map((f) => (
            <button
              key={f}
              type="button"
              className={`github-actions-v2-filter${filter === f ? ' active' : ''}`}
              aria-pressed={filter === f}
              onClick={() => setFilter(f)}
            >
              {tc(`github.actions.filter.${f}`)}
            </button>
          ))}
          <Button variant="ghost" size="sm" square title={tc('github.refresh')} aria-label={tc('github.refresh')} onClick={onRefresh}>
            <RefreshCw size={14} aria-hidden="true" className={loading ? 'usage-spin' : undefined} />
          </Button>
          <Button variant="ghost" size="sm" square title={tc('github.confirm.runWorkflow')} aria-label={tc('github.confirm.runWorkflow')} aria-expanded={showRunForm} onClick={() => setShowRunForm((v) => !v)}>
            <Play size={14} aria-hidden="true" />
          </Button>
        </div>
      </header>

      {showRunForm ? (
        <RunWorkflowForm
          workflows={workflows}
          loading={loading}
          onRun={(id, ref, fields) => { onRun(id, ref, fields); setShowRunForm(false) }}
          onCancel={() => setShowRunForm(false)}
        />
      ) : null}

      <div className="github-actions-v2-split">
        <aside className="github-actions-v2-tree">
          {groups.length === 0 ? (
            <EmptyState compact title={tc('github.actions.noWorkflows')} />
          ) : (
            groups.map(({ workflow, runs }) => {
              const collapsed = collapsedWorkflows.has(workflow.name)
              return (
                <div key={workflow.name} className="github-actions-v2-workflow">
                  <button
                    type="button"
                    className="github-actions-v2-workflow-row"
                    onClick={() => toggleWorkflow(workflow.name)}
                  >
                    {collapsed ? <ChevronRight size={12} aria-hidden="true" /> : <ChevronDown size={12} aria-hidden="true" />}
                    <RunStatusIcon status="workflow" conclusion={null} />
                    <span className="github-actions-v2-workflow-name">{workflow.name}</span>
                    <span className="github-actions-v2-workflow-meta">{runs.length}</span>
                  </button>
                  {!collapsed && (
                    runs.length === 0 ? (
                      <EmptyState compact title={tc('github.actions.noRuns')} />
                    ) : (
                      runs.map((run) => (
                        <button
                          key={run.databaseId}
                          type="button"
                          className={`github-actions-v2-run-row${selectedRunId === run.databaseId ? ' selected' : ''}`}
                          onClick={() => setSelectedRunId(run.databaseId)}
                        >
                          <RunStatusIcon status={run.status} conclusion={run.conclusion} />
                          <span className="github-actions-v2-run-title">
                            {run.displayTitle ?? tc('github.actions.runNumber', { id: run.databaseId })}
                          </span>
                          {run.branch ? <span className="github-actions-v2-run-branch">{run.branch}</span> : null}
                          {run.createdAt ? <span className="github-actions-v2-run-time">{formatAgo(run.createdAt)}</span> : null}
                        </button>
                      ))
                    )
                  )}
                </div>
              )
            })
          )}
        </aside>

        <section className="github-actions-v2-detail">
          {selectedRun ? (
            <RunDetail
              run={selectedRun}
              details={selectedDetails}
              rootPath={rootPath}
              workspaceId={workspaceId}
              onRefresh={() => void onLoadRunDetails(selectedRun.databaseId)}
              onRerun={(failedOnly) => onRerun(selectedRun.databaseId, failedOnly)}
            />
          ) : (
            <EmptyState compact title={tc('github.actions.selectRun')} />
          )}
        </section>
      </div>
    </div>
  )
}

function RunDetail({ run, details, rootPath, workspaceId, onRefresh, onRerun }: {
  run: GitHubWorkflowRun
  details: GitHubWorkflowRunDetails | null
  rootPath: string
  workspaceId: string
  onRefresh: () => void
  onRerun: (failedOnly: boolean) => void
}): ReactElement {
  const isFailed = run.conclusion === 'failure' || run.status === 'failure'
  const [logs, setLogs] = useState<{ text: string; truncated: boolean } | null>(null)
  const [logsLoading, setLogsLoading] = useState(false)
  const [logsError, setLogsError] = useState<string | null>(null)
  const [logsMode, setLogsMode] = useState<'all' | 'failed' | null>(null)
  const [logsElapsed, setLogsElapsed] = useState(0)

  // Reset logs when the selected run changes — otherwise the viewer keeps the
  // previous run's text up until the next fetch.
  useEffect(() => {
    setLogs(null)
    setLogsError(null)
    setLogsMode(null)
    setLogsElapsed(0)
  }, [run.databaseId])

  // Tick a counter while the download is in flight so the UI doesn't look
  // frozen. `gh run view --log` can take 30–90s for a multi-job CI run.
  useEffect(() => {
    if (!logsLoading) return
    setLogsElapsed(0)
    const start = Date.now()
    const id = window.setInterval(() => setLogsElapsed(Math.floor((Date.now() - start) / 1000)), 1000)
    return () => window.clearInterval(id)
  }, [logsLoading])

  const fetchLogs = async (mode: 'all' | 'failed'): Promise<void> => {
    setLogsLoading(true)
    setLogsError(null)
    setLogsMode(mode)
    try {
      // Defensive: if the preload hasn't been refreshed (running on an older
      // build) this property will be undefined. Surface that explicitly instead
      // of letting the renderer swallow a silent TypeError.
      const api = window.oxe?.github as { getRunLogs?: (input: { rootPath: string; runId: number; failedOnly: boolean }) => Promise<{ logs: string; truncated: boolean; bytes: number }> } | undefined
      if (!api?.getRunLogs) {
        throw new Error(tc('github.actions.logsUnavailable'))
      }
      console.info('[GitHubActions] fetching logs', { runId: run.databaseId, mode })
      const result = await api.getRunLogs({ rootPath, runId: run.databaseId, failedOnly: mode === 'failed' })
      console.info('[GitHubActions] logs received', { bytes: result.bytes, truncated: result.truncated })
      setLogs({ text: result.logs, truncated: result.truncated })
    } catch (err) {
      console.error('[GitHubActions] fetch logs failed', err)
      setLogsError(humanizeError(err))
      setLogs(null)
    } finally {
      setLogsLoading(false)
    }
  }

  return (
    <div className="github-actions-v2-detail-body">
      <header className="github-actions-v2-detail-header">
        <RunStatusIcon status={run.status} conclusion={run.conclusion} size={16} />
        <div className="github-actions-v2-detail-title">
          <strong>{run.displayTitle ?? run.name ?? tc('github.actions.runNumber', { id: run.databaseId })}</strong>
          <span>{[run.status, run.conclusion, run.event, run.actor].filter(Boolean).join(' · ')}</span>
        </div>
      </header>

      <dl className="github-actions-v2-detail-meta">
        {run.branch ? (<><dt>{tc('github.actions.branch')}</dt><dd>{run.branch}</dd></>) : null}
        {run.actor ? (<><dt>{tc('github.actions.actor')}</dt><dd>{run.actor}</dd></>) : null}
        {run.event ? (<><dt>{tc('github.actions.event')}</dt><dd>{run.event}</dd></>) : null}
        {run.createdAt ? (<><dt>{tc('github.actions.created')}</dt><dd>{formatDate(run.createdAt)}</dd></>) : null}
      </dl>

      <div className="github-actions-v2-detail-actions">
        <Button variant="ghost" onClick={() => onRerun(false)}>
          <RefreshCw size={12} aria-hidden="true" /> {tc('github.actions.rerunAll')}
        </Button>
        {isFailed ? (
          <Button variant="ghost" onClick={() => onRerun(true)}>
            <RefreshCw size={12} aria-hidden="true" /> {tc('github.actions.rerunFailed')}
          </Button>
        ) : null}
        <Button
          variant="ghost"
          size="sm"
          aria-pressed={logsMode === 'all'}
          disabled={logsLoading}
          onClick={() => void fetchLogs('all')}
        >
          <Terminal size={12} aria-hidden="true" /> {logsLoading && logsMode === 'all' ? tc('github.actions.loadingFor', { seconds: logsElapsed }) : tc('github.actions.viewLogs')}
        </Button>
        {isFailed ? (
          <Button
            variant="ghost"
            size="sm"
            aria-pressed={logsMode === 'failed'}
            disabled={logsLoading}
            onClick={() => void fetchLogs('failed')}
          >
            <Terminal size={12} aria-hidden="true" /> {logsLoading && logsMode === 'failed' ? tc('github.actions.loadingFor', { seconds: logsElapsed }) : tc('github.actions.failedLogs')}
          </Button>
        ) : null}
        {run.url ? (
          <Button variant="ghost" onClick={() => void openExternalLink(run.url ?? '', { source: 'github' })}>
            <ExternalLink size={12} aria-hidden="true" /> {tc('github.viewOnGitHub')}
          </Button>
        ) : null}
        <Button variant="ghost" onClick={onRefresh}>
          <RefreshCw size={12} aria-hidden="true" /> {tc('github.actions.refreshSteps')}
        </Button>
      </div>

      <WorkflowRuntimeTree run={details ?? run} jobs={details?.jobs ?? []} workspaceId={workspaceId} />

      {logsError ? <ErrorState compact title={tc('github.actions.logsFailed')} message={logsError} onRetry={() => void fetchLogs(logsMode ?? 'all')} /> : null}

      {logsLoading && !logs ? (
        <div className="github-actions-v2-logs-progress">
          {tc('github.actions.fetchingLogs', { seconds: logsElapsed })}
          {logsElapsed >= 30 ? ` ${tc('github.actions.slow')}` : null}
          {logsElapsed >= 120 ? ` ${tc('github.actions.verySlow')}` : null}
        </div>
      ) : null}

      {logs ? (
        <div className="github-actions-v2-logs-viewer">
          <header className="github-actions-v2-logs-header">
            <span>{logsMode === 'failed' ? tc('github.actions.failedStepLogs') : tc('github.actions.fullLogs')}</span>
            <div className="github-actions-v2-logs-header-actions">
              {logs.truncated ? <span className="github-actions-v2-logs-truncated">{tc('github.actions.truncated')}</span> : null}
              <Button
               
                variant="ghost" size="sm"
                onClick={() => void copyText(logs.text, tc('github.actions.logs'), tc('github.actions.logsCopied'))}
                title={tc('github.actions.copyLogs')}
              >
                <Copy size={12} aria-hidden="true" /> {tc('github.actions.copy')}
              </Button>
              <Button
               
                variant="ghost" size="sm"
                onClick={() => { setLogs(null); setLogsMode(null) }}
                aria-label={tc('github.actions.closeLogs')}
              >
                {tc('github.actions.hide')}
              </Button>
            </div>
          </header>
          <pre className="github-actions-v2-logs-body">{logs.text}</pre>
        </div>
      ) : null}

      {!logs && !logsLoading && !logsError ? (
        <div className="github-actions-v2-detail-hint">
          <RichText text={tc('github.actions.stepsHint')} />
        </div>
      ) : null}
    </div>
  )
}

function WorkflowRuntimeTree({ run, jobs, workspaceId }: { run: GitHubWorkflowRun; jobs: GitHubWorkflowJob[]; workspaceId: string }): ReactElement {
  const [collapsedJobs, setCollapsedJobs] = useState<Set<string>>(new Set())
  const toggleJob = (name: string): void => {
    setCollapsedJobs((prev) => {
      const next = new Set(prev)
      if (next.has(name)) next.delete(name); else next.add(name)
      return next
    })
  }

  if (jobs.length === 0) {
    return <LoadingState label={tc('github.actions.loadingJobs')} />
  }

  return (
    <div className="github-actions-runtime" aria-label={tc('github.actions.steps')}>
      <div className="github-actions-runtime-heading">
        <span>{tc('github.actions.pipeline')}</span>
        <small>{run.status}{run.conclusion ? ` · ${run.conclusion}` : ''}</small>
      </div>
      {jobs.map((job) => {
        const key = `${workspaceId}:${job.databaseId ?? job.name}`
        const collapsed = collapsedJobs.has(key)
        return (
          <div key={key} className="github-actions-job">
            <button type="button" className="github-actions-job-row" onClick={() => toggleJob(key)}>
              {collapsed ? <ChevronRight size={12} aria-hidden="true" /> : <ChevronDown size={12} aria-hidden="true" />}
              <RunStatusIcon status={job.status} conclusion={job.conclusion} />
              <span className="github-actions-job-name">{job.name}</span>
              <span className="github-actions-job-meta">{tc('github.actions.stepCount', { count: job.steps.length })}</span>
            </button>
            {!collapsed ? (
              <div className="github-actions-step-list">
                {job.steps.length === 0 ? (
                  <EmptyState compact title={tc('github.actions.noSteps')} />
                ) : (
                  job.steps.map((step) => (
                    <div key={`${key}:${step.number ?? step.name}`} className="github-actions-step-row">
                      <RunStatusIcon status={step.status} conclusion={step.conclusion} />
                      <span className="github-actions-step-name">{step.name}</span>
                      <span className="github-actions-step-state">{step.conclusion ?? step.status}</span>
                    </div>
                  ))
                )}
              </div>
            ) : null}
          </div>
        )
      })}
    </div>
  )
}

function RunWorkflowForm({ workflows, loading, onRun, onCancel }: {
  workflows: GitHubWorkflow[]
  loading: boolean
  onRun: (workflowId: string, ref?: string, fields?: Record<string, string>) => void
  onCancel: () => void
}): ReactElement {
  const [workflowId, setWorkflowId] = useState('')
  const [ref, setRef] = useState('')
  const [fieldsText, setFieldsText] = useState('')
  const selected = workflows.find((w) => String(w.id) === workflowId)
  const fields = useMemo(() => {
    const out: Record<string, string> = {}
    for (const line of fieldsText.split(/\r?\n/)) {
      const trimmed = line.trim()
      if (!trimmed || !trimmed.includes('=')) continue
      const eq = trimmed.indexOf('=')
      out[trimmed.slice(0, eq).trim()] = trimmed.slice(eq + 1).trim()
    }
    return out
  }, [fieldsText])

  return (
    <div className="github-actions-v2-runform">
      <div className="github-actions-v2-runform-row">
        <Select value={workflowId} aria-label={tc('github.actions.workflow')} onChange={(e) => setWorkflowId(e.currentTarget.value)}>
          <option value="">{tc('github.actions.selectWorkflow')}</option>
          {workflows.map((w) => <option key={w.id} value={String(w.id)}>{w.name}</option>)}
        </Select>
        <TextField value={ref} aria-label={tc('github.actions.ref')} placeholder={tc('github.actions.refPlaceholder')} onChange={(e) => setRef(e.currentTarget.value)} />
      </div>
      <TextArea
        value={fieldsText}
        aria-label={tc('github.actions.inputs')}
        placeholder={tc('github.actions.inputsPlaceholder')}
        rows={3}
        onChange={(e) => setFieldsText(e.currentTarget.value)}
      />
      <div className="github-actions-v2-runform-actions">
        <Button variant="ghost" onClick={onCancel}>{tc('github.cancel')}</Button>
        <Button
          variant="primary"
          disabled={loading || !selected}
          onClick={() => selected ? onRun(String(selected.id), ref.trim() || undefined, Object.keys(fields).length > 0 ? fields : undefined) : undefined}
        >
          {tc('github.confirm.runWorkflow')}
        </Button>
      </div>
    </div>
  )
}

function RunStatusIcon({ status, conclusion, size = 12 }: { status: string; conclusion: string | null; size?: number }): ReactElement {
  if (status === 'workflow') return <Play size={size} aria-hidden="true" className="github-actions-v2-icon-neutral" />
  if (status === 'in_progress' || status === 'queued') {
    return <Clock size={size} aria-hidden="true" className="github-actions-v2-icon-running usage-spin" />
  }
  if (conclusion === 'success') return <CheckCircle2 size={size} aria-hidden="true" className="github-actions-v2-icon-success" />
  if (conclusion === 'failure' || status === 'failure') return <AlertTriangle size={size} aria-hidden="true" className="github-actions-v2-icon-failed" />
  if (conclusion === 'cancelled') return <AlertTriangle size={size} aria-hidden="true" className="github-actions-v2-icon-cancelled" />
  if (conclusion === 'skipped') return <ExternalLink size={size} aria-hidden="true" className="github-actions-v2-icon-neutral" />
  return <Clock size={size} aria-hidden="true" className="github-actions-v2-icon-neutral" />
}

/** "3 minutes ago" in the interface language; the raw text when it is not a date. */
function formatAgo(iso: string): string {
  return Number.isNaN(new Date(iso).getTime()) ? iso : formatRelative(iso)
}

function SettingsTab({ status, rootPath, connectedRepositories, onRunCommand, onRefresh }: {
  status: GitHubWorkspaceStatus | null
  rootPath: string
  connectedRepositories: GitHubConnectedRepository[]
  onRunCommand: (cmd: string) => void
  onRefresh: () => void
}): ReactElement {
  const cli = status?.cli
  const isConnected = cli?.available === true && cli.authenticated === true
  const username = cli?.user ?? null

  return (
    <div className="github-tab-layout">
      <div className="github-tab-scroll">
        <div className="github-tab-header">
          <div className="github-tab-header-title"><span>{tc('git.tabs.settings')}</span></div>
          <Button variant="ghost" size="sm" square title={tc('github.refresh')} aria-label={tc('github.refresh')} onClick={onRefresh}><RefreshCw size={14} aria-hidden="true" /></Button>
        </div>
        <div className="github-tab-sep" />

        <div className="github-settings-card">
          <div className="github-settings-card-header">
            <Github size={20} aria-hidden="true" />
            <div>
              <strong>{tc('github.settings.title')}</strong>
              <span>{tc('github.settings.subtitle')}</span>
            </div>
          </div>

          {isConnected && username ? (
            <div className="github-user-row">
              <div className="github-user-avatar">{username.slice(0, 1).toUpperCase()}</div>
              <div className="github-user-info">
                <strong>{username}</strong>
                <span>@{username}</span>
              </div>
              <span className="github-connected-badge">✓ {tc('github.settings.connected')}</span>
            </div>
          ) : (
            <div className="github-not-connected-row">
              <span>{cli?.available ? tc('github.settings.notSignedIn') : tc('github.settings.noCli')}</span>
              <Button variant="ghost" onClick={() => onRunCommand('gh auth login')}>
                <Terminal size={12} aria-hidden="true" />
                gh auth login
              </Button>
            </div>
          )}

          <div className="github-settings-repos-section">
            <div className="github-settings-repos-header">
              <span>{tc('github.repos.connected')}</span>
            </div>
            {connectedRepositories.length === 0 ? (
              <EmptyState compact title={tc('github.repos.noneConnected')} />
            ) : (
              <div className="github-list">
                {connectedRepositories.map((r) => (
                  <div key={r.id} className="github-list-row">
                    <div className="github-list-row-main"><strong>{r.fullName}</strong></div>
                  </div>
                ))}
              </div>
            )}
            {isConnected ? (
              <span className="github-cli-note">
                <RichText text={tc('github.settings.cliNote')} />
              </span>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  )
}

// ─── CLI Setup ─────────────────────────────────────────────────────────────

function GitHubCliSetup({ cli, onRunCommand }: { cli: GitHubCliStatus | null; onRunCommand: (cmd: string) => void }): ReactElement {
  const isMissing = !cli?.available
  const isWin = navigator.platform.toLowerCase().includes('win')
  const isMac = navigator.platform.toLowerCase().includes('mac')

  const installCmds = isMac
    ? ['brew install gh']
    : isWin
    ? ['winget install GitHub.cli', 'scoop install gh']
    : ['sudo apt install gh', 'sudo dnf install gh']

  const copyCmd = (cmd: string): void => { void copyText(cmd, tc('github.setup.command'), tc('github.setup.commandCopied')) }

  return (
    <div className="github-cli-setup">
      <AlertTriangle size={28} aria-hidden="true" />
      <h3>{isMissing ? tc('github.setup.cliTitle') : tc('github.setup.authTitle')}</h3>
      <p>{isMissing ? tc('github.setup.cliBody') : tc('github.setup.authBody')}</p>

      {isMissing ? (
        <div className="github-setup-block">
          <span className="github-setup-block-label">{tc('github.setup.install')}</span>
          {installCmds.map((cmd) => (
            <div key={cmd} className="github-setup-cmd-row">
              <code>{cmd}</code>
              <Button variant="ghost" title={tc('github.actions.copy')} aria-label={tc('github.setup.copy', { command: cmd })} onClick={() => copyCmd(cmd)}><Copy size={12} aria-hidden="true" /></Button>
            </div>
          ))}
          <ExternalAnchor className="github-setup-link" href="https://cli.github.com" source="app">
            <ExternalLink size={12} aria-hidden="true" />
            cli.github.com
          </ExternalAnchor>
        </div>
      ) : null}

      <div className="github-setup-block">
        <span className="github-setup-block-label">{tc('github.setup.authenticate')}</span>
        <div className="github-setup-cmd-row">
          <code>gh auth login</code>
          <Button variant="primary" onClick={() => onRunCommand('gh auth login')}>
            <Terminal size={12} aria-hidden="true" />
            {tc('github.setup.run')}
          </Button>
        </div>
      </div>
    </div>
  )
}

// ─── Embedded Terminal ──────────────────────────────────────────────────────

function GitHubEmbeddedTerminal({ command, workspaceId, onDismiss }: {
  command: string
  workspaceId: string
  onDismiss: () => void
}): ReactElement {
  const [paneId, setPaneId] = useState<string | null>(null)
  const [running, setRunning] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const commandSentRef = useRef(false)
  const terminalPrefs = useResolvedTerminalPrefs(workspaceId)
  const themeId = useWorkspaceStore((s) => s.workspaces.find((w) => w.id === workspaceId)?.themeId ?? 'midnight')

  useEffect(() => {
    let cancelled = false
    const setup = async (): Promise<void> => {
      try {
        const { id } = await window.oxe.workspace.createGitHubTerminalPane(workspaceId)
        if (cancelled) return
        setPaneId(id)
        await window.oxe.terminal.start({ paneId: id, workspaceId })
        if (cancelled) return
        setRunning(true)
      } catch (err) {
        if (!cancelled) setError(humanizeError(err))
      }
    }
    void setup()
    return () => { cancelled = true }
  }, [workspaceId])

  useEffect(() => {
    if (!running || !paneId || commandSentRef.current) return
    commandSentRef.current = true
    void window.oxe.terminal.write({ paneId, data: command + '\r' })
  }, [running, paneId, command])

  if (error) return <ErrorState compact title={tc('github.terminal.failed')} message={error} actions={<Button size="sm" variant="ghost" onClick={onDismiss}>{tc('github.terminal.close')}</Button>} />
  if (!paneId || !running) return <div className="github-terminal-loading"><Terminal size={12} aria-hidden="true" /><span>{tc('github.terminal.starting')}</span></div>

  return (
    <div className="github-terminal-embed">
      <div className="github-terminal-header">
        <Terminal size={12} aria-hidden="true" />
        <span>{tc('panels.terminal')}</span>
        <Button variant="ghost" size="sm" square title={tc('github.terminal.close')} aria-label={tc('github.terminal.close')} onClick={onDismiss}>×</Button>
      </div>
      <div className="github-terminal-body">
        <TerminalView
          paneId={paneId}
          isRunning={running}
          themeId={themeId}
          prefs={terminalPrefs}
          onInput={(data) => { void window.oxe.terminal.write({ paneId, data }) }}
          onResize={(cols, rows) => { void window.oxe.terminal.resize({ paneId, cols, rows }) }}
          onExit={() => setRunning(false)}
        />
      </div>
    </div>
  )
}

// ─── Shared ─────────────────────────────────────────────────────────────────

function formatDate(value: string | number | null | undefined): string {
  if (!value) return '-'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? String(value) : formatDateTime(date, { dateStyle: 'short', timeStyle: 'short' })
}

function buildStageAllPreview(status: GitHubWorkspaceStatus | null): string {
  const staged = status?.staged ?? 0
  const modified = status?.modified ?? 0
  const untracked = status?.untracked ?? 0
  const summary = tc('github.confirm.stageAllDetail', { staged, modified, untracked })
  return untracked > 0 ? `${summary} ${tc('github.confirm.stageAllUntracked')}` : summary
}

// ─── Skeleton ───────────────────────────────────────────────────────────────

function GitHubTabSkeleton({ tab }: { tab: GitHubPanelTab }): ReactElement {
  const isStatusLike = tab === 'status'
  return (
    <div className="github-tab-layout" aria-busy="true">
      <div className="github-tab-scroll">
        <div className="github-skel-header">
          <span className="github-skel-bar github-skel-bar-sm" />
          <span className="github-skel-bar github-skel-bar-xs" />
        </div>
        {isStatusLike ? (
          <>
            <div className="github-stats-row github-stats-2">
              <div className="github-skel-card" />
              <div className="github-skel-card" />
            </div>
            <div className="github-stats-row github-stats-3">
              <div className="github-skel-card" />
              <div className="github-skel-card" />
              <div className="github-skel-card" />
            </div>
          </>
        ) : (
          <div className="github-skel-list">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="github-skel-row">
                <span className="github-skel-bar github-skel-bar-md" />
                <span className="github-skel-bar github-skel-bar-sm" />
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
