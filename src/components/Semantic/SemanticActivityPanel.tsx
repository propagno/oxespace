import { Brain, Copy, Download, Pause, Play, RefreshCw, Trash2, X } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import { copyText, Button, Select } from '../../ui'
import { ToolPanel } from '../../ui'
import type { SemanticLogEntry, SemanticLogLevel, SemanticSearchMode, SemanticStatus } from '../../../shared/types/ipc'
import { useTerminalPrefsStore } from '../../store/terminal-prefs.store'
import { summarizeSemanticStatus, vectorStateLabel } from './semanticStatusSummary'
import { formatClock, formatNumber } from '../../utils/formatTime'

interface SemanticActivityPanelProps {
  workspaceId: string | null
  onClose: () => void
}

const LEVELS: SemanticLogLevel[] = ['debug', 'info', 'warn', 'error']

/**
 * Tools → Semantic Activity. A live, transparent view of what the local
 * embedding engine is doing: model load, per-file indexing, queries and errors.
 * Logs are ring-buffered in the main process; this panel hydrates from
 * `getLogs()` and then streams new lines over `onLog`. Copy/export make the log
 * available for offline analysis.
 */
export function SemanticActivityPanel({ workspaceId, onClose }: SemanticActivityPanelProps): ReactElement {
  const [logs, setLogs] = useState<SemanticLogEntry[]>([])
  const { t } = useTranslation('code')
  const [status, setStatus] = useState<SemanticStatus | null>(null)
  const [paused, setPaused] = useState(false)
  const [autoScroll, setAutoScroll] = useState(true)
  const [hidden, setHidden] = useState<Set<SemanticLogLevel>>(new Set())
  const [reindexing, setReindexing] = useState(false)
  const setPreference = useTerminalPrefsStore((state) => state.setOverride)
  const pausedRef = useRef(paused)
  pausedRef.current = paused
  const endRef = useRef<HTMLDivElement | null>(null)

  // Hydrate the buffer, then stream live lines (unless paused).
  useEffect(() => {
    let mounted = true
    void window.oxe?.semantic?.getLogs().then((initial) => { if (mounted) setLogs(initial) }).catch(() => undefined)
    const unsubscribe = window.oxe?.semantic?.onLog((entry) => {
      if (!pausedRef.current) setLogs((prev) => [...prev.slice(-999), entry])
    })
    return () => { mounted = false; unsubscribe?.() }
  }, [])

  // Poll status (worker/indexing/count) for the header.
  useEffect(() => {
    if (!workspaceId) { setStatus(null); return }
    let mounted = true
    const tick = (): void => {
      void window.oxe?.semantic?.getStatus(workspaceId).then((s) => { if (mounted) setStatus(s) }).catch(() => undefined)
    }
    tick()
    const interval = setInterval(tick, 3000)
    return () => { mounted = false; clearInterval(interval) }
  }, [workspaceId])

  const visible = useMemo(() => logs.filter((l) => !hidden.has(l.level)), [logs, hidden])

  useEffect(() => {
    if (autoScroll && !paused) endRef.current?.scrollIntoView({ block: 'end' })
  }, [visible, autoScroll, paused])

  const toggleLevel = (level: SemanticLogLevel): void => {
    setHidden((prev) => {
      const next = new Set(prev)
      if (next.has(level)) next.delete(level); else next.add(level)
      return next
    })
  }

  const asText = useCallback(
    () => visible.map((l) => `${new Date(l.ts).toISOString()} [${l.level.toUpperCase()}] ${l.message}`).join('\n'),
    [visible]
  )

  const handleCopy = (): void => { void copyText(asText(), t('semantic.panel.log')) }

  const handleExport = (): void => {
    const blob = new Blob([asText()], { type: 'text/plain;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `semantic-activity-${new Date().toISOString().replace(/[:.]/g, '-')}.log`
    a.click()
    URL.revokeObjectURL(url)
  }

  const statusLabel = !status
    ? t('semantic.panel.noWorkspace')
    : !status.enabled && !status.lastError
      ? t('semantic.panel.disabled')
      : summarizeSemanticStatus(status, true).label

  const vectorLabel = vectorStateLabel(status?.vector)
  const modelLabel = status?.vector?.state === 'ready'
    ? t('semantic.panel.modelVectors', { model: status.vector.modelId })
    : t('semantic.panel.modelExact')

  const handleReindex = async (): Promise<void> => {
    if (!workspaceId || reindexing) return
    setReindexing(true)
    try {
      const next = await window.oxe.semantic.reindex(workspaceId)
      setStatus(next)
    } catch {
      /* status poll will surface errors */
    } finally {
      setReindexing(false)
    }
  }

  const handleModeChange = async (mode: SemanticSearchMode): Promise<void> => {
    if (!workspaceId) return
    setPreference(workspaceId, 'semanticSearchMode', mode)
    try {
      setStatus(await window.oxe.semantic.setMode({ workspaceId, mode }))
    } catch {
      /* status polling keeps the last valid mode */
    }
  }

  const coverage = status?.coverage
  const lastQuery = status?.lastQuery

  return (
    <ToolPanel
      className="mcp-panel semantic-activity"
      label={t('semantic.panel.title')} onClose={onClose}>
      <header className="mcp-panel-header">
        <div className="mcp-panel-title">
          <Brain size={14} aria-hidden="true" />
          <strong>{t('semantic.panel.title')}</strong>
          <span className="mcp-panel-scope" data-testid="semantic-status-label">{statusLabel}</span>
        </div>
        <div className="mcp-panel-actions">
          <Button
           
            variant="ghost" size="sm" square
            aria-label={t('semantic.panel.reindex')}
            title={t('semantic.panel.reindexTitle')}
            data-testid="btn-semantic-reindex"
            disabled={!workspaceId || reindexing}
            onClick={() => void handleReindex()}
          >
            <RefreshCw size={14} aria-hidden="true" className={reindexing ? 'spin' : undefined} />
          </Button>
          <Button variant="ghost" size="sm" square aria-label={paused ? t('semantic.panel.resume') : t('semantic.panel.pause')} title={paused ? t('semantic.panel.resumeTitle') : t('semantic.panel.pauseTitle')} onClick={() => setPaused((p) => !p)}>
            {paused ? <Play size={14} aria-hidden="true" /> : <Pause size={14} aria-hidden="true" />}
          </Button>
          <Button variant="ghost" size="sm" square aria-label={t('semantic.panel.copy')} title={t('semantic.panel.copyTitle')} onClick={handleCopy}>
            <Copy size={14} aria-hidden="true" />
          </Button>
          <Button variant="ghost" size="sm" square aria-label={t('semantic.panel.export')} title={t('semantic.panel.exportTitle')} onClick={handleExport}>
            <Download size={14} aria-hidden="true" />
          </Button>
          <Button variant="ghost" size="sm" square aria-label={t('semantic.panel.clear')} title={t('semantic.panel.clear')} onClick={() => setLogs([])}>
            <Trash2 size={14} aria-hidden="true" />
          </Button>
          <Button variant="ghost" size="sm" square aria-label={t('ui.close', { ns: 'common' })} onClick={onClose}>
            <X size={14} aria-hidden="true" />
          </Button>
        </div>
      </header>

      <div className="semantic-activity-meta" data-testid="semantic-model-label">
        <span>{t('semantic.panel.sources')} <strong>{modelLabel}</strong></span>
        <span className="semantic-activity-meta-hint">
          {vectorLabel && status?.vector?.state !== 'ready' ? t('semantic.panel.localNote', { note: vectorLabel }) : t('semantic.panel.local')}
        </span>
        <label className="semantic-mode-control">
          {t('semantic.panel.mode')}
          <Select
            value={status?.mode ?? 'auto'}
            disabled={!workspaceId}
            aria-label={t('semantic.panel.modeLabel')}
            onChange={(event) => void handleModeChange(event.target.value as SemanticSearchMode)}
          >
            <option value="auto">{t('semantic.panel.modes.auto')}</option>
            <option value="explore">{t('semantic.panel.modes.explore')}</option>
            <option value="exhaustive">{t('semantic.panel.modes.exhaustive')}</option>
          </Select>
        </label>
      </div>

      <div className="semantic-quality-grid" aria-label={t('semantic.panel.coverage')}>
        <div className="semantic-quality-card">
          <span className="semantic-quality-label">{t('semantic.panel.indexed')}</span>
          <strong>{t('semantic.panel.documents', { count: coverage?.lexicalDocuments ?? 0 })}</strong>
          <span>{t('semantic.panel.categories', { source: coverage?.byCategory.source ?? 0, tests: coverage?.byCategory.test ?? 0, config: coverage?.byCategory.config ?? 0, docs: coverage?.byCategory.docs ?? 0 })}</span>
        </div>
        <div className={`semantic-quality-card semantic-confidence--${lastQuery?.confidence ?? 'idle'}`}>
          <span className="semantic-quality-label">{t('semantic.panel.last')}</span>
          {lastQuery ? (
            <>
              <strong>{t('semantic.panel.confidence', { confidence: t(`semantic.panel.confidenceLevel.${lastQuery.confidence}`), mode: t(`semantic.panel.resolved.${lastQuery.resolvedMode}`) })}{lastQuery.expanded ? ` · ${t('semantic.panel.expanded')}` : ''}</strong>
              <span>{t('semantic.panel.results', { count: lastQuery.returnedResults, tokens: formatNumber(lastQuery.estimatedTokens), saved: lastQuery.estimatedSavingsPercent, ms: lastQuery.durationMs })}{lastQuery.truncated ? ` · ${t('semantic.panel.capped')}` : ''}</span>
            </>
          ) : (
            <><strong>{t('semantic.panel.noQuery')}</strong><span>{t('semantic.panel.noQueryHint')}</span></>
          )}
        </div>
      </div>

      <p className="semantic-trust-note">
        {t('semantic.panel.trust')}
      </p>

      <div className="semantic-activity-toolbar">
        <div className="semantic-activity-filters" role="group" aria-label={t('semantic.panel.levels')}>
          {LEVELS.map((level) => (
            <button
              key={level}
              type="button"
              className={`semantic-activity-chip semantic-log--${level}${hidden.has(level) ? ' off' : ''}`}
              aria-pressed={!hidden.has(level)}
              onClick={() => toggleLevel(level)}
            >
              {level}
            </button>
          ))}
        </div>
        <label className="semantic-activity-autoscroll">
          <input type="checkbox" checked={autoScroll} onChange={(e) => setAutoScroll(e.target.checked)} />
          {t('semantic.panel.autoScroll')}
        </label>
        <span className="semantic-activity-count">{t('semantic.panel.lines', { visible: visible.length, count: logs.length })}</span>
      </div>

      <div className="semantic-activity-log" role="log" aria-live="polite">
        {visible.length === 0 ? (
          <div className="semantic-activity-empty">
            {t('semantic.panel.empty')}
          </div>
        ) : (
          visible.map((l, i) => (
            <div key={`${l.ts}-${i}`} className={`semantic-activity-line semantic-log--${l.level}`}>
              <span className="semantic-activity-time">{formatClock(l.ts)}</span>
              <span className="semantic-activity-level">{l.level}</span>
              <span className="semantic-activity-msg">{l.message}</span>
            </div>
          ))
        )}
        <div ref={endRef} />
      </div>
    </ToolPanel>
  )
}
