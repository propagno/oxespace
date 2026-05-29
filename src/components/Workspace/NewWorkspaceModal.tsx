import { FolderOpen, Plus, X } from 'lucide-react'
import { useState, type ReactElement } from 'react'
import type { AgentProfile } from '../../../shared/types/agent'
import type { ShellProfile, WorkspaceLayoutPreset } from '../../../shared/types/workspace'
import { OxeLogo } from '../Brand/OxeLogo'
import { AgentProviderIcon } from '../Sidebar/AgentProviderIcon'
import { buildAgentSlots, getCopilotCommand, type AgentCount } from './fleetUtils'
import { LAYOUT_PRESETS } from './workspaceOptions'

export interface WizardLaunchInput {
  rootPath: string
  layoutPreset: WorkspaceLayoutPreset
  agentSlots: string[]
  agentBindings: Array<{ paneIndex: number; agentProfileId: string; agentName: string }>
}

interface NewWorkspaceModalProps {
  agentProfiles: AgentProfile[]
  shellProfiles: ShellProfile[]
  onLaunch: (input: WizardLaunchInput) => Promise<void>
  onPickFolder: () => Promise<string | null>
  onClose: () => void
}

const PRESET_LABELS: Record<WorkspaceLayoutPreset, { label: string; description: string; cols: number; rows: number }> = {
  1:  { label: 'Single',     description: 'One terminal',     cols: 1, rows: 1 },
  2:  { label: '2 sessions', description: 'Side by side',     cols: 2, rows: 1 },
  4:  { label: '4 sessions', description: '2×2 grid',         cols: 2, rows: 2 },
  6:  { label: '6 sessions', description: '2×3 grid',         cols: 3, rows: 2 },
  8:  { label: '8 sessions', description: '2×4 grid',         cols: 4, rows: 2 },
  10: { label: '10 sessions',description: '2×5 grid',         cols: 5, rows: 2 },
  12: { label: '12 sessions',description: '3×4 grid',         cols: 4, rows: 3 },
  14: { label: '14 sessions',description: '2×7 grid',         cols: 7, rows: 2 },
  16: { label: '16 sessions',description: '4×4 grid',         cols: 4, rows: 4 }
}

