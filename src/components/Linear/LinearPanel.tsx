import { ExternalLink, GitBranch, KeyRound, RefreshCw, Search, X } from 'lucide-react'
import { useEffect, useState, type ReactElement } from 'react'
import type { LinearIssue, LinearIssueScope } from '../../../shared/types/linear'
import { useLinearStore } from '../../store/linear.store'

interface LinearPanelProps {
  workspaceId: string | null
  rootPath: string | null
  onClose: () => void
}

const SCOPES: { id: LinearIssueScope; label: string }[] = [
  { id: 'assigned', label: 'Assigned to me' },
  { id: 'created', label: 'Created by me' },
  { id: 'team', label: 'Team' }
]

/**
 * #4 · Linear issues/board with "open a worktree for this issue". The API key
 * lives in the main process (safeStorage) and is never sent back here.
 */
export function LinearPanel({ onClose, rootPath, workspaceId }: LinearPanelProps): ReactElement {
  const state = useLinearStore()
  const [apiKeyDraft, setApiKeyDraft] = useState('')
  const [busyIssueId, setBusyIssueId] = useState<string | null>(null)

  useEffect(() => {
    void useLinearStore.getState().loadStatus()
  }, [])

  const connected = state.status?.connected === true

  const handleWorktree = async (issue: LinearIssue): Promise<void> => {
    if (!workspaceId || !rootPath) return
    setBusyIssueId(issue.id)
    await state.createWorktree({ workspaceId, rootPath, issueId: issue.id })
    setBusyIssueId(null)
  }

  return (
    <div className="linear-backdrop" role="presentation" onMouseDown={onClose}>
      <section
        className="linear-panel"
        role="dialog"
        aria-modal="true"
        aria-label="Linear issues"
        data-testid="linear-panel"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="linear-header">
          <div className="linear-title">
            <strong>Linear</strong>
            {state.status?.viewerName ? <span>{state.status.viewerName}</span> : null}
            {state.status?.organization ? <span className="linear-org">{state.status.organization}</span> : null}
          </div>
          <div className="linear-header-actions">
            {connected ? (
              <>
                <button type="button" className="icon-button" aria-label="Refresh issues" onClick={() => void state.loadIssues()}>
                  <RefreshCw size={14} aria-hidden="true" />
                </button>
                <button type="button" className="linear-text-button" onClick={() => void state.disconnect()}>
                  Disconnect
                </button>
              </>
            ) : null}
            <button type="button" className="icon-button" aria-label="Close Linear" onClick={onClose}>
              <X size={14} aria-hidden="true" />
            </button>
          </div>
        </header>

        {!connected ? (
          <div className="linear-connect">
            <KeyRound size={28} aria-hidden="true" />
            <strong>Connect Linear</strong>
            <p>
              Create a personal API key at <code>linear.app → Settings → API</code> and paste it below. It is encrypted with your
              OS keychain and stays in the main process.
            </p>
            <div className="linear-connect-row">
              <input
                type="password"
                className="linear-input"
                placeholder="lin_api_…"
                value={apiKeyDraft}
                spellCheck={false}
                data-testid="linear-api-key"
                onChange={(event) => setApiKeyDraft(event.currentTarget.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && apiKeyDraft.trim()) void state.connect(apiKeyDraft.trim())
                }}
              />
              <button
                type="button"
                className="linear-primary-button"
                disabled={!apiKeyDraft.trim() || state.isConnecting}
                onClick={() => void state.connect(apiKeyDraft.trim())}
              >
                {state.isConnecting ? 'Connecting…' : 'Connect'}
              </button>
            </div>
            {state.status && !state.status.encrypted && state.status.connected ? (
              <small className="linear-warning">OS encryption is unavailable — the key is stored unencrypted.</small>
            ) : null}
          </div>
        ) : (
          <>
            <div className="linear-toolbar">
              {SCOPES.map((scope) => (
                <button
                  key={scope.id}
                  type="button"
                  className={`linear-chip${state.scope === scope.id ? ' active' : ''}`}
                  onClick={() => state.setScope(scope.id)}
                >
                  {scope.label}
                </button>
              ))}
              {state.teams.length > 0 ? (
                <select
                  className="linear-select"
                  value={state.teamId ?? ''}
                  onChange={(event) => state.setTeam(event.currentTarget.value || null)}
                  aria-label="Filter by team"
                >
                  <option value="">All teams</option>
                  {state.teams.map((team) => (
                    <option key={team.id} value={team.id}>
                      {team.key} · {team.name}
                    </option>
                  ))}
                </select>
              ) : null}
              <label className="linear-completed-toggle">
                <input type="checkbox" checked={state.includeCompleted} onChange={() => state.toggleCompleted()} />
                Done
              </label>
              <div className="linear-search">
                <Search size={13} aria-hidden="true" />
                <input
                  className="linear-input"
                  placeholder="Filter issues…"
                  value={state.query}
                  spellCheck={false}
                  onChange={(event) => state.setQuery(event.currentTarget.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') void state.loadIssues()
                  }}
                />
              </div>
            </div>

            <div className="linear-body scrollbar-sleek">
              {state.isLoading ? <div className="linear-empty">Loading issues…</div> : null}
              {!state.isLoading && state.issues.length === 0 ? <div className="linear-empty">No issues match this filter.</div> : null}
              {state.issues.map((issue) => (
                <article key={issue.id} className="linear-issue" data-testid={`linear-issue-${issue.identifier}`}>
                  <div className="linear-issue-main">
                    <span className="linear-issue-id">{issue.identifier}</span>
                    <span className="linear-issue-title">{issue.title}</span>
                  </div>
                  <div className="linear-issue-meta">
                    <span className="linear-issue-state" style={issue.stateColor ? { color: issue.stateColor } : undefined}>
                      {issue.stateName}
                    </span>
                    <span>{issue.priorityLabel}</span>
                    {issue.assigneeName ? <span>{issue.assigneeName}</span> : null}
                  </div>
                  <div className="linear-issue-actions">
                    <button
                      type="button"
                      className="linear-text-button"
                      title={`git worktree on ${issue.branchName}`}
                      disabled={!workspaceId || !rootPath || busyIssueId === issue.id}
                      onClick={() => void handleWorktree(issue)}
                    >
                      <GitBranch size={12} aria-hidden="true" />
                      {busyIssueId === issue.id ? 'Creating…' : 'Worktree'}
                    </button>
                    <button
                      type="button"
                      className="icon-button"
                      aria-label={`Open ${issue.identifier} in Linear`}
                      onClick={() => window.open(issue.url, '_blank', 'noopener')}
                    >
                      <ExternalLink size={12} aria-hidden="true" />
                    </button>
                  </div>
                </article>
              ))}
            </div>
          </>
        )}

        {state.error ? <div className="linear-error" role="alert">{state.error}</div> : null}
        {state.notice ? (
          <div className="linear-notice" role="status" onClick={() => state.clearNotice()}>
            {state.notice}
          </div>
        ) : null}
      </section>
    </div>
  )
}
