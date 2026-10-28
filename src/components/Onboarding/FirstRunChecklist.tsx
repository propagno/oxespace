import { ExternalLink, RefreshCw, Settings2 } from 'lucide-react'
import { useEffect, useId, useRef, type ReactElement } from 'react'
import { useAgentStore } from '../../store/agent.store'
import { useUIStore } from '../../store/ui.store'
import { Button, StatusDot } from '../../ui'
import { summarizeAgentSetup, type AgentSetupState } from '../../utils/agentSetup'
import { installDocLabel, PROVIDER_INSTALL_DOCS } from '../Settings/providerInstallDocs'
import styles from './FirstRunChecklist.module.css'

const DOT: Record<AgentSetupState, 'idle' | 'running' | 'success' | 'attention' | 'danger'> = {
  unchecked: 'idle',
  checking: 'running',
  ready: 'success',
  'needs-attention': 'attention',
  none: 'danger'
}

function openInstallDocs(url: string): void {
  window.open(url, '_blank', 'noopener,noreferrer')
}

/**
 * Shown on the empty screen, before any project exists. It answers the first question a new
 * user has, "can OXESpace run an agent here?", and points at the fix. It checks only what
 * can be checked without a project (the agent CLIs); GitHub and Git are reported as a note
 * rather than a status, because their checks need a workspace.
 */
export function FirstRunChecklist(): ReactElement {
  const titleId = useId()
  const readiness = useAgentStore(state => state.readiness)
  const isDiscovering = useAgentStore(state => state.isDiscovering)
  const loadReadiness = useAgentStore(state => state.loadReadiness)
  const discover = useAgentStore(state => state.discover)
  const openAgentSettings = useUIStore(state => state.openAgentSettings)
  const started = useRef(false)

  useEffect(() => {
    if (started.current) return
    started.current = true
    // Read what is already known, and run one check only if this machine was never checked.
    void loadReadiness().then(() => {
      if (useAgentStore.getState().lastHealthCheckAt === null) void discover(false)
    })
  }, [loadReadiness, discover])

  const summary = summarizeAgentSetup(readiness, isDiscovering)
  const checkLabel = summary.state === 'unchecked' ? 'Check now' : 'Check again'

  return (
    <section className={styles.card} aria-labelledby={titleId} data-testid="first-run-checklist">
      <h2 className={styles.title} id={titleId}>Before you start</h2>
      <div className={styles.row}>
        <span className={styles.dot}><StatusDot status={DOT[summary.state]} label={summary.headline} /></span>
        <div className={styles.text} aria-live="polite">
          <span className={styles.headline}>{summary.headline}</span>
          <span className={styles.detail}>{summary.detail}</span>
        </div>
      </div>
      <div className={styles.actions}>
        {summary.state === 'none' ? (
          <>
            {(['claude', 'codex'] as const).map(provider => {
              const doc = PROVIDER_INSTALL_DOCS[provider]
              return doc ? (
                <Button key={provider} variant="ghost" size="sm" icon={<ExternalLink size={12} aria-hidden="true" />} onClick={() => openInstallDocs(doc.url)}>{installDocLabel(doc)}</Button>
              ) : null
            })}
          </>
        ) : null}
        {summary.state !== 'ready' ? (
          <Button variant="ghost" size="sm" disabled={isDiscovering} icon={<RefreshCw size={12} aria-hidden="true" />} onClick={() => void discover(true)}>{isDiscovering ? 'Checking…' : checkLabel}</Button>
        ) : null}
        <Button variant="ghost" size="sm" icon={<Settings2 size={12} aria-hidden="true" />} onClick={openAgentSettings}>Agent settings</Button>
      </div>
      <p className={styles.note}>
        GitHub features need the GitHub CLI signed in (<code>gh auth login</code>). OXESpace checks it once a project is open.
      </p>
    </section>
  )
}
