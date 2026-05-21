import { Clock, DollarSign, GitFork, History, MessageSquare, RotateCw, X, Zap } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState, type ReactElement } from 'react'
import type { AgentProvider } from '../../../shared/types/agent'
import type { SessionSummary } from '../../../shared/types/session'
import { useAgentStore } from '../../store/agent.store'
import { selectSessions, useSessionStore } from '../../store/session.store'
import { useWorkspaceStore } from '../../store/workspace.store'

interface HistoryPanelProps {
  workspaceId: string
  workspaceRootPath: string
  activePaneId: string | null
  onClose: () => void
}

const PROVIDER_LABELS: Record<AgentProvider, string> = {
  claude: 'Claude',
  codex: 'Codex',
  copilot: 'Copilot',
  'gh-copilot': 'GH Copilot',
  gemini: 'Gemini',
  cursor: 'Cursor',
  custom: 'Custom'
}

// Provider → resume CLI flag for the active pane. Providers without a known
// resume command get a null entry and the Resume button stays disabled.
const RESUME_COMMANDS: Partial<Record<AgentProvider, (id: string) => string>> = {
  claude: (id) => `claude --resume ${id}`,
  codex:  (id) => `codex resume ${id}`,
  copilot: (id) => `copilot --resume=${id}`,
  'gh-copilot': (id) => `copilot --resume=${id}`
}

