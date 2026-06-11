import { Brain, Copy, Download, Pause, Play, Trash2, X } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from 'react'
import type { SemanticLogEntry, SemanticLogLevel, SemanticStatus } from '../../../shared/types/ipc'

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
    ? 'sem workspace ativo'
    : status.lastError
      ? `erro: ${status.lastError}`
      : !status.workerReady
        ? 'carregando modelo…'
        : status.indexing
          ? `indexando… · ${status.count} arquivos`
          : `pronto · ${status.count} arquivos`

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
            <span className="mcp-panel-scope">{statusLabel}</span>
          </div>
          <div className="mcp-panel-actions">
            <button type="button" className="icon-button" aria-label={paused ? 'Resume' : 'Pause'} title={paused ? 'Retomar stream' : 'Pausar stream'} onClick={() => setPaused((p) => !p)}>
              {paused ? <Play size={13} aria-hidden="true" /> : <Pause size={13} aria-hidden="true" />}
            </button>
            <button type="button" className="icon-button" aria-label="Copy logs" title="Copiar logs visíveis" onClick={handleCopy}>
              <Copy size={13} aria-hidden="true" />
            </button>
            <button type="button" className="icon-button" aria-label="Export logs" title="Exportar logs (.log)" onClick={handleExport}>
              <Download size={13} aria-hidden="true" />
            </button>
            <button type="button" className="icon-button" aria-label="Clear view" title="Limpar visualização" onClick={() => setLogs([])}>
              <Trash2 size={13} aria-hidden="true" />
            </button>
            <button type="button" className="icon-button" aria-label="Close" onClick={onClose}>
              <X size={14} aria-hidden="true" />
            </button>
          </div>
        </header>

        <div className="semantic-activity-toolbar">
          <div className="semantic-activity-filters" role="group" aria-label="Filtrar por nível">
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
          <span className="semantic-activity-count">{visible.length} / {logs.length} linhas</span>
        </div>

        <div className="semantic-activity-log" role="log" aria-live="polite">
          {visible.length === 0 ? (
            <div className="semantic-activity-empty">Nenhuma atividade ainda. Edite/abra arquivos ou rode uma busca semântica para ver o processamento aqui.</div>
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
