import { Activity, BarChart3, DollarSign, Layers, RefreshCw, X, Zap } from 'lucide-react'
import { useCallback, useEffect, useMemo, type ReactElement } from 'react'
import type { AgentProvider } from '../../../shared/types/agent'
import type { ContextUsageSnapshot } from '../../../shared/types/usage'
import { selectActiveSessionId, selectContextUsage, selectSessions, useUsageStore } from '../../store/usage.store'

interface ContextUsagePopoverProps {
  workspaceId: string
  workspaceRootPath: string
  provider: AgentProvider
  paneLabel: string
  onClose: () => void
}

export function ContextUsagePopover({ workspaceId, workspaceRootPath, provider, paneLabel, onClose }: ContextUsagePopoverProps): ReactElement {
  const snapshotSelector = useCallback(selectContextUsage(workspaceId, provider), [workspaceId, provider])
  const snapshot = useUsageStore(snapshotSelector)
  const loadingKey = `${workspaceId}|${provider}`
  const isLoading = useUsageStore((s) => s.loading[loadingKey] === true)
  const refresh = useUsageStore((s) => s.refreshFor)

  const sessionsSelector = useCallback(selectSessions(workspaceId, provider), [workspaceId, provider])
  const sessions = useUsageStore(sessionsSelector)
  const activeIdSelector = useCallback(selectActiveSessionId(workspaceId, provider), [workspaceId, provider])
  const activeSessionId = useUsageStore(activeIdSelector)
  const setActiveSession = useUsageStore((s) => s.setActiveSession)

  useEffect(() => {
    const stop = useUsageStore.getState().startPolling(workspaceId, workspaceRootPath, provider, 5_000)
    return stop
  }, [workspaceId, workspaceRootPath, provider])

  useEffect(() => {
    void useUsageStore.getState().loadSessions(workspaceId, workspaceRootPath, provider)
  }, [workspaceId, workspaceRootPath, provider])

  const handleSessionChange = (event: React.ChangeEvent<HTMLSelectElement>): void => {
    const value = event.target.value
    setActiveSession(workspaceId, provider, value || null)
    void refresh(workspaceId, workspaceRootPath, provider)
  }

  const data: ContextUsageSnapshot | null = snapshot ?? null

  // Current context (last turn) = what's loaded right now in the conversation.
  const currentContext = useMemo(
    () => (data ? data.lastTurnInputTokens + data.lastTurnCacheCreationTokens + data.lastTurnCacheReadTokens + data.lastTurnOutputTokens : 0),
    [data]
  )
  const fillPercent = useMemo(() => {
    if (!data || !data.contextLimit) return 0
    return Math.min(100, Math.round((currentContext / data.contextLimit) * 100))
  }, [data, currentContext])

  // Cumulative totals across the entire session.
  const cumulativeTotal = useMemo(
    () => (data ? data.inputTokens + data.cacheCreationTokens + data.cacheReadTokens + data.outputTokens : 0),
    [data]
  )

  return (
    <div className="usage-popover-backdrop" role="presentation" onMouseDown={onClose}>
      <section
        className="usage-popover"
        role="dialog"
        aria-modal="true"
        aria-label={`Uso de contexto — ${paneLabel}`}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="usage-popover-header">
          <div className="usage-popover-title">
            <Activity size={14} aria-hidden="true" />
            <strong>Uso de contexto</strong>
            <span className="usage-popover-pane">{paneLabel}</span>
            <span className="usage-popover-provider">{providerLabel(provider)}</span>
          </div>
          <div className="usage-popover-actions">
            <button
              type="button"
              className="icon-button"
              aria-label="Atualizar"
              onClick={() => void refresh(workspaceId, workspaceRootPath, provider)}
              disabled={isLoading}
            >
              <RefreshCw size={13} className={isLoading ? 'usage-spin' : ''} aria-hidden="true" />
            </button>
            <button type="button" className="icon-button" aria-label="Fechar" onClick={onClose}>
              <X size={14} aria-hidden="true" />
            </button>
          </div>
        </header>

        {sessions.length > 1 ? (
          <div className="usage-popover-session-picker">
            <label htmlFor="usage-session-select">Sessão</label>
            <select
              id="usage-session-select"
              value={activeSessionId ?? ''}
              onChange={handleSessionChange}
            >
              <option value="">Mais recente</option>
              {sessions.map((s) => (
                <option key={s.sessionId} value={s.sessionId}>
                  {s.modelId ? s.modelId.replace(/^claude-/, '') : 'unknown'} · {s.requestCount} req · {formatRelative(s.lastUpdatedMs)}
                </option>
              ))}
            </select>
          </div>
        ) : null}

        {!data || !data.available ? (
          <div className="usage-popover-empty">
            <BarChart3 size={36} aria-hidden="true" />
            <strong>Sem sessão {providerLabel(provider)} ativa</strong>
            <span>
              Inicie uma sessão com <code>{providerCli(provider)}</code> neste workspace para ver tokens consumidos,
              custo estimado e modelo em uso.
            </span>
            <span className="usage-popover-empty-hint">Lendo <code>{providerSourcePath(provider)}</code></span>
          </div>
        ) : (
          <>
            <div className="usage-popover-meter">
              <div className="usage-popover-meter-header">
                <span className="usage-popover-meter-label">Contexto atual (último turn)</span>
                <span className="usage-popover-meter-value">
                  <strong>{formatTokens(currentContext)}</strong>
                  <span>/ {formatTokens(data.contextLimit ?? 0)}</span>
                  <span className="usage-popover-meter-pct">{fillPercent}%</span>
                </span>
              </div>
              <div className="usage-popover-meter-bar" aria-hidden="true">
                <div
                  className={`usage-popover-meter-fill${fillPercent > 80 ? ' danger' : fillPercent > 60 ? ' warning' : ''}`}
                  style={{ width: `${fillPercent}%` }}
                />
              </div>
            </div>

            <div className="usage-popover-section-label">Último turn</div>
            <div className="usage-popover-grid">
              <UsageStat icon={Zap} label="Input" value={formatTokens(data.lastTurnInputTokens)} />
              <UsageStat icon={Layers} label="Cache read" value={formatTokens(data.lastTurnCacheReadTokens)} accent="cache" />
              <UsageStat icon={Layers} label="Cache write" value={formatTokens(data.lastTurnCacheCreationTokens)} accent="cache" />
              <UsageStat icon={Zap} label="Output" value={formatTokens(data.lastTurnOutputTokens)} accent="output" />
            </div>

            <div className="usage-popover-section-label">Acumulado da sessão ({formatTokens(cumulativeTotal)} tokens)</div>
            <div className="usage-popover-grid">
              <UsageStat icon={Zap} label="Total input" value={formatTokens(data.inputTokens)} />
              <UsageStat icon={Layers} label="Total cache" value={formatTokens(data.cacheCreationTokens + data.cacheReadTokens)} accent="cache" />
              <UsageStat icon={Zap} label="Total output" value={formatTokens(data.outputTokens)} accent="output" />
              <UsageStat icon={Activity} label="Requests" value={data.requestCount.toString()} />
            </div>

            <div className="usage-popover-footer">
              <div className="usage-popover-cost">
                <DollarSign size={13} aria-hidden="true" />
                <strong>${data.estimatedCostUsd.toFixed(2)}</strong>
                <span>API-equivalente</span>
              </div>
              <div className="usage-popover-meta">
                {data.modelId ? <span className="usage-popover-model">{data.modelId.replace(/^claude-/, '')}</span> : null}
              </div>
            </div>
            <div className="usage-popover-disclaimer">
              Cálculo baseado em preços públicos da Anthropic. Em <strong>Claude Pro</strong> você paga o plano mensal — este número é apenas referência do consumo.
            </div>

            <div className="usage-popover-timeline">
              {data.sessionStartedAtMs ? <span>iniciada {formatRelative(data.sessionStartedAtMs)}</span> : null}
              {data.lastUpdatedMs ? <span>atualizada {formatRelative(data.lastUpdatedMs)}</span> : null}
              <span className="usage-popover-poll">auto-refresh 5s</span>
            </div>
          </>
        )}
      </section>
    </div>
  )
}

