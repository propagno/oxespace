import { Check, FolderOpen, Minus, Plus, Terminal, X } from 'lucide-react'
import { useState, type ReactElement } from 'react'
import type { AgentProfile } from '../../../shared/types/agent'
import type { PaneAgentBinding, ShellProfile, WorkspaceLayoutPreset } from '../../../shared/types/workspace'
import { OxeLogo } from '../Brand/OxeLogo'
import { AgentProviderIcon } from '../Sidebar/AgentProviderIcon'
import { buildAgentSlots, getCopilotCommand, type AgentCount } from './fleetUtils'
import { LAYOUT_PRESETS } from './workspaceOptions'

export interface WizardLaunchInput {
  rootPath: string
  layoutPreset: WorkspaceLayoutPreset
  agentSlots: string[]
  agentBindings: PaneAgentBinding[]
}

interface NewWorkspaceModalProps {
  agentProfiles: AgentProfile[]
  shellProfiles: ShellProfile[]
  onLaunch: (input: WizardLaunchInput) => Promise<void>
  onPickFolder: () => Promise<string | null>
  onClose: () => void
}

const PRESET_LABELS: Record<WorkspaceLayoutPreset, { label: string; description: string; cols: number; rows: number }> = {
  1:  { label: '1 pane',  description: 'One terminal',     cols: 1, rows: 1 },
  2:  { label: '2 panes', description: 'Side by side',     cols: 2, rows: 1 },
  4:  { label: '4 panes', description: '2×2 grid',         cols: 2, rows: 2 },
  6:  { label: '6 panes', description: '2×3 grid',         cols: 3, rows: 2 },
  8:  { label: '8 panes', description: '2×4 grid',         cols: 4, rows: 2 },
  10: { label: '10 panes', description: '2×5 grid',        cols: 5, rows: 2 },
  12: { label: '12 panes', description: '3×4 grid',        cols: 4, rows: 3 },
  14: { label: '14 panes', description: '2×7 grid',        cols: 7, rows: 2 },
  16: { label: '16 panes', description: '4×4 grid',        cols: 4, rows: 4 }
}

