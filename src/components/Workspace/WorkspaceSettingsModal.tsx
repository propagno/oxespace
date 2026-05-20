import { Check, Maximize2, Minimize2, Palette, SquareTerminal, X } from 'lucide-react'
import { useState, type FormEvent, type ReactElement } from 'react'
import type { ShellProfile, UpdateWorkspaceSettingsInput, Workspace, WorkspaceDensity, WorkspaceLayoutPreset, WorkspaceThemeId } from '../../../shared/types/workspace'
import { LAYOUT_PRESETS, WORKSPACE_THEMES } from './workspaceOptions'

interface WorkspaceSettingsModalProps {
  workspace: Workspace
  shellProfiles: ShellProfile[]
  onClose: () => void
  onSave: (input: UpdateWorkspaceSettingsInput) => Promise<void>
}

// Each preset maps to a grid shape that we draw as a mini-SVG inside its card,
// so users see what the layout looks like before applying.
const PRESET_GRIDS: Record<WorkspaceLayoutPreset, { rows: number; cols: number }> = {
  1: { rows: 1, cols: 1 },
  2: { rows: 1, cols: 2 },
  4: { rows: 2, cols: 2 },
  6: { rows: 2, cols: 3 },
  8: { rows: 2, cols: 4 },
  10: { rows: 2, cols: 5 },
  12: { rows: 3, cols: 4 },
  14: { rows: 2, cols: 7 },
  16: { rows: 4, cols: 4 }
}

// Accent colors per theme — matches the runtime `--accent` from tokens.css.
// Showing them as color swatches gives users an instant visual identity check.
const THEME_ACCENTS: Record<WorkspaceThemeId, { bg: string; accent: string }> = {
  midnight: { bg: '#0a111a', accent: '#12C79A' },
  nord:     { bg: '#0b1119', accent: '#88c0d0' },
  dracula:  { bg: '#151320', accent: '#bd93f9' },
  ocean:    { bg: '#001318', accent: '#22d3ee' },
  monokai:  { bg: '#11110d', accent: '#a6e22e' },
  amber:    { bg: '#130d05', accent: '#f59e0b' }
}

