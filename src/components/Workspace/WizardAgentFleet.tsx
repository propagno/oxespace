import { type ReactElement } from 'react'
import type { AgentProfile } from '../../../shared/types/agent'
import { buildAgentSlots, distributeEvenly, distributeOneEach, fillFirst } from './fleetUtils'

interface WizardAgentFleetProps {
  agents: AgentProfile[]
  totalSlots: number
  agentCounts: Record<string, number>
  onAgentCountsChange: (counts: Record<string, number>) => void
  onBack: () => void
  onSkip: () => void
  onLaunch: () => void
  isSubmitting: boolean
}

export function WizardAgentFleet({
  agents,
  totalSlots,
  agentCounts,
  onAgentCountsChange,
  onBack,
  onSkip,
  onLaunch,
  isSubmitting
}: WizardAgentFleetProps): ReactElement {
  const sum = Object.values(agentCounts).reduce((a, b) => a + b, 0)
  const isFull = sum === totalSlots
  const isEmpty = sum === 0
  const fillPct = totalSlots > 0 ? Math.min(100, (sum / totalSlots) * 100) : 0

  const countsFromFleet = (counts: ReturnType<typeof fillFirst>): Record<string, number> =>
    Object.fromEntries(counts.map((c) => [c.agentProfileId, c.count]))

  const handleSelectAll = (): void => {
    onAgentCountsChange(countsFromFleet(fillFirst(agents, totalSlots)))
  }

  const handleOneEach = (): void => {
    onAgentCountsChange(countsFromFleet(distributeOneEach(agents, totalSlots)))
  }

  const handleFillEvenly = (): void => {
    onAgentCountsChange(countsFromFleet(distributeEvenly(agents, totalSlots)))
  }

  const handleClear = (): void => {
    onAgentCountsChange({})
  }

  const setCount = (agentProfileId: string, count: number): void => {
    onAgentCountsChange({ ...agentCounts, [agentProfileId]: Math.max(0, count) })
  }

  const toggleAgent = (agentProfileId: string): void => {
    const current = agentCounts[agentProfileId] ?? 0
    setCount(agentProfileId, current > 0 ? 0 : 1)
  }

  const fillAllToAgent = (agentProfileId: string): void => {
    const newCounts: Record<string, number> = {}
    for (const a of agents) {
      newCounts[a.agentProfileId] = a.agentProfileId === agentProfileId ? totalSlots : 0
    }
    onAgentCountsChange(newCounts)
  }

  return (
    <div className="wizard-step2-body">
      <div className="wizard-step2-agents">
        <p className="wizard-step-title">AI Agent Fleet</p>
        <p className="wizard-step-subtitle">
          Provision agents for your {totalSlots} terminal session{totalSlots !== 1 ? 's' : ''}.
        </p>

        <div className="wizard-quick-actions">
          <button type="button" className="wizard-chip" onClick={handleSelectAll}>
            Select All
          </button>
          <button type="button" className="wizard-chip" onClick={handleOneEach}>
            1 Each
          </button>
          <button type="button" className="wizard-chip" onClick={handleFillEvenly}>
            Fill Evenly
          </button>
          {!isEmpty && (
            <button type="button" className="wizard-chip danger" onClick={handleClear}>
              Clear
            </button>
          )}
        </div>

        <div className="wizard-agent-list" data-testid="wizard-agent-list">
          {agents.map((agent) => {
            const count = agentCounts[agent.agentProfileId] ?? 0
            const isSelected = count > 0
            return (
              <div
                key={agent.agentProfileId}
                className={`wizard-agent-row${isSelected ? ' selected' : ''}`}
                data-testid={`agent-row-${agent.agentProfileId}`}
              >
                <input
                  type="checkbox"
                  className="wizard-agent-checkbox"
                  checked={isSelected}
                  onChange={() => toggleAgent(agent.agentProfileId)}
                  aria-label={`Toggle ${agent.name}`}
                />
                <div className="wizard-agent-info">
                  <span className="wizard-agent-name">{agent.name}</span>
                  <span className="wizard-agent-provider">{agent.provider}</span>
                </div>
                <button
                  type="button"
                  className="wizard-agent-badge"
                  onClick={() => fillAllToAgent(agent.agentProfileId)}
                  title={`Assign all ${totalSlots} slots to ${agent.name}`}
                >
                  All {totalSlots}
                </button>
                <div className="wizard-agent-counter">
                  <button
                    type="button"
                    className="wizard-counter-btn"
                    onClick={() => setCount(agent.agentProfileId, count - 1)}
                    disabled={count === 0}
                    aria-label={`Decrease ${agent.name} count`}
                    data-testid={`agent-dec-${agent.agentProfileId}`}
                  >
                    −
                  </button>
                  <span
                    className="wizard-counter-value"
                    data-testid={`agent-count-${agent.agentProfileId}`}
                  >
                    {count}
                  </span>
                  <button
                    type="button"
                    className="wizard-counter-btn"
                    onClick={() => setCount(agent.agentProfileId, count + 1)}
                    aria-label={`Increase ${agent.name} count`}
                    data-testid={`agent-inc-${agent.agentProfileId}`}
                  >
                    +
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      </div>

      <div className="wizard-step2-sidebar">
        <div className="wizard-fleet-panel">
          <div className="wizard-fleet-title">Fleet Utilization</div>
          <div className="wizard-fleet-count" data-testid="fleet-count">
            {sum} <span>/ {totalSlots} slots</span>
          </div>
          <div className="wizard-fleet-bar">
            <div
              className={`wizard-fleet-bar-fill${isFull ? ' full' : ''}`}
              style={{ width: `${fillPct}%` }}
              data-testid="fleet-bar-fill"
            />
          </div>
          <div className={`wizard-fleet-status-row${isFull ? ' full' : ''}`} data-testid="fleet-status">
            {isEmpty ? 'No agents selected' : isFull ? 'Fleet configured' : 'Optimal slot density'}
          </div>
        </div>

        <div className="wizard-footer" style={{ marginTop: 'auto', flexDirection: 'column', alignItems: 'stretch', gap: 8 }}>
          <button
            type="button"
            className="wizard-btn-primary"
            onClick={onLaunch}
            disabled={isSubmitting}
            data-testid="wizard-launch-btn"
          >
            {isSubmitting ? 'Launching…' : 'Launch Workspace'}
          </button>
          <button
            type="button"
            className="wizard-btn-skip"
            onClick={onSkip}
            disabled={isSubmitting}
            data-testid="wizard-skip-btn"
          >
            Skip Agents
          </button>
          <button
            type="button"
            className="wizard-btn-back"
            onClick={onBack}
            disabled={isSubmitting}
            data-testid="wizard-back-btn"
          >
            ← Back
          </button>
        </div>
      </div>
    </div>
  )
}