export function NewWorkspaceModal({
  agentProfiles,
  onLaunch,
  onPickFolder,
  onClose
}: NewWorkspaceModalProps): ReactElement {
  const [rootPath, setRootPath] = useState('')
  const [layoutPreset, setLayoutPreset] = useState<WorkspaceLayoutPreset>(4)
  const [agentCounts, setAgentCounts] = useState<Record<string, number>>({})
  const [isPickingFolder, setIsPickingFolder] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const totalSelected = Object.values(agentCounts).reduce((a, b) => a + b, 0)
  const remaining = Math.max(0, layoutPreset - totalSelected)

  const handlePickFolder = async (): Promise<void> => {
    setIsPickingFolder(true)
    try {
      const folder = await onPickFolder()
      if (folder) setRootPath(folder)
    } finally {
      setIsPickingFolder(false)
    }
  }

  const incrementAgent = (agentProfileId: string): void => {
    if (totalSelected >= layoutPreset) return
    setAgentCounts((prev) => ({ ...prev, [agentProfileId]: (prev[agentProfileId] ?? 0) + 1 }))
  }

  const decrementAgent = (agentProfileId: string): void => {
    setAgentCounts((prev) => {
      const current = prev[agentProfileId] ?? 0
      if (current <= 0) return prev
      return { ...prev, [agentProfileId]: current - 1 }
    })
  }

  const clearAgents = (): void => {
    setAgentCounts({})
  }

  const handleLaunch = async (): Promise<void> => {
    if (!rootPath.trim()) {
      setError('Choose a folder to continue.')
      return
    }
    setIsSubmitting(true)
    setError(null)
    try {
      const copilotCmd = getCopilotCommand(agentProfiles)
      const counts: AgentCount[] = Object.entries(agentCounts)
        .filter(([, c]) => c > 0)
        .map(([id, count]) => ({
          agentProfileId: id,
          command: agentProfiles.find((p) => p.agentProfileId === id)?.command ?? '',
          count
        }))
      const agentSlots = buildAgentSlots(counts, layoutPreset, copilotCmd)
      const agentBindings = agentSlots.flatMap((cmd, paneIndex) => {
        if (!cmd) return []
        const profile = agentProfiles.find((p) => p.command === cmd)
        if (!profile) return []
        return [{ paneIndex, agentProfileId: profile.agentProfileId, agentName: profile.name }]
      })
      await onLaunch({ rootPath: rootPath.trim(), layoutPreset, agentSlots, agentBindings })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create workspace')
      setIsSubmitting(false)
    }
  }

  const canLaunch = rootPath.trim().length > 0 && !isSubmitting

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={onClose}>
      <section
        className="modal new-workspace-modal-v2"
        role="dialog"
        aria-modal="true"
        aria-labelledby="new-workspace-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="new-workspace-header">
          <OxeLogo size={20} variant="compact" />
          <h2 id="new-workspace-title">Create new workspace</h2>
          <button type="button" className="icon-button" aria-label="Close" onClick={onClose}>
            <X size={14} aria-hidden="true" />
          </button>
        </header>

        <div className="new-workspace-body">
          <section className="new-workspace-section">
            <div className="new-workspace-section-title">Folder</div>
            <div className="new-workspace-folder-row">
              <input
                type="text"
                className="new-workspace-folder-input"
                placeholder="C:/projects/my-app"
                value={rootPath}
                onChange={(event) => setRootPath(event.currentTarget.value)}
                data-testid="wizard-dir-input"
                spellCheck={false}
                autoFocus
              />
              <button
                type="button"
                className="new-workspace-folder-browse"
                onClick={() => void handlePickFolder()}
                disabled={isPickingFolder}
              >
                <FolderOpen size={13} aria-hidden="true" />
                {isPickingFolder ? 'Picking…' : 'Browse'}
              </button>
            </div>
          </section>

          <section className="new-workspace-section">
            <div className="new-workspace-section-title">Layout</div>
            <div className="new-workspace-layout-grid" role="radiogroup" aria-label="Layout preset" data-testid="wizard-layout-grid">
              {LAYOUT_PRESETS.map((preset) => {
                const meta = PRESET_LABELS[preset]
                const selected = layoutPreset === preset
                return (
                  <button
                    key={preset}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    className={`new-workspace-layout-card${selected ? ' selected' : ''}`}
                    onClick={() => setLayoutPreset(preset)}
                    data-testid={`wizard-layout-card-${preset}`}
                  >
                    <LayoutPreview cols={meta.cols} rows={meta.rows} />
                    <span className="new-workspace-layout-label">{meta.label}</span>
                  </button>
                )
              })}
            </div>
          </section>

          <section className="new-workspace-section">
            <div className="new-workspace-section-title">
              <span>Agents</span>
              <span className="new-workspace-fleet-counter">
                {totalSelected}/{layoutPreset} slots
                {remaining > 0 ? <em> · {remaining} default</em> : null}
              </span>
            </div>
            <div className="new-workspace-agent-chips" data-testid="wizard-agent-list">
              {agentProfiles.length === 0 ? (
                <p className="new-workspace-empty">No agents configured. The workspace will start with default shells.</p>
              ) : (
                agentProfiles.map((agent) => {
                  const count = agentCounts[agent.agentProfileId] ?? 0
                  const selected = count > 0
                  return (
                    <div
                      key={agent.agentProfileId}
                      className={`new-workspace-agent-chip${selected ? ' selected' : ''}`}
                      data-testid={`agent-row-${agent.agentProfileId}`}
                    >
                      <button
                        type="button"
                        className="new-workspace-agent-chip-body"
                        onClick={() => incrementAgent(agent.agentProfileId)}
                        disabled={!selected && totalSelected >= layoutPreset}
                        aria-label={`Add ${agent.name}`}
                      >
                        <AgentProviderIcon provider={agent.provider} />
                        <span className="new-workspace-agent-chip-name">{agent.name}</span>
                      </button>
                      {selected ? (
                        <span className="new-workspace-agent-chip-count" aria-live="polite">
                          <button
                            type="button"
                            className="new-workspace-agent-chip-step"
                            onClick={() => decrementAgent(agent.agentProfileId)}
                            aria-label={`Remove one ${agent.name}`}
                            data-testid={`agent-dec-${agent.agentProfileId}`}
                          >
                            −
                          </button>
                          <span data-testid={`agent-count-${agent.agentProfileId}`}>{count}</span>
                          <button
                            type="button"
                            className="new-workspace-agent-chip-step"
                            onClick={() => incrementAgent(agent.agentProfileId)}
                            disabled={totalSelected >= layoutPreset}
                            aria-label={`Add another ${agent.name}`}
                            data-testid={`agent-inc-${agent.agentProfileId}`}
                          >
                            +
                          </button>
                        </span>
                      ) : (
                        <Plus size={11} aria-hidden="true" className="new-workspace-agent-chip-plus" />
                      )}
                    </div>
                  )
                })
              )}
            </div>
            {totalSelected > 0 ? (
              <button type="button" className="new-workspace-clear" onClick={clearAgents}>
                Clear selection
              </button>
            ) : null}
          </section>

          {error ? <div className="modal-error" role="alert">{error}</div> : null}
        </div>

        <footer className="new-workspace-footer">
          <button type="button" className="secondary-action" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="primary-action"
            onClick={() => void handleLaunch()}
            disabled={!canLaunch}
            data-testid="wizard-launch-btn"
          >
            {isSubmitting ? 'Creating…' : 'Create workspace'}
          </button>
        </footer>
      </section>
    </div>
  )
}

function LayoutPreview({ rows, cols }: { rows: number; cols: number }): ReactElement {
  const cells: ReactElement[] = []
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      cells.push(<span key={`${r}:${c}`} className="new-workspace-layout-cell" />)
    }
  }
  return (
    <div
      className="new-workspace-layout-preview"
      style={{ gridTemplateColumns: `repeat(${cols}, 1fr)`, gridTemplateRows: `repeat(${rows}, 1fr)` }}
      aria-hidden="true"
    >
      {cells}
    </div>
  )
}