export function HistoryPanel({ workspaceId, workspaceRootPath, activePaneId, onClose }: HistoryPanelProps): ReactElement {
  // Provider tabs reflect the agents actually configured in this OXESpace
  // install (deduped by parentProvider/provider). Sessions for providers
  // without a usage backend simply return an empty list — the user still
  // sees the tab so they can confirm "no sessions yet" instead of
  // discovering missing tabs through trial and error.
  const allProfiles = useAgentStore((s) => s.allProfiles)
  const providers = useMemo<AgentProvider[]>(() => {
    const set = new Set<AgentProvider>()
    for (const p of allProfiles) set.add(p.parentProvider ?? p.provider)
    if (set.size === 0) set.add('claude')
    return [...set]
  }, [allProfiles])

  const [provider, setProvider] = useState<AgentProvider>(providers[0])
  // Keep `provider` valid if the available tabs change (e.g., new agent added).
  useEffect(() => {
    if (!providers.includes(provider)) setProvider(providers[0])
  }, [providers, provider])

  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [forkTarget, setForkTarget] = useState<SessionSummary | null>(null)
  const [forkLabel, setForkLabel] = useState('')
  const [forkMessageCount, setForkMessageCount] = useState<string>('') // empty = all

  const sessionsSelector = useCallback(selectSessions(workspaceId, provider), [workspaceId, provider])
  const sessions = useSessionStore(sessionsSelector)
  const workspaceName = useWorkspaceStore((s) => s.workspaces.find((w) => w.id === workspaceId)?.name ?? null)
  const loadingKey = `${workspaceId}|${provider}`
  const loading = useSessionStore((s) => s.loading[loadingKey] === true)
  const loadSessions = useSessionStore((s) => s.load)
  const forkSession = useSessionStore((s) => s.fork)

  useEffect(() => {
    void loadSessions(workspaceId, workspaceRootPath, provider)
  }, [workspaceId, workspaceRootPath, provider, loadSessions])

  const sorted = useMemo(() => [...sessions].sort((a, b) => b.lastUpdatedMs - a.lastUpdatedMs), [sessions])

  const handleResume = async (session: SessionSummary): Promise<void> => {
    setError(null)
    if (!activePaneId) {
      setError('Select a pane before resuming a session.')
      return
    }
    const buildCmd = RESUME_COMMANDS[provider]
    if (!buildCmd) {
      setError(`Resume is not supported for ${PROVIDER_LABELS[provider]}.`)
      return
    }
    setBusy(true)
    try {
      const cliFlag = buildCmd(session.sessionId)
      await window.oxe.terminal.stop({ paneId: activePaneId })
      await window.oxe.terminal.start({ paneId: activePaneId, workspaceId, agentCommand: cliFlag })
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  const handleForkSubmit = async (): Promise<void> => {
    if (!forkTarget) return
    setError(null)
    setBusy(true)
    try {
      const count = forkMessageCount.trim() === '' ? -1 : Number.parseInt(forkMessageCount, 10)
      if (!Number.isFinite(count) || (count !== -1 && count <= 0)) {
        throw new Error('Message count must be positive (or empty for all).')
      }
      await forkSession({
        workspaceId,
        workspaceRootPath,
        provider,
        parentSessionId: forkTarget.sessionId,
        messageCount: count,
        label: forkLabel.trim() || undefined
      })
      setForkTarget(null)
      setForkLabel('')
      setForkMessageCount('')
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  const canResume = provider in RESUME_COMMANDS

  return (
    <div className="history-panel-backdrop" role="presentation" onMouseDown={onClose}>
      <section
        className="history-panel"
        role="dialog"
        aria-modal="true"
        aria-label="Session history"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="history-panel-header">
          <div className="history-panel-title">
            <History size={14} aria-hidden="true" />
            <strong>Session history</strong>
            <span className="history-panel-count">{sorted.length}</span>
          </div>
          <div className="history-panel-actions">
            <button
              type="button"
              className="icon-button"
              aria-label="Refresh"
              disabled={loading}
              onClick={() => void loadSessions(workspaceId, workspaceRootPath, provider)}
            >
              <RotateCw size={13} className={loading ? 'usage-spin' : ''} aria-hidden="true" />
            </button>
            <button type="button" className="icon-button" aria-label="Close" onClick={onClose}>
              <X size={14} aria-hidden="true" />
            </button>
          </div>
        </header>

        <nav className="history-panel-providers" aria-label="Provider tabs">
          {providers.map((p) => (
            <button
              key={p}
              type="button"
              className={`history-provider-tab${provider === p ? ' active' : ''}`}
              onClick={() => setProvider(p)}
            >
              {PROVIDER_LABELS[p]}
            </button>
          ))}
        </nav>

        {error ? <div className="history-panel-error">{error}</div> : null}

        {forkTarget ? (
          <div className="history-fork-form">
            <header>
              <GitFork size={13} aria-hidden="true" />
              <strong>Fork session</strong>
              <span className="history-fork-source">{forkTarget.modelId ?? 'unknown'} · {forkTarget.requestCount} requests</span>
            </header>
            <div className="history-fork-field">
              <label htmlFor="fork-label">Label</label>
              <input
                id="fork-label"
                placeholder="e.g. exploration-x"
                value={forkLabel}
                onChange={(event) => setForkLabel(event.currentTarget.value)}
                disabled={busy}
              />
            </div>
            <div className="history-fork-field">
              <label htmlFor="fork-count">Keep how many messages</label>
              <input
                id="fork-count"
                type="number"
                placeholder={`empty = all (${forkTarget.requestCount})`}
                value={forkMessageCount}
                onChange={(event) => setForkMessageCount(event.currentTarget.value)}
                disabled={busy}
              />
            </div>
            <div className="history-fork-actions">
              <button type="button" className="ghost-btn" onClick={() => { setForkTarget(null); setError(null) }} disabled={busy}>
                Cancel
              </button>
              <button type="button" className="primary-btn" onClick={() => void handleForkSubmit()} disabled={busy}>
                Fork
              </button>
            </div>
          </div>
        ) : null}

        <div className="history-panel-list">
          {sorted.length === 0 && !loading ? (
            <div className="history-panel-empty">
              <History size={32} aria-hidden="true" />
              <strong>No sessions for {PROVIDER_LABELS[provider]}</strong>
              <span>
                {canResume
                  ? 'Start a session in this workspace to see it here.'
                  : `Resume is not yet supported for ${PROVIDER_LABELS[provider]}.`}
              </span>
            </div>
          ) : (
            sorted.map((session) => (
              <SessionRow
                key={session.sessionId}
                session={session}
                workspaceName={workspaceName}
                busy={busy}
                canResume={canResume}
                onResumeHere={() => void handleResume(session)}
                onFork={() => { setForkTarget(session); setForkMessageCount(''); setForkLabel('') }}
              />
            ))
          )}
        </div>

        <footer className="history-panel-footer">
          Sessions are read from <code>~/.claude/projects/</code>, <code>~/.codex/sessions/</code> and <code>~/.copilot/session-store.db</code>.
          Forks save a truncated JSONL and record the origin in the local DB.
        </footer>
      </section>
    </div>
  )
}

interface SessionRowProps {
  session: SessionSummary
  workspaceName: string | null
  busy: boolean
  canResume: boolean
  onResumeHere: () => void
  onFork: () => void
}

function SessionRow({ busy, canResume, onFork, onResumeHere, session, workspaceName }: SessionRowProps): ReactElement {
  // Visible title falls back through: fork label → first user message preview → model id.
  // This is the change requested in Wave 4 (item 5): show what the session is
  // about, not just its model.
  const title = session.label ?? session.firstMessagePreview ?? formatModel(session.modelId)
  // Prefer the human workspace name; fall back to the trimmed cwd for sessions
  // whose workspace can't be resolved (e.g. stale rows from a deleted workspace).
  const workspaceLabel = workspaceName ?? (session.workspaceRootPath ? formatWorkspacePath(session.workspaceRootPath) : null)
  return (
    <div className={`history-session-row${session.isFork ? ' is-fork' : ''}`}>
      <div className="history-session-main">
        <div className="history-session-title">
          {session.isFork ? <GitFork size={11} aria-hidden="true" /> : null}
          <strong title={session.sessionId}>{title}</strong>
          {session.isFork ? <span className="history-fork-tag">fork</span> : null}
        </div>
        {session.firstMessagePreview && !session.label ? (
          <div className="history-session-subtitle">
            {formatModel(session.modelId)}
            {workspaceLabel ? ` · ${workspaceLabel}` : ''}
          </div>
        ) : workspaceLabel ? (
          <div className="history-session-subtitle">{workspaceLabel}</div>
        ) : null}
        <div className="history-session-meta">
          <span><MessageSquare size={10} aria-hidden="true" /> {session.requestCount} req</span>
          <span><Zap size={10} aria-hidden="true" /> {formatTokens(session.totalTokens)}</span>
          <span><DollarSign size={10} aria-hidden="true" /> ${session.estimatedCostUsd.toFixed(2)}</span>
          <span><Clock size={10} aria-hidden="true" /> {formatRelative(session.lastUpdatedMs)}</span>
        </div>
      </div>
      <div className="history-session-actions">
        <button type="button" className="ghost-btn small" onClick={onFork} disabled={busy || session.provider !== 'claude'} title="Fork session">
          <GitFork size={11} aria-hidden="true" /> Fork
        </button>
        <button
          type="button"
          className="primary-btn small"
          onClick={onResumeHere}
          disabled={busy || !canResume}
          title={canResume ? 'Resume in the active pane' : 'Resume not supported for this provider'}
        >
          Resume
        </button>
      </div>
    </div>
  )
}

function formatModel(modelId: string | null): string {
  if (!modelId) return 'unknown model'
  return modelId.replace(/^claude-/, '').replace(/^gpt-/, 'GPT-')
}

function formatTokens(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}k`
  return String(value)
}

function formatRelative(ms: number): string {
  const diffSec = Math.max(0, Math.floor((Date.now() - ms) / 1000))
  if (diffSec < 60) return `${diffSec}s ago`
  const diffMin = Math.floor(diffSec / 60)
  if (diffMin < 60) return `${diffMin}min ago`
  const diffH = Math.floor(diffMin / 60)
  if (diffH < 24) return `${diffH}h ago`
  return `${Math.floor(diffH / 24)}d ago`
}

function formatWorkspacePath(path: string): string {
  const parts = path.split(/[\\/]/).filter(Boolean)
  return parts.slice(-2).join('/') || path
}
