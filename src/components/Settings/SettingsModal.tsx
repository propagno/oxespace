import { Bot, RefreshCw, X } from 'lucide-react'
import type { ReactElement } from 'react'
import type { AgentProfile, AgentReadiness } from '../../../shared/types/agent'

interface SettingsModalProps {
  agentProfiles: AgentProfile[]
  agentReadiness: AgentReadiness[]
  isDiscoveringAgents: boolean
  onClose: () => void
  onDiscoverAgents: () => void
  onConfigureAgent: (profile: AgentProfile) => void
}

function readinessFor(profile: AgentProfile, readiness: AgentReadiness[]): AgentReadiness | undefined {
  return readiness.find((item) => item.provider === profile.provider)
}

function ReadinessBadge({ status }: { status: AgentReadiness['status'] | undefined }): ReactElement {
  return <span className={`agent-badge ${status ?? 'unknown'}`}>{status ?? 'unknown'}</span>
}

export function SettingsModal({
  agentProfiles,
  agentReadiness,
  isDiscoveringAgents,
  onClose,
  onConfigureAgent,
  onDiscoverAgents
}: SettingsModalProps): ReactElement {
  return (
    <div className="modal-backdrop" role="presentation">
      <section className="settings-modal" role="dialog" aria-modal="true" aria-labelledby="settings-title">
        <aside className="settings-modal-nav" aria-label="Settings sections">
          <header className="settings-modal-brand">
            <span>OXESpace</span>
            <strong id="settings-title">Settings</strong>
          </header>
          <nav>
            <button type="button" className="settings-nav-item active" aria-current="page">
              <Bot size={14} aria-hidden="true" />
              <span>Agents</span>
            </button>
          </nav>
        </aside>

        <section className="settings-modal-content" aria-labelledby="settings-agents-title">
          <header className="settings-content-header">
            <div>
              <span>Configuration</span>
              <h2 id="settings-agents-title">Agents</h2>
            </div>
            <div className="settings-content-actions">
              <button
                type="button"
                className="icon-button"
                aria-label="Run health check"
                title="Run health check"
                data-testid="btn-discover-agents"
                disabled={isDiscoveringAgents}
                onClick={onDiscoverAgents}
              >
                <RefreshCw size={14} aria-hidden="true" className={isDiscoveringAgents ? 'spin' : undefined} />
              </button>
              <button type="button" className="icon-button" aria-label="Close settings" onClick={onClose}>
                <X size={16} aria-hidden="true" />
              </button>
            </div>
          </header>

          <div className="settings-agent-table">
            {agentProfiles.length === 0 ? (
              <p className="workspace-list-empty">No agent profiles.</p>
            ) : (
              agentProfiles.map((profile) => {
                const readiness = readinessFor(profile, agentReadiness)
                return (
                  <article className="settings-agent-row" key={profile.agentProfileId}>
                    <div className="settings-agent-main">
                      <strong>{profile.name}</strong>
                      <span>{profile.command}</span>
                    </div>
                    <div className="settings-agent-state">
                      <ReadinessBadge status={readiness?.status} />
                      {readiness?.version ? <span className="readiness-version">{readiness.version}</span> : null}
                    </div>
                    <button
                      type="button"
                      className="secondary-action compact-action"
                      aria-label={`Configure ${profile.name}`}
                      onClick={() => onConfigureAgent(profile)}
                    >
                      Configure
                    </button>
                  </article>
                )
              })
            )}
          </div>
        </section>
      </section>
    </div>
  )
}
