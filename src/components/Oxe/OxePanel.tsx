import { AlertTriangle, CheckCircle2, Copy, Info, Play, RefreshCw } from 'lucide-react'
import { lazy, Suspense, useEffect, useState, type ReactElement } from 'react'
import { OxeArtifactList } from './OxeArtifactList'
import { selectOxeWorkspaceState, useOxeStore } from '../../store/oxe.store'

const LazyOxeGraphPanel = lazy(() =>
  import('./OxeGraphPanel').then(m => ({ default: m.OxeGraphPanel }))
)

type OxeTab = 'status' | 'graph'

interface OxePanelProps {
  workspaceId: string
  rootPath: string
  onOpenArtifact: (relativePath: string) => void
  onRunOxeCommand: (command: string) => void
}

export function OxePanel({ workspaceId, rootPath, onOpenArtifact, onRunOxeCommand }: OxePanelProps): ReactElement {
  const [activeTab, setActiveTab] = useState<OxeTab>('status')
  const { status, artifacts, isLoading, error } = useOxeStore(selectOxeWorkspaceState(workspaceId))
  const { loadStatus } = useOxeStore()
  const [feedback, setFeedback] = useState<string | null>(null)

  useEffect(() => {
    void loadStatus(workspaceId, rootPath)
  }, [loadStatus, rootPath, workspaceId])

  const isOxeProject = status?.isOxeProject === true
  const engineAvailable = status?.engine.available === true
  const healthStatus = status?.healthStatus ?? status?.state?.status ?? (isOxeProject ? 'available' : 'not_configured')
  const rationality = status?.executionRationality as { executionRationalityReady?: boolean; criticalExecutionGaps?: string[] } | null | undefined
  const criticalGaps = rationality?.criticalExecutionGaps ?? []
  const freshness = status?.freshness
  const warnings = status?.warnings ?? []

  return (
    <section className="oxe-panel" aria-label="OXE status">
      <div className="oxe-panel-tabs" role="tablist">
        <button type="button" role="tab" aria-selected={activeTab === 'status'} className={`oxe-tab${activeTab === 'status' ? ' active' : ''}`} onClick={() => setActiveTab('status')}>Status</button>
        <button type="button" role="tab" aria-selected={activeTab === 'graph'} className={`oxe-tab${activeTab === 'graph' ? ' active' : ''}`} onClick={() => setActiveTab('graph')}>Graph</button>
      </div>
      {activeTab === 'graph' ? (
        <Suspense fallback={<div className="oxe-panel-empty">Loading graph…</div>}>
          <LazyOxeGraphPanel workspaceId={workspaceId} rootPath={rootPath} />
        </Suspense>
      ) : null}
      {activeTab === 'status' ? (
        <div className="oxe-panel-status-content">
          <div className="oxe-panel-toolbar">
            <div className={`oxe-status-pill ${statusClass(healthStatus, freshness?.state)}`}>
              {isOxeProject ? <CheckCircle2 size={13} aria-hidden="true" /> : <Info size={13} aria-hidden="true" />}
              <span>{isOxeProject ? 'OXE project' : 'Not configured'}</span>
            </div>
            <button type="button" className="tile-btn" aria-label="Refresh OXE status" title="Refresh" onClick={() => void loadStatus(workspaceId, rootPath)}>
              <RefreshCw size={13} aria-hidden="true" />
            </button>
          </div>

          {isLoading ? <div className="oxe-panel-empty">Loading OXE status</div> : null}
          {error ? (
            <div className="oxe-panel-alert">
              <AlertTriangle size={14} aria-hidden="true" />
              <span>{error}</span>
            </div>
          ) : null}

          {!isLoading && !error ? (
            <div className="oxe-panel-body">
              <div className="oxe-status-grid">
                <div>
                  <span>Health</span>
                  <strong>{healthStatus}</strong>
                </div>
                <div>
                  <span>Run</span>
                  <strong>{status?.state?.runId ?? '-'}</strong>
                </div>
                <div>
                  <span>Runtime</span>
                  <strong>{status?.state?.runtimeStatus ?? '-'}</strong>
                </div>
                <div>
                  <span>Engine</span>
                  <strong>{engineAvailable ? status?.engine.version ?? 'available' : 'optional missing'}</strong>
                </div>
                <div>
                  <span>Rationality</span>
                  <strong>{rationality?.executionRationalityReady === true ? 'ready' : rationality ? 'blocked' : '-'}</strong>
                </div>
                <div>
                  <span>Freshness</span>
                  <strong>{freshness?.state ?? 'unknown'}</strong>
                </div>
              </div>

              {freshness && freshness.state !== 'fresh' ? (
                <div className="oxe-panel-alert">
                  <AlertTriangle size={14} aria-hidden="true" />
                  <span>{freshness.reason ?? 'OXE view may be stale.'}</span>
                </div>
              ) : null}

              {(status?.nextStep ?? status?.state?.nextStep) ? (
                <div className="oxe-next-step">
                  <span>Next</span>
                  <p>{status?.nextStep ?? status?.state?.nextStep}</p>
                </div>
              ) : null}

              {(() => {
                const allMessages = [...new Set([...criticalGaps, ...warnings])]
                if (!allMessages.length) return null
                return (
                  <div className="oxe-panel-alert">
                    <AlertTriangle size={14} aria-hidden="true" />
                    <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'grid', gap: 4 }}>
                      {allMessages.slice(0, 4).map((m, i) => <li key={i}>{m}</li>)}
                      {allMessages.length > 4 && <li style={{ opacity: .6 }}>+{allMessages.length - 4} more</li>}
                    </ul>
                  </div>
                )
              })()}

              {feedback ? <div className="oxe-action-feedback">{feedback}</div> : null}

              <button type="button" className="oxe-run-button" onClick={() => onRunOxeCommand('npx oxe-cc status --json')}>
                <Play size={13} aria-hidden="true" />
                Status in terminal
              </button>

              {freshness?.suggestedActions?.length ? (
                <div className="oxe-suggested-actions" aria-label="Suggested OXE actions">
                  {freshness.suggestedActions.map((action) => (
                    <button
                      key={`${action.label}:${action.command}`}
                      type="button"
                      className="oxe-action-button"
                      onClick={() => {
                        if (action.mode === 'terminal') {
                          onRunOxeCommand(action.command)
                          setFeedback(`Sent: ${action.label}`)
                        } else {
                          void navigator.clipboard?.writeText(action.command)
                          setFeedback(`Copied: ${action.command}`)
                        }
                      }}
                    >
                      {action.mode === 'terminal' ? <Play size={12} aria-hidden="true" /> : <Copy size={12} aria-hidden="true" />}
                      <span>{action.label}</span>
                    </button>
                  ))}
                </div>
              ) : null}

              <OxeArtifactList artifacts={artifacts} onOpenArtifact={onOpenArtifact} />
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  )
}

function statusClass(healthStatus: string, freshness?: string): string {
  if (freshness === 'dirty' || freshness === 'stale') return 'warning'
  if (healthStatus === 'ok' || healthStatus === 'passed' || healthStatus === 'available') return 'ready'
  if (healthStatus === 'warning') return 'warning'
  return 'muted'
}
