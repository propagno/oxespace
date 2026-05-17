import { useEffect, useMemo, useRef, useState, type ReactElement } from 'react'
import { AlertTriangle, ArrowLeft, CheckCircle2, ChevronDown, Clock, Copy, ExternalLink, Github, GitPullRequest, Link2, RefreshCw, Tag, Terminal, TrendingUp } from 'lucide-react'
import type { GitHubBranch, GitHubCliStatus, GitHubCommit, GitHubCommitDetails, GitHubConnectedRepository, GitHubPanelTab, GitHubPullRequest, GitHubRelease, GitHubWorkspaceStatus } from '../../../shared/types/github'
import { selectGitHubWorkspace, useGitHubStore } from '../../store/github.store'
import { TerminalView } from '../Terminal/TerminalView'

interface GitHubPanelProps {
  workspaceId: string
  rootPath: string
  activeTab: GitHubPanelTab
  onTabChange: (tab: GitHubPanelTab) => void
}

interface ConfirmAction {
  title: string
  detail: string
  run: () => Promise<void>
}

const TABS: Array<{ id: GitHubPanelTab; label: string; remote?: boolean }> = [
  { id: 'status', label: 'Status' },
  { id: 'checkpoints', label: 'Checkpoints' },
  { id: 'repos', label: 'Repos' },
  { id: 'branches', label: 'Branches' },
  { id: 'prs', label: 'PRs', remote: true },
  { id: 'commits', label: 'Commits' },
  { id: 'releases', label: 'Releases', remote: true },
  { id: 'settings', label: 'Settings' }
]

export function GitHubPanel({ activeTab: propTab, onTabChange, rootPath, workspaceId }: GitHubPanelProps): ReactElement {
  const selector = useMemo(() => selectGitHubWorkspace(workspaceId), [workspaceId])
  const state = useGitHubStore(selector)
  const input = useMemo(() => ({ workspaceId, rootPath }), [workspaceId, rootPath])
  const [confirmAction, setConfirmAction] = useState<ConfirmAction | null>(null)
  const [pendingCommand, setPendingCommand] = useState<string | null>(null)
  const [activeTab, setActiveTab] = useState<GitHubPanelTab>(propTab)

  // Sync local tab when the persisted value changes (e.g., workspace switch)
  useEffect(() => { setActiveTab(propTab) }, [propTab])

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

  const runCommand = (command: string): void => setPendingCommand(command)

  return (
    <section className="github-panel">
      <nav className="github-tabs" aria-label="GitHub tabs">
        {TABS.map((tab) => (
          <button key={tab.id} type="button" className={activeTab === tab.id ? 'github-tab active' : 'github-tab'} onClick={() => handleTabChange(tab.id)}>
            {tab.label}
          </button>
        ))}
        {state.refreshing && !state.loading ? (
          <span className="github-refreshing" aria-live="polite">
            <RefreshCw size={11} className="github-refreshing-spin" aria-hidden="true" />
            Refreshing…
          </span>
        ) : null}
      </nav>

      {state.error && !blocked ? <div className="github-alert"><AlertTriangle size={14} aria-hidden="true" /><span>{state.error}</span></div> : null}
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
                onStageAll={() => requestConfirm('Stage all', 'Adicionar todas as mudanças ao stage.', () => useGitHubStore.getState().stageAll(input))}
                onCommit={(msg) => requestConfirm('Commit', msg, () => useGitHubStore.getState().commit({ ...input, message: msg }))}
                onGenerateMessage={() => useGitHubStore.getState().generateCommitMessage(input)}
                onRefresh={() => void useGitHubStore.getState().loadTab(input, 'status')}
              />
            )}
            {activeTab === 'checkpoints' && (
              <CheckpointsTab
                checkpoints={state.checkpoints}
                loading={state.loading}
                onCreate={(name, description) => requestConfirm('Criar checkpoint', name, () => useGitHubStore.getState().createCheckpoint({ ...input, name, description }))}
                onRestore={(id, name) => requestConfirm('Restaurar checkpoint', name, () => useGitHubStore.getState().restoreCheckpoint({ ...input, checkpointId: id }))}
                onDelete={(id) => void useGitHubStore.getState().deleteCheckpoint(workspaceId, id)}
                onRefresh={() => void useGitHubStore.getState().loadTab(input, 'checkpoints')}
              />
            )}
            {activeTab === 'repos' && (
              <ReposTab
                connectedRepositories={state.connectedRepositories}
                rootPath={rootPath}
                workspaceId={workspaceId}
                status={status}
                onConnect={(fullName) => requestConfirm('Conectar repositório', fullName, () => useGitHubStore.getState().connectRepository({ ...input, fullName }))}
                onPush={() => requestConfirm('Push para GitHub', 'Enviar branch atual para o remoto.', () => useGitHubStore.getState().push(input))}
                onRefresh={() => void useGitHubStore.getState().loadTab(input, 'repos')}
              />
            )}
            {activeTab === 'branches' && (
              <BranchesTab
                branches={state.branches}
                status={status}
                onCheckout={(name) => requestConfirm('Checkout branch', name, () => useGitHubStore.getState().checkoutBranch({ ...input, name }))}
                onCreate={(name) => requestConfirm('Criar branch', name, () => useGitHubStore.getState().createBranch({ ...input, name, checkout: true }))}
                onRefresh={() => void useGitHubStore.getState().loadTab(input, 'branches')}
              />
            )}
            {activeTab === 'prs' && (
              <PullRequestsTab
                prs={state.pullRequests}
                status={status}
                loading={state.loading}
                input={input}
                onCreate={(title, body) => requestConfirm('Criar pull request', title, () => useGitHubStore.getState().createPullRequest({ ...input, title, body }))}
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
                onCreate={(release) => requestConfirm('Criar release', release.tagName, () => useGitHubStore.getState().createRelease({ ...input, ...release }))}
                onRefresh={() => void useGitHubStore.getState().loadTab(input, 'releases')}
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
          <button type="button" className="ghost-btn" onClick={() => setConfirmAction(null)}>Cancel</button>
          <button type="button" className="primary-btn" disabled={state.loading} onClick={() => { const c = confirmAction; setConfirmAction(null); void c.run() }}>Confirm</button>
        </div>
      ) : null}
    </section>
  )
}

