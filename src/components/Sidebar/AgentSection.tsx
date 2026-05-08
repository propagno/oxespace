import { RefreshCw } from 'lucide-react'
import type { ReactElement } from 'react'
import type { AgentProfile, AgentReadiness } from '../../../shared/types/agent'
import { AgentItem } from './AgentItem'

interface AgentSectionProps {
  profiles: AgentProfile[]
  readiness: AgentReadiness[]
  isDiscovering: boolean
  onDiscover: () => void
  onConfigure: (profile: AgentProfile) => void
}

export function AgentSection({
  profiles,
  readiness,
  isDiscovering,
  onDiscover,
  onConfigure
}: AgentSectionProps): ReactElement {
  return (
    <>
      <div className="sidebar-header">
        <span className="sidebar-section-label">AGENTS</span>
        <div className="sidebar-header-actions">
          <button
            type="button"
            className="sidebar-btn"
            aria-label="Run health check"
            title="Run health check"
            data-testid="btn-discover-agents"
            disabled={isDiscovering}
            onClick={onDiscover}
          >
            <RefreshCw size={11} aria-hidden="true" className={isDiscovering ? 'spin' : undefined} />
          </button>
        </div>
      </div>

      <div className="agent-list">
        {profiles.length === 0 ? (
          <p className="workspace-list-empty">No agent profiles.</p>
        ) : (
          profiles.map((profile) => (
            <AgentItem
              key={profile.agentProfileId}
              profile={profile}
              readiness={readiness.find((r) => r.provider === profile.provider)}
              onConfigure={onConfigure}
            />
          ))
        )}
      </div>
    </>
  )
}