function UsageStat({ icon: Icon, label, value, accent }: { icon: typeof Activity; label: string; value: string; accent?: 'cache' | 'output' }): ReactElement {
  return (
    <div className={`usage-stat${accent ? ` usage-stat-${accent}` : ''}`}>
      <div className="usage-stat-label">
        <Icon size={11} aria-hidden="true" />
        <span>{label}</span>
      </div>
      <strong className="usage-stat-value">{value}</strong>
    </div>
  )
}

function formatTokens(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(2)}M`
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}k`
  return value.toString()
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

function providerLabel(provider: AgentProvider): string {
  switch (provider) {
    case 'claude': return 'Claude'
    case 'codex': return 'Codex'
    case 'gemini': return 'Gemini'
    case 'copilot': return 'Copilot'
    case 'gh-copilot': return 'GH Copilot'
    case 'cursor': return 'Cursor'
    case 'oxe': return 'OXE'
    case 'custom': return 'Custom'
    default: return provider
  }
}

function providerCli(provider: AgentProvider): string {
  switch (provider) {
    case 'claude': return 'claude'
    case 'codex': return 'codex'
    case 'gemini': return 'gemini'
    case 'copilot':
    case 'gh-copilot': return 'gh copilot'
    case 'cursor': return 'cursor-agent'
    default: return provider
  }
}

function providerSourcePath(provider: AgentProvider): string {
  switch (provider) {
    case 'claude': return '~/.claude/projects/'
    case 'codex': return '~/.codex/sessions/'
    case 'gemini': return '(sem session log)'
    default: return '(sem session log)'
  }
}