export function NewWorkspaceModal({
  agentProfiles,
  shellProfiles,
  onLaunch,
  onPickFolder,
  onClose
}: NewWorkspaceModalProps): ReactElement {
  const [rootPath, setRootPath] = useState('')
  const [layoutPreset, setLayoutPreset] = useState<WorkspaceLayoutPreset>(4)
  const [agentCounts, setAgentCounts] = useState<Record<string, number>>({})
  const [powerShellCount, setPowerShellCount] = useState(0)
  const [isPickingFolder, setIsPickingFolder] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const totalSelected = Object.values(agentCounts).reduce((a, b) => a + b, 0) + powerShellCount
  const remaining = Math.max(0, layoutPreset - totalSelected)
  const hasFolder = rootPath.trim().length > 0
  const folderBasename = hasFolder
    ? rootPath.trim().split(/[\\/]/).filter(Boolean).at(-1) ?? rootPath.trim()
    : null

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
    setPowerShellCount(0)
  }

  const handleLaunch = async (): Promise<void> => {
    if (!rootPath.trim()) {
      setError('Choose a folder to continue.')
      return
    }
    setIsSubmitting(true)
    setError(null)
    try {
      const powerShellProfile = shellProfiles.find((profile) => profile.id === 'builtin-powershell')
        ?? shellProfiles.find((profile) => profile.name.toLowerCase() === 'powershell')
      if (powerShellCount > 0 && !powerShellProfile) {
        throw new Error('PowerShell profile is unavailable.')
      }
      const copilotCmd = getCopilotCommand(agentProfiles)
      const counts: AgentCount[] = Object.entries(agentCounts)
        .filter(([, c]) => c > 0)
        .map(([id, count]) => ({
          agentProfileId: id,
          command: agentProfiles.find((p) => p.agentProfileId === id)?.command ?? '',
          count
        }))
      const agentSlots = [
        ...buildAgentSlots(counts, layoutPreset - powerShellCount, copilotCmd),
        ...Array<string>(powerShellCount).fill('')
      ]
      const agentBindings = agentSlots.flatMap((cmd, paneIndex) => {
        if (!cmd) return []
        const profile = agentProfiles.find((p) => p.command === cmd)
        if (!profile) return []
        return [{ paneIndex, agentProfileId: profile.agentProfileId, agentName: profile.name }]
      })
      const powerShellBindings = Array.from({ length: powerShellCount }, (_, index) => ({
        paneIndex: agentSlots.length - powerShellCount + index,
        shellProfileId: powerShellProfile!.id
      }))
      await onLaunch({
        rootPath: rootPath.trim(),
        layoutPreset,
        agentSlots,
        agentBindings: [...agentBindings, ...powerShellBindings]
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create workspace')
      setIsSubmitting(false)
    }
  }

  const canLaunch = hasFolder && !isSubmitting

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
          <span className="new-workspace-header-icon" aria-hidden="true">
            <OxeLogo size={18} variant="compact" />
          </span>
          <div className="new-workspace-header-text">
            <h2 id="new-workspace-title">Create new workspace</h2>
            <p>Pick a folder, layout, and optional agents.</p>
          </div>
          <button type="button" className="icon-button" aria-label="Close" onClick={onClose}>
            <X size={14} aria-hidden="true" />
          </button>
        </header>

        <div className="new-workspace-body">
          <section className="new-workspace-section">
            <div className="new-workspace-section-title">Folder</div>
            <div className={`new-workspace-folder-zone${hasFolder ? ' has-path' : ''}`}>
              <div className="new-workspace-folder-zone-icon" aria-hidden="true">
                {hasFolder ? <Check size={16} /> : <FolderOpen size={16} />}
              </div>
              <div className="new-workspace-folder-zone-main">
                {hasFolder ? (
                  <>
                    <span className="new-workspace-folder-name">{folderBasename}</span>
                    <input
                      type="text"
                      className="new-workspace-folder-input"
                      value={rootPath}
                      onChange={(event) => setRootPath(event.currentTarget.value)}
                      data-testid="wizard-dir-input"
                      spellCheck={false}
                      aria-label="Workspace folder path"
                    />
                  </>
                ) : (
                  <>
                    <span className="new-workspace-folder-prompt">Choose a project folder</span>
                    <input
                      type="text"
                      className="new-workspace-folder-input"
                      placeholder="C:/projects/my-app"
                      value={rootPath}
                      onChange={(event) => setRootPath(event.currentTarget.value)}
                      data-testid="wizard-dir-input"
                      spellCheck={false}
                      autoFocus
                      aria-label="Workspace folder path"
                    />
                  </>
                )}
              </div>
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
                    title={meta.description}
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
              <span className="new-workspace-fleet-badges" data-testid="wizard-agent-counter">
                <span className="new-workspace-fleet-badge">
                  {totalSelected}/{layoutPreset} slots filled
                </span>
                {remaining > 0 ? (
                  <span className="new-workspace-fleet-badge muted">
                    {remaining} default shell{remaining === 1 ? '' : 's'}
                  </span>
                ) : null}
              </span>
            </div>
            <div className="new-workspace-agent-chips" data-testid="wizard-agent-list">
              <AgentChip
                name="PowerShell"
                icon={<Terminal size={12} aria-hidden="true" />}
                count={powerShellCount}
                totalSelected={totalSelected}
                layoutPreset={layoutPreset}
                onIncrement={() => setPowerShellCount((c) => c + 1)}
                onDecrement={() => setPowerShellCount((c) => Math.max(0, c - 1))}
                testId="wizard-powershell-only"
                countTestId="agent-count-powershell"
                addLabel="Add PowerShell"
                removeLabel="Remove one PowerShell"
                incLabel="Add another PowerShell"
              />
              {agentProfiles.length === 0 ? (
                <p className="new-workspace-empty">No agents configured. The workspace will start with default shells.</p>
              ) : (
                agentProfiles.map((agent) => {
                  const count = agentCounts[agent.agentProfileId] ?? 0
                  return (
                    <AgentChip
                      key={agent.agentProfileId}
                      name={agent.name}
                      icon={<AgentProviderIcon provider={agent.provider} />}
                      count={count}
                      totalSelected={totalSelected}
                      layoutPreset={layoutPreset}
                      onIncrement={() => incrementAgent(agent.agentProfileId)}
                      onDecrement={() => decrementAgent(agent.agentProfileId)}
                      testId={`agent-row-${agent.agentProfileId}`}
                      countTestId={`agent-count-${agent.agentProfileId}`}
                      addLabel={`Add ${agent.name}`}
                      removeLabel={`Remove one ${agent.name}`}
                      incLabel={`Add another ${agent.name}`}
                      decTestId={`agent-dec-${agent.agentProfileId}`}
                      incTestId={`agent-inc-${agent.agentProfileId}`}
                    />
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
            className="primary-action new-workspace-create-btn"
            onClick={() => void handleLaunch()}
            disabled={!canLaunch}
            data-testid="wizard-launch-btn"
            title={!hasFolder ? 'Choose a folder first' : undefined}
          >
            {isSubmitting ? 'Creating…' : 'Create workspace'}
          </button>
        </footer>
      </section>
    </div>
  )
}

function AgentChip({
  name,
  icon,
  count,
  totalSelected,
  layoutPreset,
  onIncrement,
  onDecrement,
  testId,
  countTestId,
  addLabel,
  removeLabel,
  incLabel,
  decTestId,
  incTestId
}: {
  name: string
  icon: ReactElement
  count: number
  totalSelected: number
  layoutPreset: number
  onIncrement: () => void
  onDecrement: () => void
  testId: string
  countTestId: string
  addLabel: string
  removeLabel: string
  incLabel: string
  decTestId?: string
  incTestId?: string
}): ReactElement {
  const selected = count > 0
  const slotsFull = totalSelected >= layoutPreset
  return (
    <div
      className={`new-workspace-agent-chip${selected ? ' selected' : ''}`}
      data-testid={testId}
    >
      <button
        type="button"
        className="new-workspace-agent-chip-body"
        onClick={onIncrement}
        disabled={!selected && slotsFull}
        aria-label={addLabel}
      >
        {icon}
        <span className="new-workspace-agent-chip-name">{name}</span>
      </button>
      <span className="new-workspace-agent-chip-count" aria-live="polite">
        <button
          type="button"
          className="new-workspace-agent-chip-step"
          onClick={onDecrement}
          disabled={count <= 0}
          aria-label={removeLabel}
          data-testid={decTestId}
        >
          <Minus size={11} aria-hidden="true" />
        </button>
        <span data-testid={countTestId}>{count}</span>
        <button
          type="button"
          className="new-workspace-agent-chip-step"
          onClick={onIncrement}
          disabled={slotsFull}
          aria-label={incLabel}
          data-testid={incTestId}
        >
          <Plus size={11} aria-hidden="true" />
        </button>
      </span>
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
