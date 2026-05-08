import { Settings } from 'lucide-react'
import type { ReactElement } from 'react'
import type { AgentProfile, AgentReadiness } from '../../../shared/types/agent'

interface AgentItemProps {
  profile: AgentProfile
  readiness: AgentReadiness | undefined
  onConfigure: (profile: AgentProfile) => void
}

function ReadinessBadge({ status }: { status: AgentReadiness['status'] | undefined }): ReactElement {
  if (!status) return <span className="agent-badge missing">?</span>
  return <span className={`agent-badge ${status}`}>{status}</span>
}

export function AgentItem({ profile, readiness, onConfigure }: AgentItemProps): ReactElement {
  return (
    <div className="agent-item" data-testid="sidebar-agent-item">
      <div className="agent-item-info">
        <span className="agent-item-name">{profile.name}</span>
        <ReadinessBadge status={readiness?.status} />
      </div>
      <button
        type="button"
        className="agent-item-config"
        aria-label={`Configure ${profile.name}`}
        title="Configure"
        onClick={() => onConfigure(profile)}
      >
        <Settings size={11} aria-hidden="true" />
      </button>
    </div>
  )
}
