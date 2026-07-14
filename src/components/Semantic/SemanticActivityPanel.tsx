import { Brain, Copy, Download, Pause, Play, RefreshCw, Trash2, X } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from 'react'
import type { SemanticLogEntry, SemanticLogLevel, SemanticSearchMode, SemanticStatus } from '../../../shared/types/ipc'
import { useTerminalPrefsStore } from '../../store/terminal-prefs.store'

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

  const handleCopy = (): void => { void navigator.clipboard?.writeText(asText()).catch(() => undefined) }

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
    ? 'no active workspace'
    : status.lastError
      ? `error: ${status.lastError}`
      : !status.enabled
        ? 'disabled · enable the Semantic chip'
        : !status.workerReady
          ? 'loading model…'
          : status.indexing
            ? `indexing… · ${status.count} files`
            : status.count === 0
              ? 'ready · empty index (waiting for files)'
              : `ready · ${status.count} files`

  const modelLabel = status?.modelId ?? 'Xenova/multilingual-e5-small'

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
    <div className="mcp-panel-backdrop" role="presentation" onMouseDown={onClose}>
      <section
        className="mcp-panel semantic-activity"
        role="dialog"
        aria-modal="true"
        aria-label="Semantic activity"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="mcp-panel-header">
          <div className="mcp-panel-title">
            <Brain size={14} aria-hidden="true" />
            <strong>Semantic Activity</strong>
            <span className="mcp-panel-scope" data-testid="semantic-status-label">{statusLabel}</span>
          </div>
          <div className="mcp-panel-actions">
            <button
              type="button"
              className="icon-button"
              aria-label="Reindex workspace"
              title="Clear embeddings and re-crawl this workspace"
              data-testid="btn-semantic-reindex"
              disabled={!workspaceId || reindexing}
              onClick={() => void handleReindex()}
            >
              <RefreshCw size={13} aria-hidden="true" className={reindexing ? 'spin' : undefined} />
            </button>
            <button type="button" className="icon-button" aria-label={paused ? 'Resume' : 'Pause'} title={paused ? 'Resume stream' : 'Pause stream'} onClick={() => setPaused((p) => !p)}>
              {paused ? <Play size={13} aria-hidden="true" /> : <Pause size={13} aria-hidden="true" />}
            </button>
            <button type="button" className="icon-button" aria-label="Copy logs" title="Copy visible logs" onClick={handleCopy}>
              <Copy size={13} aria-hidden="true" />
            </button>
            <button type="button" className="icon-button" aria-label="Export logs" title="Export logs (.log)" onClick={handleExport}>
              <Download size={13} aria-hidden="true" />
            </button>
            <button type="button" className="icon-button" aria-label="Clear view" title="Clear view" onClick={() => setLogs([])}>
              <Trash2 size={13} aria-hidden="true" />
            </button>
            <button type="button" className="icon-button" aria-label="Close" onClick={onClose}>
              <X size={14} aria-hidden="true" />
            </button>
          </div>
        </header>

        <div className="semantic-activity-meta" data-testid="semantic-model-label">
          <span>Model: <strong>{modelLabel}</strong></span>
          <span className="semantic-activity-meta-hint">offline · local embeddings + FTS5</span>
          <label className="semantic-mode-control">
            Retrieval mode
            <select
              value={status?.mode ?? 'auto'}
              disabled={!workspaceId}
              aria-label="Semantic retrieval mode"
              onChange={(event) => void handleModeChange(event.target.value as SemanticSearchMode)}
            >
              <option value="auto">Auto · intent-aware</option>
              <option value="explore">Explore · token-first</option>
              <option value="exhaustive">Exhaustive · quality-first</option>
            </select>
          </label>
        </div>

        <div className="semantic-quality-grid" aria-label="Semantic index coverage">
          <div className="semantic-quality-card">
            <span className="semantic-quality-label">Indexed coverage</span>
            <strong>{coverage?.lexicalDocuments ?? 0} searchable documents</strong>
            <span>source {coverage?.byCategory.source ?? 0} · tests {coverage?.byCategory.test ?? 0} · config {coverage?.byCategory.config ?? 0} · docs {coverage?.byCategory.docs ?? 0}</span>
          </div>
          <div className={`semantic-quality-card semantic-confidence--${lastQuery?.confidence ?? 'idle'}`}>
            <span className="semantic-quality-label">Last retrieval</span>
            {lastQuery ? (
              <>
                <strong>{lastQuery.confidence} confidence · {lastQuery.resolvedMode}{lastQuery.expanded ? ' · auto-expanded' : ''}</strong>
                <span>{lastQuery.returnedResults} results · ≈{lastQuery.estimatedTokens.toLocaleString()} tokens · ≈{lastQuery.estimatedSavingsPercent}% saved · {lastQuery.durationMs}ms{lastQuery.truncated ? ' · capped' : ''}</span>
              </>
            ) : (
              <><strong>No query yet</strong><span>Coverage and token budget appear after retrieval.</span></>
            )}
          </div>
        </div>

        <p className="semantic-trust-note">
          Explore is ranked best-effort. Exhaustive searches the complete local lexical index and expands structural evidence, but dynamic runtime references can still require verification.
        </p>

        <div className="semantic-activity-toolbar">
          <div className="semantic-activity-filters" role="group" aria-label="Filter by level">
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
            Auto-scroll
          </label>
          <span className="semantic-activity-count">{visible.length} / {logs.length} lines</span>
        </div>

        <div className="semantic-activity-log" role="log" aria-live="polite">
          {visible.length === 0 ? (
            <div className="semantic-activity-empty">
              No activity yet. Enable the Semantic chip, edit files, or run a semantic search to see processing here.
            </div>
          ) : (
            visible.map((l, i) => (
              <div key={`${l.ts}-${i}`} className={`semantic-activity-line semantic-log--${l.level}`}>
                <span className="semantic-activity-time">{new Date(l.ts).toLocaleTimeString()}</span>
                <span className="semantic-activity-level">{l.level}</span>
                <span className="semantic-activity-msg">{l.message}</span>
              </div>
            ))
          )}
          <div ref={endRef} />
        </div>
      </section>
    </div>
  )
}
