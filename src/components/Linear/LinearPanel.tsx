import { ExternalLink, GitBranch, KeyRound, RefreshCw, Search, X } from 'lucide-react'
import { useEffect, useState, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import { ToolPanel, Button, EmptyState, Notice } from '../../ui'
import type { LinearIssue, LinearIssueScope } from '../../../shared/types/linear'
import { useLinearStore } from '../../store/linear.store'
import { openExternalLink } from '../../lib/externalLinks'

interface LinearPanelProps {
  workspaceId: string | null
  rootPath: string | null
  onClose: () => void
}

const SCOPES: LinearIssueScope[] = ['assigned', 'created', 'team']

/**
 * #4 · Linear issues/board with "open a worktree for this issue". The API key
 * lives in the main process (safeStorage) and is never sent back here.
 */
export function LinearPanel({ onClose, rootPath, workspaceId }: LinearPanelProps): ReactElement {
  const { t } = useTranslation('code')
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
    <ToolPanel
      className="linear-panel"
      label={t('linear.title')}
      data-testid="linear-panel" onClose={onClose}>
      <header className="linear-header">
        <div className="linear-title">
          <strong>Linear</strong>
          {state.status?.viewerName ? <span>{state.status.viewerName}</span> : null}
          {state.status?.organization ? <span className="linear-org">{state.status.organization}</span> : null}
        </div>
        <div className="linear-header-actions">
          {connected ? (
            <>
              <Button variant="ghost" size="sm" square aria-label={t('linear.refresh')} onClick={() => void state.loadIssues()}>
                <RefreshCw size={14} aria-hidden="true" />
              </Button>
              <button type="button" className="linear-text-button" onClick={() => void state.disconnect()}>
                {t('linear.disconnect')}
              </button>
            </>
          ) : null}
          <Button variant="ghost" size="sm" square aria-label={t('linear.close')} onClick={onClose}>
            <X size={14} aria-hidden="true" />
          </Button>
        </div>
      </header>

      {!connected ? (
        <div className="linear-connect">
          <KeyRound size={28} aria-hidden="true" />
          <strong>{t('linear.connectTitle')}</strong>
          <p>
            {t('linear.keyBefore')} <code>linear.app → Settings → API</code> {t('linear.keyAfter')}
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
              {state.isConnecting ? t('linear.connecting') : t('linear.connect')}
            </button>
          </div>
          {state.status && !state.status.encrypted && state.status.connected ? (
            <small className="linear-warning">{t('linear.unencrypted')}</small>
          ) : null}
        </div>
      ) : (
        <>
          <div className="linear-toolbar">
            {SCOPES.map((scope) => (
              <button
                key={scope}
                type="button"
                className={`linear-chip${state.scope === scope ? ' active' : ''}`}
                onClick={() => state.setScope(scope)}
              >
                {t(`linear.scopes.${scope}`)}
              </button>
            ))}
            {state.teams.length > 0 ? (
              <select
                className="linear-select"
                value={state.teamId ?? ''}
                onChange={(event) => state.setTeam(event.currentTarget.value || null)}
                aria-label={t('linear.filterTeam')}
              >
                <option value="">{t('linear.allTeams')}</option>
                {state.teams.map((team) => (
                  <option key={team.id} value={team.id}>
                    {team.key} · {team.name}
                  </option>
                ))}
              </select>
            ) : null}
            <label className="linear-completed-toggle">
              <input type="checkbox" checked={state.includeCompleted} onChange={() => state.toggleCompleted()} />
              {t('linear.done')}
            </label>
            <div className="linear-search">
              <Search size={14} aria-hidden="true" />
              <input
                className="linear-input"
                placeholder={t('linear.filter')}
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
            {state.isLoading ? <EmptyState compact title={t('linear.loading')} /> : null}
            {!state.isLoading && state.issues.length === 0 ? <EmptyState compact title={t('linear.empty')} /> : null}
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
                    title={t('linear.worktreeTitle', { branch: issue.branchName })}
                    disabled={!workspaceId || !rootPath || busyIssueId === issue.id}
                    onClick={() => void handleWorktree(issue)}
                  >
                    <GitBranch size={12} aria-hidden="true" />
                    {busyIssueId === issue.id ? t('linear.creating') : t('linear.worktree')}
                  </button>
                  <Button
                   
                    variant="ghost" size="sm" square
                    aria-label={t('linear.open', { id: issue.identifier })}
                    onClick={() => void openExternalLink(issue.url, { source: 'linear' })}
                  >
                    <ExternalLink size={12} aria-hidden="true" />
                  </Button>
                </div>
              </article>
            ))}
          </div>
        </>
      )}

      {state.error ? <Notice intent="danger" className="linear-error">{state.error}</Notice> : null}
      {state.notice ? (
        <div className="linear-notice" role="status" onClick={() => state.clearNotice()}>
          {state.notice}
        </div>
      ) : null}
    </ToolPanel>
  )
}
