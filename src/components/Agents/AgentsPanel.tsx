import { Bot, GitBranch, Plus, RefreshCw } from 'lucide-react'
import { useState, type ReactElement } from 'react'
import type { AgentProfile, AgentReadiness } from '../../../shared/types/agent'
import type { Workspace } from '../../../shared/types/workspace'
import { BUILTIN_AGENTS, useAgentStore } from '../../store/agent.store'
import { AgentsWorkflowPanel } from '../AgentsWorkflow/AgentsWorkflowPanel'
import { AgentConfigModal } from './AgentConfigModal'

type Tab = 'agents' | 'workflow'

interface AgentsPanelProps {
  workspace: Workspace
  activePaneId: string | null
  onOpenArtifact: (content: string, title: string) => void
}

function readinessFor(profile: AgentProfile, readiness: AgentReadiness[]): AgentReadiness | undefined {
  return readiness.find((r) => r.provider === profile.provider)
}

function StatusDot({ status }: { status: AgentReadiness['status'] | undefined }): ReactElement {
  const cls = status === 'ready' ? 'green' : status === 'partial' ? 'yellow' : status === 'missing' ? 'red' : ''
  return <span className={`statusbar-dot ${cls}`} aria-hidden="true" />
}

function AgentRow({ profile, readiness, onConfigure }: {
  profile: AgentProfile
  readiness: AgentReadiness | undefined
  onConfigure: () => void
}): ReactElement {
  return (
    <div className="agents-panel-row">
      <StatusDot status={profile.provider === 'oxe' ? 'ready' : readiness?.status} />
      <div className="agents-panel-row-info">
        <strong>{profile.name}</strong>
        {profile.parentProvider ? (
          <span className="agents-row-meta">
            <span className="agent-parent-badge">{profile.parentProvider}</span>
            {profile.systemPrompt ? (
              <span className="agent-skill-preview">
                {profile.systemPrompt.length > 60
                  ? `${profile.systemPrompt.slice(0, 60)}…`
                  : profile.systemPrompt}
              </span>
            ) : null}
          </span>
        ) : (
          <span>{profile.command}</span>
        )}
      </div>
      {!profile.isBuiltin && (
        <button type="button" className="secondary-action compact-action" onClick={onConfigure}>
          Configure
        </button>
      )}
    </div>
  )
}

export function AgentsPanel({ activePaneId, onOpenArtifact, workspace }: AgentsPanelProps): ReactElement {
  const { profiles, readiness, isDiscovering, discover, loadProfiles, loadReadiness, createProfile, deleteProfile, updateProfile } = useAgentStore()
  const [tab, setTab] = useState<Tab>('agents')
  const [configuring, setConfiguring] = useState<AgentProfile | null>(null)

  const connectedProfiles = profiles.filter((p) => p.provider !== 'custom' && p.provider !== 'oxe')
  const customProfiles = profiles.filter((p) => p.provider === 'custom')

  return (
    <>
      <div className="agents-panel-root">
        <div className="agents-panel-tabs">
          <button
            type="button"
            className={`agents-panel-tab ${tab === 'agents' ? 'active' : ''}`}
            onClick={() => { setTab('agents') }}
          >
            <Bot size={12} aria-hidden="true" />
            Agents
          </button>
          <button
            type="button"
            className={`agents-panel-tab ${tab === 'workflow' ? 'active' : ''}`}
            onClick={() => { setTab('workflow') }}
          >
            <GitBranch size={12} aria-hidden="true" />
            Workflow
          </button>
        </div>

        {tab === 'agents' && (
          <div className="agents-panel-agents">
            <div className="agents-panel-section">
              <div className="agents-panel-section-header">
                <span>OXE Built-in</span>
              </div>
              {BUILTIN_AGENTS.map((p) => (
                <AgentRow key={p.agentProfileId} profile={p} readiness={undefined} onConfigure={() => undefined} />
              ))}
            </div>

            <div className="agents-panel-section">
              <div className="agents-panel-section-header">
                <span>Providers</span>
                <button
                  type="button"
                  className="icon-button"
                  aria-label="Run health check"
                  title="Health check"
                  disabled={isDiscovering}
                  onClick={() => void discover(true)}
                >
                  <RefreshCw size={11} aria-hidden="true" className={isDiscovering ? 'spin' : undefined} />
                </button>
              </div>
              {connectedProfiles.length === 0
                ? <p className="agents-panel-empty">No providers configured.</p>
                : connectedProfiles.map((p) => (
                  <AgentRow
                    key={p.agentProfileId}
                    profile={p}
                    readiness={readinessFor(p, readiness)}
                    onConfigure={() => { setConfiguring(p) }}
                  />
                ))
              }
            </div>

            <div className="agents-panel-section">
              <div className="agents-panel-section-header">
                <span>Custom</span>
                <button
                  type="button"
                  className="icon-button"
                  aria-label="New custom agent"
                  title="New agent"
                  onClick={() => {
                    setConfiguring({ agentProfileId: '', name: '', provider: 'custom', command: '', commandTemplate: '', isBuiltin: false })
                  }}
                >
                  <Plus size={11} aria-hidden="true" />
                </button>
              </div>
              {customProfiles.length === 0
                ? <p className="agents-panel-empty">No custom agents yet.</p>
                : customProfiles.map((p) => (
                  <AgentRow
                    key={p.agentProfileId}
                    profile={p}
                    readiness={readinessFor(p, readiness)}
                    onConfigure={() => { setConfiguring(p) }}
                  />
                ))
              }
            </div>
          </div>
        )}

        {tab === 'workflow' && (
          <div className="agents-panel-workflow">
            <AgentsWorkflowPanel workspaceId={workspace.id} activePaneId={activePaneId} onOpenArtifact={onOpenArtifact} />
          </div>
        )}
      </div>

      {configuring !== null && (
        <AgentConfigModal
          profile={configuring}
          readiness={readiness.find((r) => r.provider === configuring.provider)}
          isDiscovering={isDiscovering}
          onSave={async (id, input) => {
            if (id === '') {
              await createProfile({
                name: input.name ?? '',
                provider: 'custom',
                command: '',
                commandTemplate: '',
                parentProvider: input.parentProvider,
                systemPrompt: input.systemPrompt
              })
            } else {
              await updateProfile(id, input)
            }
            await loadProfiles()
            await loadReadiness()
            setConfiguring(null)
          }}
          onDelete={async (id) => {
            await deleteProfile(id)
            setConfiguring(null)
          }}
          onHealthCheck={() => void discover(true)}
          onClose={() => { setConfiguring(null) }}
        />
      )}
    </>
  )
}