// ─── Status ────────────────────────────────────────────────────────────────

function StatusTab({ loading, status, onStageAll, onCommit, onGenerateMessage, onRefresh }: {
  loading: boolean
  status: GitHubWorkspaceStatus | null
  onStageAll: () => void
  onCommit: (msg: string) => void
  onGenerateMessage: () => Promise<string>
  onRefresh: () => void
}): ReactElement {
  const [message, setMessage] = useState('')
  const [autoGenerate, setAutoGenerate] = useState(false)
  const [generating, setGenerating] = useState(false)
  const commitMessage = message.trim()
  const totalFiles = (status?.staged ?? 0) + (status?.modified ?? 0) + (status?.untracked ?? 0)

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
            <TrendingUp size={14} aria-hidden="true" />
            <span>{status?.branch ?? 'no branch'}</span>
          </div>
          <button type="button" className="gh-icon-btn" title="Refresh" onClick={onRefresh}><RefreshCw size={13} aria-hidden="true" /></button>
        </div>
        <div className="github-tab-sep" />
        <div className="github-stats-row github-stats-2">
          <StatCard label="Last Commit" value={status?.lastCommitRelative ?? 'never'} />
          <StatCard label="Last Push" value={status?.lastPushRelative ?? 'no remote'} />
        </div>
        <div className="github-stats-row github-stats-3">
          <StatCard label="Staged" value={String(status?.staged ?? 0)} />
          <StatCard label="Modified" value={String(status?.modified ?? 0)} />
          <StatCard label="Untracked" value={String(status?.untracked ?? 0)} accent="blue" />
        </div>
      </div>
      <div className="github-status-footer">
        <button type="button" className="github-stage-all-btn" disabled={loading} onClick={onStageAll}>
          Stage All{totalFiles > 0 ? ` (${totalFiles} files)` : ''}
        </button>
        <label className="github-auto-row">
          <input type="checkbox" checked={autoGenerate} disabled={generating || loading} onChange={(e) => void handleAutoGenerate(e.target.checked)} />
          <span>Auto-generate commit message with Claude</span>
        </label>
        <textarea className="github-commit-ta" value={message} placeholder="Commit message..." onChange={(e) => setMessage(e.target.value)} />
        <button type="button" className="github-commit-submit" disabled={loading || !commitMessage} onClick={() => onCommit(commitMessage)}>
          Commit
        </button>
      </div>
    </div>
  )
}

