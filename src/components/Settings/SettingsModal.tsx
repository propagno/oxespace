import { Bot, Plus, RefreshCw, Settings2, X } from 'lucide-react'
import type { ReactElement } from 'react'
import type { AgentProfile, AgentReadiness } from '../../../shared/types/agent'

interface SettingsModalProps {
  agentProfiles: AgentProfile[]
  agentReadiness: AgentReadiness[]
  isDiscoveringAgents: boolean
  onClose: () => void
  onDiscoverAgents: () => void
  onConfigureAgent: (profile: AgentProfile) => void
  onNewCustomAgent: () => void
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
  onDiscoverAgents,
  onConfigureAgent,
  onNewCustomAgent
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
              <span>AI Providers</span>
            </button>
          </nav>
        </aside>

        <section className="settings-modal-content" aria-labelledby="settings-providers-title">
          <header className="settings-content-header">
            <div>
              <span>Status</span>
              <h2 id="settings-providers-title">AI Providers</h2>
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
              <button type="button" className="icon-button" aria-label="Close" onClick={onClose}>
                <X size={16} aria-hidden="true" />
              </button>
            </div>
          </header>

          <div className="settings-agent-table">
            {(() => {
              const providers = agentProfiles
              if (providers.length === 0) {
                return <p className="workspace-list-empty">No providers found. Run a health check.</p>
              }
              return providers.map((profile) => {
                const readiness = readinessFor(profile, agentReadiness)
                const isCustom = profile.provider === 'custom'
                return (
                  <article className="settings-agent-row" key={profile.agentProfileId}>
                    <div className="settings-agent-main">
                      <strong>{profile.name}</strong>
                      <span>
                        {isCustom
                          ? `custom · ${profile.parentProvider ?? '—'}`
                          : profile.command}
                      </span>
                    </div>
                    <div className="settings-agent-state">
                      {/* Custom agents have no readiness probe of their own —
                          they inherit their parent provider's status. */}
                      {!isCustom ? <ReadinessBadge status={readiness?.status} /> : null}
                      {readiness?.version && !isCustom ? <span className="readiness-version">{readiness.version}</span> : null}
                      <button
                        type="button"
                        className="icon-button"
                        aria-label={`Configure ${profile.name}`}
                        title="Configure"
                        onClick={() => onConfigureAgent(profile)}
                        data-testid={`btn-configure-agent-${profile.provider}`}
                      >
                        <Settings2 size={13} aria-hidden="true" />
                      </button>
                    </div>
                  </article>
                )
              })
            })()}
          </div>

          <button
            type="button"
            className="settings-new-agent-btn"
            onClick={onNewCustomAgent}
            data-testid="btn-new-custom-agent"
          >
            <Plus size={13} aria-hidden="true" />
            New custom agent
          </button>
        </section>
      </section>
    </div>
  )
}
