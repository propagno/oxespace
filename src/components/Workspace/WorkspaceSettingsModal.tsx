import { Check, Maximize2, Minimize2, Palette, SquareTerminal, X } from 'lucide-react'
import { useState, type FormEvent, type ReactElement } from 'react'
import type { ShellProfile, UpdateWorkspaceSettingsInput, Workspace, WorkspaceDensity, WorkspaceLayoutPreset, WorkspaceThemeId } from '../../../shared/types/workspace'
import { LAYOUT_PRESETS, WORKSPACE_THEMES } from './workspaceOptions'
import { useResolvedTerminalPrefs, useTerminalPrefsStore, type TerminalCursorStyle, type TerminalPrefs } from '../../store/terminal-prefs.store'

interface WorkspaceSettingsModalProps {
  workspace: Workspace
  shellProfiles: ShellProfile[]
  onClose: () => void
  onSave: (input: UpdateWorkspaceSettingsInput) => Promise<void>
}

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

// Per-theme palette — mirrors the runtime tokens in tokens.css so the preview
// shows the SELECTED theme regardless of the app's currently-active theme.
interface ThemePalette { bg: string; elevated: string; tx: string; muted: string; accent: string }
const THEME_PALETTES: Record<WorkspaceThemeId, ThemePalette> = {
  midnight: { bg: '#000000', elevated: '#121212', tx: '#f1f5f9', muted: '#636b75', accent: '#12C79A' },
  nord:     { bg: '#0b1119', elevated: '#182230', tx: '#eceff4', muted: '#7f8da3', accent: '#88c0d0' },
  dracula:  { bg: '#151320', elevated: '#282a36', tx: '#f8f8f2', muted: '#807996', accent: '#bd93f9' },
  ocean:    { bg: '#001318', elevated: '#082b33', tx: '#e6fbff', muted: '#5b8c96', accent: '#22d3ee' },
  monokai:  { bg: '#11110d', elevated: '#24251a', tx: '#f8f8f2', muted: '#8b8c6b', accent: '#a6e22e' },
  amber:    { bg: '#130d05', elevated: '#27190a', tx: '#fff7ed', muted: '#a67b50', accent: '#f59e0b' }
}

const CURSOR_OPTIONS: Array<{ value: TerminalCursorStyle; label: string }> = [
  { value: 'block', label: 'Bloco' },
  { value: 'bar', label: 'Barra' },
  { value: 'underline', label: 'Sublinhado' }
]

const FONT_PRESETS = [
  'Cascadia Mono, Consolas, monospace',
  'Cascadia Code, monospace',
  'JetBrains Mono, monospace',
  'Fira Code, monospace',
  'Consolas, monospace',
  'monospace'
]

