import { Clock, DollarSign, GitFork, History, MessageSquare, RotateCw, X, Zap } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState, type ReactElement } from 'react'
import type { AgentProvider } from '../../../shared/types/agent'
import type { SessionSummary } from '../../../shared/types/session'
import { useAgentStore } from '../../store/agent.store'
import { selectSessions, useSessionStore } from '../../store/session.store'

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
  codex:  (id) => `codex resume ${id}`
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
      setError('Selecione um pane antes de retomar uma sessão.')
      return
    }
    const buildCmd = RESUME_COMMANDS[provider]
    if (!buildCmd) {
      setError(`Resume não é suportado para ${PROVIDER_LABELS[provider]}.`)
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
        throw new Error('Quantidade de mensagens deve ser positiva (ou vazio para tudo).')
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
        aria-label="Histórico de sessões"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="history-panel-header">
          <div className="history-panel-title">
            <History size={14} aria-hidden="true" />
            <strong>Histórico de sessões</strong>
            <span className="history-panel-count">{sorted.length}</span>
          </div>
          <div className="history-panel-actions">
            <button
              type="button"
              className="icon-button"
              aria-label="Atualizar"
              disabled={loading}
              onClick={() => void loadSessions(workspaceId, workspaceRootPath, provider)}
            >
              <RotateCw size={13} className={loading ? 'usage-spin' : ''} aria-hidden="true" />
            </button>
            <button type="button" className="icon-button" aria-label="Fechar" onClick={onClose}>
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
              <strong>Bifurcar sessão</strong>
              <span className="history-fork-source">{forkTarget.modelId ?? 'unknown'} · {forkTarget.requestCount} requests</span>
            </header>
            <div className="history-fork-field">
              <label htmlFor="fork-label">Rótulo</label>
              <input
                id="fork-label"
                placeholder="ex: exploração-x"
                value={forkLabel}
                onChange={(event) => setForkLabel(event.currentTarget.value)}
                disabled={busy}
              />
            </div>
            <div className="history-fork-field">
              <label htmlFor="fork-count">Manter quantas mensagens</label>
              <input
                id="fork-count"
                type="number"
                placeholder={`vazio = todas (${forkTarget.requestCount})`}
                value={forkMessageCount}
                onChange={(event) => setForkMessageCount(event.currentTarget.value)}
                disabled={busy}
              />
            </div>
            <div className="history-fork-actions">
              <button type="button" className="ghost-btn" onClick={() => { setForkTarget(null); setError(null) }} disabled={busy}>
                Cancelar
              </button>
              <button type="button" className="primary-btn" onClick={() => void handleForkSubmit()} disabled={busy}>
                Bifurcar
              </button>
            </div>
          </div>
        ) : null}

        <div className="history-panel-list">
          {sorted.length === 0 && !loading ? (
            <div className="history-panel-empty">
              <History size={32} aria-hidden="true" />
              <strong>Sem sessões para {PROVIDER_LABELS[provider]}</strong>
              <span>
                {canResume
                  ? 'Inicie uma sessão neste workspace para que ela apareça aqui.'
                  : `Resume ainda não é suportado para ${PROVIDER_LABELS[provider]}.`}
              </span>
            </div>
          ) : (
            sorted.map((session) => (
              <SessionRow
                key={session.sessionId}
                session={session}
                busy={busy}
                canResume={canResume}
                onResumeHere={() => void handleResume(session)}
                onFork={() => { setForkTarget(session); setForkMessageCount(''); setForkLabel('') }}
              />
            ))
          )}
        </div>

        <footer className="history-panel-footer">
          Sessões são lidas das pastas <code>~/.claude/projects/</code> e <code>~/.codex/sessions/</code>.
          Forks salvam um JSONL truncado e registram a origem no DB local.
        </footer>
      </section>
    </div>
  )
}

interface SessionRowProps {
  session: SessionSummary
  busy: boolean
  canResume: boolean
  onResumeHere: () => void
  onFork: () => void
}

function SessionRow({ busy, canResume, onFork, onResumeHere, session }: SessionRowProps): ReactElement {
  // Visible title falls back through: fork label → first user message preview → model id.
  // This is the change requested in Wave 4 (item 5): show what the session is
  // about, not just its model.
  const title = session.label ?? session.firstMessagePreview ?? formatModel(session.modelId)
  return (
    <div className={`history-session-row${session.isFork ? ' is-fork' : ''}`}>
      <div className="history-session-main">
        <div className="history-session-title">
          {session.isFork ? <GitFork size={11} aria-hidden="true" /> : null}
          <strong title={session.sessionId}>{title}</strong>
          {session.isFork ? <span className="history-fork-tag">fork</span> : null}
        </div>
        {session.firstMessagePreview && !session.label ? (
          <div className="history-session-subtitle">{formatModel(session.modelId)}</div>
        ) : null}
        <div className="history-session-meta">
          <span><MessageSquare size={10} aria-hidden="true" /> {session.requestCount} req</span>
          <span><Zap size={10} aria-hidden="true" /> {formatTokens(session.totalTokens)}</span>
          <span><DollarSign size={10} aria-hidden="true" /> ${session.estimatedCostUsd.toFixed(2)}</span>
          <span><Clock size={10} aria-hidden="true" /> {formatRelative(session.lastUpdatedMs)}</span>
        </div>
      </div>
      <div className="history-session-actions">
        <button type="button" className="ghost-btn small" onClick={onFork} disabled={busy || session.provider !== 'claude'} title="Bifurcar sessão">
          <GitFork size={11} aria-hidden="true" /> Fork
        </button>
        <button
          type="button"
          className="primary-btn small"
          onClick={onResumeHere}
          disabled={busy || !canResume}
          title={canResume ? 'Retomar no pane ativo' : 'Resume não suportado para este provider'}
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
  if (diffSec < 60) return `${diffSec}s atrás`
  const diffMin = Math.floor(diffSec / 60)
  if (diffMin < 60) return `${diffMin}min atrás`
  const diffH = Math.floor(diffMin / 60)
  if (diffH < 24) return `${diffH}h atrás`
  return `${Math.floor(diffH / 24)}d atrás`
}