// ─── Checkpoints ───────────────────────────────────────────────────────────

function CheckpointsTab({ checkpoints, loading, onCreate, onRestore, onDelete, onRefresh }: {
  checkpoints: Array<{ id: string; name: string; description: string | null; branch: string | null; createdAt: number }>
  loading: boolean
  onCreate: (name: string, description?: string) => void
  onRestore: (id: string, name: string) => void
  onDelete: (id: string) => void
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
            <span>Checkpoints ({checkpoints.length})</span>
          </div>
          <button type="button" className="gh-icon-btn" title="Refresh" onClick={onRefresh}><RefreshCw size={13} aria-hidden="true" /></button>
        </div>
        <div className="github-tab-sep" />
        {checkpoints.length === 0 ? (
          <div className="github-empty-center">
            <Clock size={40} aria-hidden="true" />
            <strong>No checkpoints yet</strong>
            <span>Create one below to snapshot your project state</span>
          </div>
        ) : (
          <div className="github-list">
            {checkpoints.map((cp) => (
              <div key={cp.id} className="github-list-row">
                <div className="github-list-row-main">
                  <strong>{cp.name}</strong>
                  <span>{cp.branch ?? 'no branch'} · {formatDate(cp.createdAt)}</span>
                  {cp.description ? <p>{cp.description}</p> : null}
                </div>
                <div className="github-list-row-actions">
                  <button type="button" className="ghost-btn" onClick={() => onRestore(cp.id, cp.name)}>Restore</button>
                  <button type="button" className="ghost-btn" onClick={() => onDelete(cp.id)}>Delete</button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
      <div className="github-checkpoints-footer">
        <input value={name} placeholder="Checkpoint name (e.g. before-refactor)..." onChange={(e) => setName(e.target.value)} />
        <input value={description} placeholder="Description (optional)..." onChange={(e) => setDescription(e.target.value)} />
        <button type="button" className="github-full-primary-btn" disabled={loading || !trimmedName} onClick={() => { onCreate(trimmedName, description.trim() || undefined); setName(''); setDescription('') }}>
          Create Checkpoint
        </button>
      </div>
    </div>
  )
}

// ─── Repos ─────────────────────────────────────────────────────────────────

function ReposTab({ connectedRepositories, rootPath, workspaceId, status, onConnect, onPush, onRefresh }: {
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
          <div className="github-tab-header-title"><span>Repository</span></div>
          <button type="button" className="gh-icon-btn" title="Refresh" onClick={onRefresh}><RefreshCw size={13} aria-hidden="true" /></button>
        </div>
        <div className="github-tab-sep" />

        <div className="github-repo-dir-card">
          <span className="github-repo-dir-label">Project Directory</span>
          <span className="github-repo-dir-path">{rootPath}</span>
        </div>

        <div className="github-git-status-card">
          {isGitRepo ? (
            <>
              <div className="github-git-status-title">
                <span className="github-git-check">✓</span>
                <strong>Git Repository</strong>
              </div>
              <div className="github-git-status-lines">
                {branch ? <span>Branch: <strong className="github-cyan">{branch}</strong></span> : null}
                {!repo?.fullName && !repo?.remoteUrl ? <span className="github-amber">No GitHub remote</span> : null}
                {status?.hasUncommittedChanges ? <span className="github-amber">Uncommitted changes</span> : null}
              </div>
            </>
          ) : (
            <span className="github-muted">Not a Git repository</span>
          )}
        </div>

        <button type="button" className="github-push-btn" onClick={onPush}>
          Push to GitHub
        </button>

        <GitignoreRow rootPath={rootPath} workspaceId={workspaceId} />

        <div className="github-connected-header">
          <span>Connected Repositories</span>
          <button type="button" className="github-text-btn" onClick={() => setShowConnectForm((v) => !v)}>+ Connect</button>
        </div>
        {showConnectForm ? (
          <div className="github-connect-form">
            <input value={connectInput} placeholder="owner/repo" onChange={(e) => setConnectInput(e.target.value)} />
            <button type="button" className="ghost-btn" disabled={!connectInput.trim()} onClick={() => { onConnect(connectInput.trim()); setConnectInput(''); setShowConnectForm(false) }}>Connect</button>
          </div>
        ) : null}
        {connectedRepositories.length === 0 ? (
          <span className="github-empty-inline">No repositories connected for issue sync and other features.</span>
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

function GitignoreRow({ rootPath, workspaceId }: { rootPath: string; workspaceId: string }): ReactElement {
  const [info, setInfo] = useState<{ exists: boolean; lines: number } | null>(null)

  useEffect(() => {
    window.oxe.fs.readFile({ workspaceId, rootPath, relativePath: '.gitignore' }).then((result) => {
      const lines = result.content.split('\n').filter((l) => l.trim().length > 0).length
      setInfo({ exists: true, lines })
    }).catch(() => setInfo({ exists: false, lines: 0 }))
  }, [rootPath])

  if (!info) return <div className="github-gitignore-row"><span>.gitignore</span><span className="github-muted">loading...</span></div>

  return (
    <div className="github-gitignore-row">
      <span>.gitignore</span>
      {info.exists ? (
        <>
          <span className="github-gitignore-exists">exists</span>
          <div className="github-gitignore-right">
            <span className="github-muted">{info.lines} lines</span>
            <button type="button" className="ghost-btn github-edit-btn">Edit <ChevronDown size={11} aria-hidden="true" /></button>
          </div>
        </>
      ) : (
        <span className="github-muted">not found</span>
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
          <div className="github-tab-header-title"><span>Branches</span></div>
          <div className="github-tab-header-actions">
            <button type="button" className="gh-icon-btn" title="Refresh" onClick={onRefresh}><RefreshCw size={13} aria-hidden="true" /></button>
            <button type="button" className="github-outline-btn" onClick={() => setShowCreate((v) => !v)}>+ New Branch</button>
          </div>
        </div>
        <div className="github-tab-sep" />

        {repoName ? (
          <div className="github-repo-badge">
            <Link2 size={13} aria-hidden="true" />
            <span>{repoName}</span>
            {detected ? <span className="github-detected">(detected)</span> : null}
          </div>
        ) : null}

        {showCreate ? (
          <div className="github-connect-form">
            <input value={newName} placeholder="new-branch-name" autoFocus onChange={(e) => setNewName(e.target.value)} />
            <button type="button" className="ghost-btn" disabled={!newName.trim()} onClick={() => { onCreate(newName.trim()); setNewName(''); setShowCreate(false) }}>Create</button>
            <button type="button" className="ghost-btn" onClick={() => setShowCreate(false)}>Cancel</button>
          </div>
        ) : null}

        <div className="github-list">
          {branches.map((branch) => (
            <div key={`${branch.remote ? 'r' : 'l'}-${branch.name}`} className={`github-branch-row${branch.current ? ' current' : ''}`}>
              <div className="github-branch-left">
                <TrendingUp size={13} aria-hidden="true" />
                <div className="github-branch-info">
                  <strong>{branch.name}</strong>
                  {branch.sha ? <span className="github-sha-text">{branch.sha}</span> : null}
                </div>
              </div>
              <div className="github-branch-right">
                {branch.isProtected ? <span className="github-protected-badge">Protected</span> : null}
                {branch.current ? (
                  <span className="github-current-badge">current</span>
                ) : (
                  <button type="button" className="ghost-btn github-branch-action-btn" onClick={() => onCheckout(branch.name)}>Checkout</button>
                )}
              </div>
            </div>
          ))}
          {branches.length === 0 ? <div className="github-empty">No branches found.</div> : null}
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
            <button type="button" className="github-back-btn" onClick={() => setSelected(null)}><ArrowLeft size={15} aria-hidden="true" /></button>
            <span className="github-detail-title">#{selected.number} {selected.title}</span>
          </div>
          <div className="github-tab-sep" />
          <div className="github-pr-meta-row">
            <span className={`github-pr-state-badge ${selected.state.toLowerCase()}`}>{selected.state}</span>
            <span className="github-pr-branches-text">{selected.headRefName ?? '?'} {'→'} {selected.baseRefName ?? 'main'}</span>
          </div>
          {selected.author ? <div className="github-detail-line">Author: <strong>{selected.author}</strong></div> : null}
          {selected.createdAt ? <div className="github-detail-line">Created: <strong>{formatDate(selected.createdAt)}</strong></div> : null}
          {selected.body ? (
            <div className="github-detail-body-card">
              <pre className="github-detail-body-text">{selected.body}</pre>
            </div>
          ) : null}
        </div>
        <div className="github-detail-footer">
          {selected.url ? (
            <button type="button" className="github-view-gh-btn" onClick={() => window.open(selected.url ?? '', '_blank')}>
              View on GitHub <ExternalLink size={12} aria-hidden="true" />
            </button>
          ) : null}
        </div>
      </div>
    )
  }

  return (
    <div className="github-tab-layout">
      <div className="github-tab-scroll">
        <div className="github-tab-header">
          <div className="github-tab-header-title"><span>Pull Requests</span></div>
          <div className="github-tab-header-actions">
            <button type="button" className="gh-icon-btn" title="Refresh" onClick={onRefresh}><RefreshCw size={13} aria-hidden="true" /></button>
            <button type="button" className="github-outline-btn" onClick={() => repoName && window.open(`https://github.com/${repoName}/compare`, '_blank')}>+ New PR</button>
          </div>
        </div>
        <div className="github-tab-sep" />

        {repoName ? (
          <div className="github-repo-badge">
            <Link2 size={13} aria-hidden="true" />
            <span>{repoName}</span>
            {detected ? <span className="github-detected">(detected)</span> : null}
          </div>
        ) : null}

        <div className="github-filter-tabs">
          {(['open', 'closed', 'all'] as const).map((f) => (
            <button key={f} type="button" className={`github-filter-tab${filter === f ? ' active' : ''}`} onClick={() => void changeFilter(f)}>
              {f.charAt(0).toUpperCase() + f.slice(1)}
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
          {filtered.length === 0 ? <div className="github-empty">No pull requests found.</div> : null}
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
            <button type="button" className="github-back-btn" onClick={() => setSelectedOid(null)}><ArrowLeft size={15} aria-hidden="true" /></button>
            <code className="github-detail-sha">{selected?.shortOid ?? selectedOid.slice(0, 7)}</code>
          </div>
          <div className="github-tab-sep" />
          {!selected && loading ? <div className="github-empty">Loading commit...</div> : null}
          {selected ? <CommitDetailView details={selected} /> : null}
        </div>
      </div>
    )
  }

  return (
    <div className="github-tab-layout">
      <div className="github-tab-scroll">
        <div className="github-tab-header">
          <div className="github-tab-header-title"><span>Commits</span></div>
          <button type="button" className="gh-icon-btn" title="Refresh" onClick={onRefresh}><RefreshCw size={13} aria-hidden="true" /></button>
        </div>
        <div className="github-tab-sep" />

        {repoName ? (
          <div className="github-repo-badge">
            <Link2 size={13} aria-hidden="true" />
            <span>{repoName}</span>
            {detected ? <span className="github-detected">(detected)</span> : null}
          </div>
        ) : null}

        <div className="github-branch-select-row">
          <select className="github-branch-select" defaultValue="">
            <option value="">Default branch</option>
          </select>
          <ChevronDown size={13} className="github-select-chevron" aria-hidden="true" />
        </div>

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
          {commits.length === 0 ? <div className="github-empty">No commits found.</div> : null}
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
        <div>Author: <strong>{details.author ?? '-'}</strong></div>
        <div>Date: <strong>{formatDate(details.committedDate)}</strong></div>
        <div className="github-sha-line">SHA: <code>{details.oid}</code></div>
      </div>
      <div className="github-change-summary">
        <span className="github-addition">+{details.additions}</span>
        <span className="github-deletion">-{details.deletions}</span>
        <span>{details.files.length} changes</span>
      </div>
      <div className="github-changed-files-section">
        <strong className="github-changed-files-title">Changed Files ({details.files.length})</strong>
        {details.files.map((file) => (
          <div key={file.path} className="github-file-row">
            <span>{file.path}</span>
            <small>{file.binary ? 'binary' : <><span className="github-addition">+{file.additions}</span>{' '}<span className="github-deletion">-{file.deletions}</span></>}</small>
          </div>
        ))}
      </div>
      {details.url ? (
        <button type="button" className="github-view-gh-btn" onClick={() => window.open(details.url ?? '', '_blank')}>
          View on GitHub <ExternalLink size={12} aria-hidden="true" />
        </button>
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
            <button type="button" className="github-back-btn" onClick={() => setSelected(null)}><ArrowLeft size={15} aria-hidden="true" /></button>
            <span className="github-detail-title">{selected.name ?? selected.tagName}</span>
          </div>
          <div className="github-tab-sep" />
          <div className="github-release-tag-badge">{selected.tagName}</div>
          <div className="github-detail-meta-rows">
            {selected.publishedAt ? <div>Published: <strong>{formatDate(selected.publishedAt)}</strong></div> : null}
            <div>{selected.isDraft ? 'Draft' : selected.isPrerelease ? 'Pre-release' : 'Release'}</div>
          </div>
          {selected.url ? (
            <button type="button" className="github-view-gh-btn" onClick={() => window.open(selected.url ?? '', '_blank')}>
              View on GitHub <ExternalLink size={12} aria-hidden="true" />
            </button>
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
            <button type="button" className="github-back-btn" onClick={() => setShowCreate(false)}><ArrowLeft size={15} aria-hidden="true" /></button>
            <span className="github-detail-title">New Release</span>
          </div>
          <div className="github-tab-sep" />
          <div className="github-release-form-body">
            <label>Tag<input value={tagName} placeholder="v1.0.0" onChange={(e) => setTagName(e.target.value)} /></label>
            <label>Title (optional)<input value={title} placeholder="Release title" onChange={(e) => setTitle(e.target.value)} /></label>
            <label>Release Notes (optional)<textarea value={notes} placeholder="Describe the release..." onChange={(e) => setNotes(e.target.value)} /></label>
            <div className="github-check-row">
              <label><input type="checkbox" checked={draft} onChange={(e) => setDraft(e.target.checked)} /> Draft</label>
              <label><input type="checkbox" checked={prerelease} onChange={(e) => setPrerelease(e.target.checked)} /> Pre-release</label>
            </div>
            <button type="button" className="github-full-primary-btn" disabled={loading || !tagName.trim()} onClick={() => onCreate({ tagName: tagName.trim(), title: title.trim() || undefined, notes: notes.trim() || undefined, draft, prerelease, generateNotes: !notes.trim() })}>
              Create Release
            </button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="github-tab-layout">
      <div className="github-tab-scroll">
        <div className="github-tab-header">
          <div className="github-tab-header-title"><span>Releases</span></div>
          <div className="github-tab-header-actions">
            <button type="button" className="gh-icon-btn" title="Refresh" onClick={onRefresh}><RefreshCw size={13} aria-hidden="true" /></button>
            <button type="button" className="github-outline-btn" onClick={() => setShowCreate(true)}>+ New Release</button>
          </div>
        </div>
        <div className="github-tab-sep" />

        {repoName ? (
          <div className="github-repo-badge">
            <Link2 size={13} aria-hidden="true" />
            <span>{repoName}</span>
            {detected ? <span className="github-detected">(detected)</span> : null}
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
          {releases.length === 0 ? <div className="github-empty">No releases found.</div> : null}
        </div>
      </div>
    </div>
  )
}

// ─── Settings ──────────────────────────────────────────────────────────────

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
          <div className="github-tab-header-title"><span>Settings</span></div>
          <button type="button" className="gh-icon-btn" title="Refresh" onClick={onRefresh}><RefreshCw size={13} aria-hidden="true" /></button>
        </div>
        <div className="github-tab-sep" />

        <div className="github-settings-card">
          <div className="github-settings-card-header">
            <Github size={20} aria-hidden="true" />
            <div>
              <strong>GitHub Integration</strong>
              <span>Sync issues with GitHub repositories</span>
            </div>
          </div>

          {isConnected && username ? (
            <div className="github-user-row">
              <div className="github-user-avatar">{username.slice(0, 1).toUpperCase()}</div>
              <div className="github-user-info">
                <strong>{username}</strong>
                <span>@{username}</span>
              </div>
              <span className="github-connected-badge">✓ Connected</span>
            </div>
          ) : (
            <div className="github-not-connected-row">
              <span>{cli?.available ? 'Not authenticated — run gh auth login' : 'GitHub CLI not installed'}</span>
              <button type="button" className="ghost-btn" onClick={() => onRunCommand('gh auth login')}>
                <Terminal size={12} aria-hidden="true" />
                gh auth login
              </button>
            </div>
          )}

          <div className="github-settings-repos-section">
            <div className="github-settings-repos-header">
              <span>Repositories</span>
              <button type="button" className="github-text-btn">+ Add repository</button>
            </div>
            {connectedRepositories.length === 0 ? (
              <div className="github-settings-repos-empty">No repositories connected. Add one to start syncing issues.</div>
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
                Using GitHub CLI for authentication. Run <code>gh auth status</code> to check.
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

  const copyCmd = (cmd: string): void => { void navigator.clipboard?.writeText(cmd) }

  return (
    <div className="github-cli-setup">
      <AlertTriangle size={28} aria-hidden="true" />
      <h3>{isMissing ? 'GitHub CLI Required' : 'Authentication Required'}</h3>
      <p>
        {isMissing
          ? 'Install the GitHub CLI to use PRs, Releases, and more GitHub features.'
          : 'You need to authenticate with GitHub before using this feature.'}
      </p>

      {isMissing ? (
        <div className="github-setup-block">
          <span className="github-setup-block-label">Install GitHub CLI</span>
          {installCmds.map((cmd) => (
            <div key={cmd} className="github-setup-cmd-row">
              <code>{cmd}</code>
              <button type="button" className="ghost-btn" title="Copy" onClick={() => copyCmd(cmd)}><Copy size={12} aria-hidden="true" /></button>
            </div>
          ))}
          <a className="github-setup-link" href="https://cli.github.com" target="_blank" rel="noreferrer">
            <ExternalLink size={12} aria-hidden="true" />
            cli.github.com
          </a>
        </div>
      ) : null}

      <div className="github-setup-block">
        <span className="github-setup-block-label">Authenticate</span>
        <div className="github-setup-cmd-row">
          <code>gh auth login</code>
          <button type="button" className="primary-btn" onClick={() => onRunCommand('gh auth login')}>
            <Terminal size={12} aria-hidden="true" />
            Run
          </button>
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
        if (!cancelled) setError(err instanceof Error ? err.message : 'Terminal error')
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

  if (error) return <div className="github-terminal-error">{error}</div>
  if (!paneId || !running) return <div className="github-terminal-loading"><Terminal size={12} aria-hidden="true" /><span>Starting terminal…</span></div>

  return (
    <div className="github-terminal-embed">
      <div className="github-terminal-header">
        <Terminal size={12} aria-hidden="true" />
        <span>Terminal</span>
        <button type="button" className="gh-icon-btn" title="Close" onClick={onDismiss}>×</button>
      </div>
      <div className="github-terminal-body">
        <TerminalView
          paneId={paneId}
          isRunning={running}
          onInput={(data) => { void window.oxe.terminal.write({ paneId, data }) }}
          onResize={(cols, rows) => { void window.oxe.terminal.resize({ paneId, cols, rows }) }}
          onExit={() => setRunning(false)}
        />
      </div>
    </div>
  )
}

// ─── Shared ─────────────────────────────────────────────────────────────────

function StatCard({ label, value, accent }: { label: string; value: string; accent?: 'blue' | 'green' | 'amber' }): ReactElement {
  return (
    <div className={`github-stat-card${accent ? ` github-stat-${accent}` : ''}`}>
      <span className="github-stat-label">{label}</span>
      <strong className="github-stat-value">{value}</strong>
    </div>
  )
}

function formatDate(value: string | number | null | undefined): string {
  if (!value) return '-'
  const date = typeof value === 'number' ? new Date(value) : new Date(value)
  if (Number.isNaN(date.getTime())) return String(value)
  return date.toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' })
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
