import { useState, type KeyboardEvent, type ReactElement } from 'react'
import type { WorkspaceLayoutPreset } from '../../../shared/types/workspace'
import { LAYOUT_PRESETS } from './workspaceOptions'

interface WizardConfigureLayoutProps {
  rootPath: string
  onRootPathChange: (path: string) => void
  layoutPreset: WorkspaceLayoutPreset
  onLayoutPresetChange: (preset: WorkspaceLayoutPreset) => void
  isPickingFolder: boolean
  onPickFolder: () => void
  onNext: () => void
  onCancel: () => void
}

const PRESET_LABELS: Record<WorkspaceLayoutPreset, { label: string; description: string }> = {
  1:  { label: 'Single',       description: 'One terminal (default)' },
  2:  { label: '2 Sessions',   description: 'Side by side terminals' },
  4:  { label: '4 Sessions',   description: '2×2 terminal grid' },
  6:  { label: '6 Sessions',   description: '2×3 terminal grid' },
  8:  { label: '8 Sessions',   description: '2×4 terminal grid' },
  10: { label: '10 Sessions',  description: '2×5 terminal grid' },
  12: { label: '12 Sessions',  description: '3×4 terminal grid' },
  14: { label: '14 Sessions',  description: '2×7 terminal grid' },
  16: { label: '16 Sessions',  description: '4×4 terminal grid' }
}

function getGridDimensions(preset: WorkspaceLayoutPreset): { cols: number; rows: number } {
  if (preset === 1)  return { cols: 1, rows: 1 }
  if (preset === 2)  return { cols: 2, rows: 1 }
  if (preset === 4)  return { cols: 2, rows: 2 }
  if (preset === 6)  return { cols: 3, rows: 2 }
  if (preset === 8)  return { cols: 4, rows: 2 }
  if (preset === 10) return { cols: 5, rows: 2 }
  if (preset === 12) return { cols: 4, rows: 3 }
  if (preset === 14) return { cols: 7, rows: 2 }
  return { cols: 4, rows: 4 }
}

function LayoutIcon({ preset }: { preset: WorkspaceLayoutPreset }): ReactElement {
  const { cols, rows } = getGridDimensions(preset)
  return (
    <div
      className="wizard-layout-icon"
      style={{ gridTemplateColumns: `repeat(${cols}, 1fr)`, gridTemplateRows: `repeat(${rows}, 1fr)` }}
      aria-hidden="true"
    >
      {Array.from({ length: cols * rows }).map((_, i) => (
        <div key={i} className="wizard-layout-icon-cell" />
      ))}
    </div>
  )
}

export function WizardConfigureLayout({
  rootPath,
  onRootPathChange,
  layoutPreset,
  onLayoutPresetChange,
  isPickingFolder,
  onPickFolder,
  onNext,
  onCancel
}: WizardConfigureLayoutProps): ReactElement {
  const [terminalInput, setTerminalInput] = useState('')

  const applyTerminalPath = (): void => {
    const trimmed = terminalInput.trim()
    if (trimmed) {
      onRootPathChange(trimmed)
      setTerminalInput('')
    }
  }

  const handleTerminalKeyDown = (e: KeyboardEvent<HTMLInputElement>): void => {
    if (e.key === 'Enter') applyTerminalPath()
  }

  const selectedInfo = PRESET_LABELS[layoutPreset]

  return (
    <div className="wizard-step1-body">
      <p className="wizard-step-title">Configure Layout</p>
      <p className="wizard-step-subtitle">Choose your working directory and terminal grid layout.</p>

      <div className="wizard-section-label">Working Directory</div>
      <div className="wizard-dir-field">
        <input
          className="wizard-dir-input"
          type="text"
          value={rootPath}
          onChange={(e) => onRootPathChange(e.target.value)}
          placeholder="C:/projects/my-app"
          data-testid="wizard-dir-input"
        />
        <button
          type="button"
          className="wizard-browse-button"
          onClick={onPickFolder}
          disabled={isPickingFolder}
        >
          {isPickingFolder ? 'Picking…' : 'Browse'}
        </button>
      </div>

      <div className="wizard-terminal-row">
        <span className="wizard-terminal-prompt">&gt;_$</span>
        <input
          className="wizard-terminal-input"
          type="text"
          value={terminalInput}
          onChange={(e) => setTerminalInput(e.target.value)}
          onKeyDown={handleTerminalKeyDown}
          placeholder="cd /path/to/project"
          data-testid="wizard-terminal-input"
        />
        <button
          type="button"
          className="wizard-terminal-go"
          onClick={applyTerminalPath}
        >
          GO
        </button>
      </div>

      <div className="wizard-section-label">Layout Template</div>
      <div className="wizard-layout-grid" data-testid="wizard-layout-grid">
        {LAYOUT_PRESETS.map((preset) => (
          <button
            key={preset}
            type="button"
            className={`wizard-layout-card${layoutPreset === preset ? ' active' : ''}`}
            onClick={() => onLayoutPresetChange(preset)}
            data-testid={`wizard-layout-card-${preset}`}
          >
            <LayoutIcon preset={preset} />
            <span>{PRESET_LABELS[preset].label}</span>
          </button>
        ))}
      </div>

      <div className="wizard-template-preview">
        <div className="wizard-preview-icon">
          <LayoutIcon preset={layoutPreset} />
        </div>
        <div className="wizard-preview-label">
          <span className="wizard-preview-name">{selectedInfo.label}</span>
          <span className="wizard-preview-desc">{selectedInfo.description}</span>
        </div>
      </div>

      <div className="wizard-footer">
        <button type="button" className="wizard-btn-back" onClick={onCancel}>
          Cancel
        </button>
        <button
          type="button"
          className="wizard-btn-primary"
          onClick={onNext}
          disabled={!rootPath.trim()}
          data-testid="wizard-configure-agents-btn"
        >
          Configure Agents
        </button>
      </div>
    </div>
  )
}