export function WorkspaceSettingsModal({ onClose, onSave, shellProfiles, workspace }: WorkspaceSettingsModalProps): ReactElement {
  const [themeId, setThemeId] = useState<WorkspaceThemeId>(workspace.themeId)
  const [uiDensity, setUiDensity] = useState<WorkspaceDensity>(workspace.uiDensity)
  const [layoutPreset, setLayoutPreset] = useState<WorkspaceLayoutPreset>(workspace.layoutPreset)
  const [defaultShellProfileId, setDefaultShellProfileId] = useState(workspace.defaultShellProfileId)
  const [applyShellToIdlePanes, setApplyShellToIdlePanes] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [isSaving, setSaving] = useState(false)

  const handleSubmit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault()
    setSaving(true)
    setError(null)
    try {
      await onSave({
        workspaceId: workspace.id,
        themeId,
        uiDensity,
        layoutPreset,
        defaultShellProfileId,
        applyShellToIdlePanes
      })
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update workspace settings')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="modal-backdrop" role="presentation">
      <section className="modal workspace-settings-modal-v2" role="dialog" aria-modal="true" aria-labelledby="workspace-settings-title">
        <header className="modal-header">
          <h2 id="workspace-settings-title">Workspace settings</h2>
          <button type="button" className="icon-button" aria-label="Close workspace settings" onClick={onClose}>
            <X size={16} aria-hidden="true" />
          </button>
        </header>

        <form className="modal-form ws-settings-form" onSubmit={handleSubmit}>
          <section className="ws-settings-section" aria-labelledby="ws-section-appearance">
            <header className="ws-settings-section-header">
              <Palette size={14} aria-hidden="true" />
              <h3 id="ws-section-appearance">Appearance</h3>
            </header>

            <div className="ws-settings-field-label">Theme</div>
            <div className="theme-card-grid" role="radiogroup" aria-label="Theme">
              {WORKSPACE_THEMES.map((theme) => {
                const palette = THEME_ACCENTS[theme.id]
                const selected = themeId === theme.id
                return (
                  <button
                    key={theme.id}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    className={`theme-card${selected ? ' selected' : ''}`}
                    onClick={() => setThemeId(theme.id)}
                  >
                    <div className="theme-card-preview" style={{ background: palette.bg }} aria-hidden="true">
                      <span className="theme-card-accent" style={{ background: palette.accent }} />
                      <span className="theme-card-line" />
                      <span className="theme-card-line short" />
                    </div>
                    <div className="theme-card-meta">
                      <span className="theme-card-name">{theme.label}</span>
                      {selected ? <Check size={11} aria-hidden="true" /> : null}
                    </div>
                  </button>
                )
              })}
            </div>

            <div className="ws-settings-field-label">Density</div>
            <div className="density-toggle" role="radiogroup" aria-label="Density">
              <button
                type="button"
                role="radio"
                aria-checked={uiDensity === 'compact'}
                className={`density-option${uiDensity === 'compact' ? ' selected' : ''}`}
                onClick={() => setUiDensity('compact')}
              >
                <Minimize2 size={13} aria-hidden="true" />
                <span>Compact</span>
              </button>
              <button
                type="button"
                role="radio"
                aria-checked={uiDensity === 'comfortable'}
                className={`density-option${uiDensity === 'comfortable' ? ' selected' : ''}`}
                onClick={() => setUiDensity('comfortable')}
              >
                <Maximize2 size={13} aria-hidden="true" />
                <span>Comfortable</span>
              </button>
            </div>
          </section>

          <section className="ws-settings-section" aria-labelledby="ws-section-layout">
            <header className="ws-settings-section-header">
              <SquareTerminal size={14} aria-hidden="true" />
              <h3 id="ws-section-layout">Layout</h3>
            </header>
            <div className="layout-card-grid" role="radiogroup" aria-label="Layout preset">
              {LAYOUT_PRESETS.map((preset) => {
                const grid = PRESET_GRIDS[preset]
                const selected = layoutPreset === preset
                return (
                  <button
                    key={preset}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    className={`layout-card${selected ? ' selected' : ''}`}
                    onClick={() => setLayoutPreset(preset)}
                    title={`${grid.rows}×${grid.cols} (${preset} panes)`}
                  >
                    <LayoutPreview rows={grid.rows} cols={grid.cols} />
                    <span className="layout-card-label">{preset}</span>
                  </button>
                )
              })}
            </div>
          </section>

          <section className="ws-settings-section" aria-labelledby="ws-section-shell">
            <header className="ws-settings-section-header">
              <SquareTerminal size={14} aria-hidden="true" />
              <h3 id="ws-section-shell">Default shell</h3>
            </header>
            <label className="field">
              <span>Shell profile</span>
              <select value={defaultShellProfileId} onChange={(event) => setDefaultShellProfileId(event.target.value)}>
                {shellProfiles.map((profile) => (
                  <option key={profile.id} value={profile.id}>
                    {profile.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="checkbox-field">
              <input
                type="checkbox"
                checked={applyShellToIdlePanes}
                onChange={(event) => setApplyShellToIdlePanes(event.currentTarget.checked)}
              />
              <span>Apply this shell to existing idle panes</span>
            </label>
          </section>

          {error ? <div className="modal-error" role="alert">{error}</div> : null}

          <footer className="modal-actions">
            <button type="button" className="secondary-action" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="primary-action" disabled={isSaving}>
              {isSaving ? 'Saving…' : 'Save'}
            </button>
          </footer>
        </form>
      </section>
    </div>
  )
}

function LayoutPreview({ rows, cols }: { rows: number; cols: number }): ReactElement {
  // Mini grid of cells — purely decorative so screen readers ignore it.
  const cells: ReactElement[] = []
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      cells.push(<span key={`${r}:${c}`} className="layout-card-cell" />)
    }
  }
  return (
    <div
      className="layout-card-preview"
      style={{ gridTemplateColumns: `repeat(${cols}, 1fr)`, gridTemplateRows: `repeat(${rows}, 1fr)` }}
      aria-hidden="true"
    >
      {cells}
    </div>
  )
}