export function WorkspaceSettingsModal({ onClose, onSave, shellProfiles, workspace }: WorkspaceSettingsModalProps): ReactElement {
  const [themeId, setThemeId] = useState<WorkspaceThemeId>(workspace.themeId)
  const [uiDensity, setUiDensity] = useState<WorkspaceDensity>(workspace.uiDensity)
  const [layoutPreset, setLayoutPreset] = useState<WorkspaceLayoutPreset>(workspace.layoutPreset)
  const [defaultShellProfileId, setDefaultShellProfileId] = useState(workspace.defaultShellProfileId)
  const [applyShellToIdlePanes, setApplyShellToIdlePanes] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [isSaving, setSaving] = useState(false)

  // Resolved terminal prefs (global ← workspace override) — drives the preview
  // live as the user edits the Terminal section below.
  const terminalPrefs = useResolvedTerminalPrefs(workspace.id)

  const handleSubmit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault()
    setSaving(true)
    setError(null)
    try {
      await onSave({ workspaceId: workspace.id, themeId, uiDensity, layoutPreset, defaultShellProfileId, applyShellToIdlePanes })
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
          <div className="ws-settings-title-group">
            <h2 id="workspace-settings-title">Workspace settings</h2>
            <span className="ws-settings-subtitle">{workspace.name}</span>
          </div>
          <button type="button" className="icon-button" aria-label="Close workspace settings" onClick={onClose}>
            <X size={16} aria-hidden="true" />
          </button>
        </header>

        <form className="ws-settings-form-v2" onSubmit={handleSubmit}>
          <div className="ws-settings-body">
            <div className="ws-settings-main">
              <section className="ws-settings-section" aria-labelledby="ws-section-appearance">
                <header className="ws-settings-section-header">
                  <Palette size={14} aria-hidden="true" />
                  <h3 id="ws-section-appearance">Appearance</h3>
                </header>

                <div className="ws-settings-field-label">Theme</div>
                <div className="theme-card-grid" role="radiogroup" aria-label="Theme">
                  {WORKSPACE_THEMES.map((theme) => {
                    const pal = THEME_PALETTES[theme.id]
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
                        <div className="theme-card-preview" style={{ background: pal.bg }} aria-hidden="true">
                          <span className="theme-card-accent" style={{ background: pal.accent }} />
                          <span className="theme-card-line" style={{ background: pal.muted }} />
                          <span className="theme-card-line short" style={{ background: pal.muted }} />
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
                  <button type="button" role="radio" aria-checked={uiDensity === 'compact'}
                    className={`density-option${uiDensity === 'compact' ? ' selected' : ''}`} onClick={() => setUiDensity('compact')}>
                    <Minimize2 size={13} aria-hidden="true" />
                    <span>Compact</span>
                  </button>
                  <button type="button" role="radio" aria-checked={uiDensity === 'comfortable'}
                    className={`density-option${uiDensity === 'comfortable' ? ' selected' : ''}`} onClick={() => setUiDensity('comfortable')}>
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
                      <button key={preset} type="button" role="radio" aria-checked={selected}
                        className={`layout-card${selected ? ' selected' : ''}`} onClick={() => setLayoutPreset(preset)}
                        title={`${grid.rows}×${grid.cols} (${preset} panes)`}>
                        <LayoutPreview rows={grid.rows} cols={grid.cols} />
                        <span className="layout-card-label">{preset}</span>
                      </button>
                    )
                  })}
                </div>
              </section>

              <TerminalOverrideSection workspaceId={workspace.id} />

              <section className="ws-settings-section" aria-labelledby="ws-section-shell">
                <header className="ws-settings-section-header">
                  <SquareTerminal size={14} aria-hidden="true" />
                  <h3 id="ws-section-shell">Default shell</h3>
                </header>
                <label className="field">
                  <span>Shell profile</span>
                  <select value={defaultShellProfileId} onChange={(event) => setDefaultShellProfileId(event.target.value)}>
                    {shellProfiles.map((profile) => <option key={profile.id} value={profile.id}>{profile.name}</option>)}
                  </select>
                </label>
                <label className="checkbox-field">
                  <input type="checkbox" checked={applyShellToIdlePanes} onChange={(event) => setApplyShellToIdlePanes(event.currentTarget.checked)} />
                  <span>Apply this shell to existing idle panes</span>
                </label>
              </section>
            </div>

            <aside className="ws-settings-aside" aria-label="Preview">
              <WorkspacePreview
                name={workspace.name}
                themeId={themeId}
                density={uiDensity}
                layoutPreset={layoutPreset}
                prefs={terminalPrefs}
              />
            </aside>
          </div>

          {error ? <div className="modal-error" role="alert">{error}</div> : null}

          <footer className="modal-actions">
            <button type="button" className="secondary-action" onClick={onClose}>Cancel</button>
            <button type="submit" className="primary-action" disabled={isSaving}>{isSaving ? 'Saving…' : 'Save'}</button>
          </footer>
        </form>
      </section>
    </div>
  )
}

/* ── Live preview ─────────────────────────────────────────────────── */

function WorkspacePreview({ name, themeId, density, layoutPreset, prefs }: {
  name: string
  themeId: WorkspaceThemeId
  density: WorkspaceDensity
  layoutPreset: WorkspaceLayoutPreset
  prefs: TerminalPrefs
}): ReactElement {
  const pal = THEME_PALETTES[themeId]
  const grid = PRESET_GRIDS[layoutPreset]
  const gap = density === 'compact' ? 3 : 6
  const themeLabel = WORKSPACE_THEMES.find((t) => t.id === themeId)?.label ?? themeId
  // Clamp the sample text size so big fonts don't overflow the small preview.
  const sampleSize = Math.max(9, Math.min(prefs.fontSize, 16))

  return (
    <div className="ws-preview">
      <div className="ws-preview-label">Preview</div>
      <div className="ws-preview-window" style={{ background: pal.bg, borderColor: 'rgba(255,255,255,0.10)' }}>
        <div className="ws-preview-titlebar" style={{ background: pal.elevated }}>
          <span className="ws-preview-dot" style={{ background: pal.accent }} />
          <span className="ws-preview-title" style={{ color: pal.tx }}>{name}</span>
        </div>
        <div
          className="ws-preview-grid"
          style={{ gridTemplateColumns: `repeat(${grid.cols}, 1fr)`, gridTemplateRows: `repeat(${grid.rows}, 1fr)`, gap }}
          aria-hidden="true"
        >
          {Array.from({ length: layoutPreset }).map((_, i) => (
            <div key={i} className="ws-preview-tile" style={{ background: pal.elevated, borderColor: i === 0 ? pal.accent : 'transparent' }} />
          ))}
        </div>
        <div
          className="ws-preview-sample"
          style={{ background: pal.elevated, fontFamily: prefs.fontFamily, fontSize: sampleSize, lineHeight: prefs.lineHeight, letterSpacing: prefs.letterSpacing }}
        >
          <div><span style={{ color: pal.accent }}>~/{name.toLowerCase().replace(/\s+/g, '-').slice(0, 16)}</span> <span style={{ color: pal.muted }}>main</span></div>
          <div><span style={{ color: pal.accent }}>❯</span> <span style={{ color: pal.tx }}>npm run dev</span></div>
          <div style={{ color: pal.muted }}>
            ready in 312 ms
            <span className={`ws-preview-cursor cursor-${prefs.cursorStyle}${prefs.cursorBlink ? ' blink' : ''}`} style={{ background: pal.accent, borderColor: pal.accent }} />
          </div>
        </div>
      </div>
      <div className="ws-preview-caption">
        {themeLabel} · {density === 'compact' ? 'Compact' : 'Comfortable'} · {layoutPreset} panes · {prefs.fontSize}px
      </div>
    </div>
  )
}

/* ── Per-workspace terminal override ──────────────────────────────── */

const WS_CURSOR_OPTIONS = CURSOR_OPTIONS

function TerminalOverrideSection({ workspaceId }: { workspaceId: string }): ReactElement {
  const global = useTerminalPrefsStore((s) => s.global)
  const override = useTerminalPrefsStore((s) => s.overrides[workspaceId])
  const setOverride = useTerminalPrefsStore((s) => s.setOverride)
  const clearOverrides = useTerminalPrefsStore((s) => s.clearOverrides)
  const [customize, setCustomize] = useState<boolean>(() => Boolean(override && Object.keys(override).length > 0))

  const resolved = { ...global, ...(override ?? {}) }
  const toggleCustomize = (on: boolean): void => {
    setCustomize(on)
    if (!on) clearOverrides(workspaceId)
  }

  return (
    <section className="ws-settings-section" aria-labelledby="ws-section-terminal">
      <header className="ws-settings-section-header">
        <SquareTerminal size={14} aria-hidden="true" />
        <h3 id="ws-section-terminal">Terminal</h3>
      </header>

      <label className="checkbox-field">
        <input type="checkbox" checked={customize} onChange={(e) => toggleCustomize(e.currentTarget.checked)} />
        <span>Personalizar o terminal só neste workspace</span>
      </label>

      {customize ? (
        <div className="ws-terminal-overrides">
          <label className="field">
            <span>Fonte</span>
            <select value={resolved.fontFamily} onChange={(e) => setOverride(workspaceId, 'fontFamily', e.target.value)}>
              {FONT_PRESETS.map((f) => <option key={f} value={f}>{f.split(',')[0]}</option>)}
              {FONT_PRESETS.includes(resolved.fontFamily) ? null : <option value={resolved.fontFamily}>{resolved.fontFamily.split(',')[0]}</option>}
            </select>
          </label>
          <label className="field">
            <span>Tamanho — {resolved.fontSize}px</span>
            <input type="range" min={8} max={32} step={1} value={resolved.fontSize} onChange={(e) => setOverride(workspaceId, 'fontSize', Number(e.target.value))} />
          </label>
          <label className="field">
            <span>Altura de linha — {resolved.lineHeight.toFixed(1)}</span>
            <input type="range" min={1} max={2} step={0.1} value={resolved.lineHeight} onChange={(e) => setOverride(workspaceId, 'lineHeight', Number(e.target.value))} />
          </label>
          <label className="field">
            <span>Cursor</span>
            <select value={resolved.cursorStyle} onChange={(e) => setOverride(workspaceId, 'cursorStyle', e.target.value as TerminalCursorStyle)}>
              {WS_CURSOR_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </label>
        </div>
      ) : (
        <p className="ws-settings-hint">Usando as preferências globais de terminal (Settings → Terminal).</p>
      )}
    </section>
  )
}

function LayoutPreview({ rows, cols }: { rows: number; cols: number }): ReactElement {
  const cells: ReactElement[] = []
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      cells.push(<span key={`${r}:${c}`} className="layout-card-cell" />)
    }
  }
  return (
    <div className="layout-card-preview" style={{ gridTemplateColumns: `repeat(${cols}, 1fr)`, gridTemplateRows: `repeat(${rows}, 1fr)` }} aria-hidden="true">
      {cells}
    </div>
  )
}
