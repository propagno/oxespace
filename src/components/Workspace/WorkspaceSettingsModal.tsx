import { Brain, Check, GitBranch, Maximize2, Minimize2, Palette, SquareTerminal, X } from 'lucide-react'
import { useEffect, useRef, useState, type FormEvent, type ReactElement } from 'react'
import type { ShellProfile, UpdateWorkspaceSettingsInput, Workspace, WorkspaceDensity, WorkspaceLayoutPreset, WorkspaceThemeId } from '../../../shared/types/workspace'
import { LAYOUT_PRESETS, WORKSPACE_THEMES } from './workspaceOptions'
import { WorkspaceMemorySettings } from './WorkspaceMemorySettings'
import { WorkspaceDelegationSettings } from './WorkspaceDelegationSettings'
import { Dialog, DialogContent, DialogTitle, LEGACY_MODAL_OVERLAY } from '@/components/ui/dialog'
import { useResolvedTerminalPrefs, useTerminalPrefsStore, type TerminalCursorStyle, type TerminalPrefs } from '../../store/terminal-prefs.store'
import './WorkspaceSettingsModal.css'
import { DefaultShellSettings } from './DefaultShellSettings'

export const SETTINGS_PAGES = [
  { id: 'appearance', label: 'Appearance', hint: 'Theme & layout', icon: Palette, description: 'Make this workspace feel like yours. Preview your theme and pane layout before saving.' },
  { id: 'terminal', label: 'Terminal', hint: 'Text & default shell', icon: SquareTerminal, description: 'Set your default shell and customize how terminal sessions look in this workspace.' },
  { id: 'memory', label: 'Project memory', hint: 'Shared knowledge', icon: Brain, description: 'Keep project knowledge across worktrees without sharing agent conversations.' },
  { id: 'delegation', label: 'Agent delegation', hint: 'Parallel work', icon: GitBranch, description: 'Let agents hand off a focused task to a new worktree and independent terminal.' }
] as const

interface WorkspaceSettingsModalProps {
  embedded?: boolean
  selectedPageId?: (typeof SETTINGS_PAGES)[number]['id']
  onDraftChange?: (draft: { dirty: boolean; save: () => Promise<boolean>; discard: () => void }) => void
  workspace: Workspace
  shellProfiles: ShellProfile[]
  onClose: () => void
  onOpenTerminal?: (paneId: string, workspaceId?: string) => void
  onOpenDiagnostics?: () => void
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
  midnight: { bg: '#000000', elevated: '#121212', tx: '#f1f5f9', muted: '#94a3b0', accent: '#12C79A' },
  nord:     { bg: '#0b1119', elevated: '#182230', tx: '#eceff4', muted: '#9aabbf', accent: '#88c0d0' },
  dracula:  { bg: '#151320', elevated: '#282a36', tx: '#f8f8f2', muted: '#a8a0c4', accent: '#bd93f9' },
  ocean:    { bg: '#001318', elevated: '#082b33', tx: '#e6fbff', muted: '#7eb0ba', accent: '#22d3ee' },
  monokai:  { bg: '#11110d', elevated: '#24251a', tx: '#f8f8f2', muted: '#b0b190', accent: '#a6e22e' },
  amber:    { bg: '#130d05', elevated: '#27190a', tx: '#fff7ed', muted: '#d4a574', accent: '#f59e0b' },
  'rose-pine': { bg: '#191724', elevated: '#1f1d2e', tx: '#e0def4', muted: '#b0acc8', accent: '#ebbcba' },
  gruvbox:     { bg: '#1d2021', elevated: '#282828', tx: '#ebdbb2', muted: '#bdae93', accent: '#fabd2f' },
  'one-dark':  { bg: '#282c34', elevated: '#21252b', tx: '#e6e8eb', muted: '#8b929e', accent: '#61afef' },
  synthwave84: { bg: '#2b213a', elevated: '#241b2f', tx: '#f0efe1', muted: '#a8aeb8', accent: '#ff7edb' },
  'github-dark': { bg: '#0d1117', elevated: '#161b22', tx: '#e6edf3', muted: '#8b949e', accent: '#58a6ff' }
}

const CURSOR_OPTIONS: Array<{ value: TerminalCursorStyle; label: string }> = [
  { value: 'block', label: 'Block' },
  { value: 'bar', label: 'Bar' },
  { value: 'underline', label: 'Underline' }
]

const FONT_PRESETS = [
  'Cascadia Mono, Consolas, monospace',
  'Cascadia Code, monospace',
  'JetBrains Mono, monospace',
  'Fira Code, monospace',
  'Consolas, monospace',
  // Ship with most Linux desktops, where the families above resolve to nothing.
  'DejaVu Sans Mono, monospace',
  'Ubuntu Mono, monospace',
  'Liberation Mono, monospace',
  'monospace'
]

export function WorkspaceSettingsModal({ embedded, selectedPageId, onDraftChange, onClose, onOpenTerminal, onOpenDiagnostics, onSave, shellProfiles, workspace }: WorkspaceSettingsModalProps): ReactElement {
  const [themeId, setThemeId] = useState<WorkspaceThemeId>(workspace.themeId)
  const [uiDensity, setUiDensity] = useState<WorkspaceDensity>(workspace.uiDensity)
  const [layoutPreset, setLayoutPreset] = useState<WorkspaceLayoutPreset>(workspace.layoutPreset)
  const [defaultShellProfileId, setDefaultShellProfileId] = useState(workspace.defaultShellProfileId)
  const [applyShellToIdlePanes, setApplyShellToIdlePanes] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [isSaving, setSaving] = useState(false)
  const [localPage, setPage] = useState<(typeof SETTINGS_PAGES)[number]['id']>('appearance')
  const page = selectedPageId ?? localPage
  const selectedPage = SETTINGS_PAGES.find(item => item.id === page)!
  const contentRef = useRef<HTMLDivElement>(null)
  useEffect(() => { if (contentRef.current) contentRef.current.scrollTop = 0 }, [page])

  // Resolved terminal prefs (global ← workspace override) — drives the preview
  // live as the user edits the Terminal section below.
  const terminalPrefs = useResolvedTerminalPrefs(workspace.id)
  const activePal = THEME_PALETTES[themeId]

  const save = async (): Promise<boolean> => {
    setSaving(true)
    setError(null)
    try {
      await onSave({ workspaceId: workspace.id, themeId, uiDensity, layoutPreset, defaultShellProfileId, applyShellToIdlePanes })
      setApplyShellToIdlePanes(false)
      if (!embedded) onClose()
      return true
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update workspace settings')
      return false
    } finally {
      setSaving(false)
    }
  }
  const discard = (): void => {
    setThemeId(workspace.themeId); setUiDensity(workspace.uiDensity); setLayoutPreset(workspace.layoutPreset)
    setDefaultShellProfileId(workspace.defaultShellProfileId); setApplyShellToIdlePanes(false); setError(null)
  }
  const dirty = themeId !== workspace.themeId || uiDensity !== workspace.uiDensity || layoutPreset !== workspace.layoutPreset || defaultShellProfileId !== workspace.defaultShellProfileId || applyShellToIdlePanes
  useEffect(() => { onDraftChange?.({ dirty, save, discard }) })
  const handleSubmit = async (event: FormEvent<HTMLFormElement>): Promise<void> => { event.preventDefault(); await save() }

  const content = <>
        {!embedded &&
        <header className="modal-header">
          <div className="ws-settings-title-group">
            <DialogTitle asChild>
              <h2>Workspace settings</h2>
            </DialogTitle>
            <span className="ws-settings-subtitle">{workspace.name}</span>
            <span className="ws-settings-root" title={workspace.rootPath}>{workspace.rootPath}</span>
          </div>
          <button type="button" className="icon-button" aria-label="Close workspace settings" onClick={onClose}>
            <X size={16} aria-hidden="true" />
          </button>
        </header>}

        <form
          className="ws-settings-form-v2"
          onSubmit={handleSubmit}
          style={{
            '--accent': activePal.accent,
            '--brand-glow': `${activePal.accent}33`,
            '--bd-pane-active': activePal.accent
          } as React.CSSProperties}
        >
          <div className="ws-settings-body">
            {!embedded && <nav className="ws-settings-nav" aria-label="Workspace settings sections">
              <span className="ws-settings-nav-label">WORKSPACE</span>
              {SETTINGS_PAGES.map(({ id, label, hint, icon: Icon }) => <button key={id} type="button" aria-pressed={page === id} aria-controls={`ws-page-${id}`} onClick={() => { setPage(id); if (contentRef.current) contentRef.current.scrollTop = 0 }}>
                <Icon size={17} aria-hidden="true" /><span><strong>{label}</strong><small>{hint}</small></span>
              </button>)}
              <p>Settings scoped to<br /><strong>{workspace.name}</strong></p>
            </nav>}
            <div className="ws-settings-main" ref={contentRef}>
              <header className="ws-settings-page-heading"><h3>{selectedPage.label}</h3><p>{selectedPage.description}</p></header>
              <div id="ws-page-memory" hidden={page !== 'memory'}><WorkspaceMemorySettings workspaceId={workspace.id} /></div>
              <div id="ws-page-delegation" hidden={page !== 'delegation'}><WorkspaceDelegationSettings workspaceId={workspace.id} paneIds={workspace.panes.map(pane => pane.id)} onOpenTerminal={onOpenTerminal} onOpenDiagnostics={onOpenDiagnostics} /></div>
              <div id="ws-page-appearance" className="ws-appearance-layout" hidden={page !== 'appearance'}>
              <div className="ws-appearance-controls">
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
                        <div className="theme-card-preview" style={{ background: pal.bg, padding: 0 }} aria-hidden="true">
                          {/* Mini Sidebar */}
                          <div style={{ position: 'absolute', top: 0, left: 0, bottom: 0, width: '12px', background: pal.elevated, borderRight: '1px solid rgba(255,255,255,0.05)', display: 'flex', flexDirection: 'column', alignItems: 'center', paddingTop: '6px', gap: '3px' }}>
                            <span style={{ width: '4px', height: '4px', borderRadius: '50%', background: pal.accent }} />
                            <span style={{ width: '4px', height: '4px', borderRadius: '50%', background: 'rgba(255,255,255,0.15)' }} />
                            <span style={{ width: '4px', height: '4px', borderRadius: '50%', background: 'rgba(255,255,255,0.15)' }} />
                          </div>
                          {/* Mini Editor content */}
                          <div style={{ marginLeft: '12px', height: '100%', display: 'flex', flexDirection: 'column', gap: '4px', padding: '10px 8px 6px', justifyContent: 'flex-end' }}>
                            <div style={{ display: 'flex', gap: '2px', width: '100%', height: '14px', marginBottom: 'auto' }}>
                              <div style={{ flex: 1, background: pal.elevated, borderRadius: '2px', border: `1px solid ${pal.accent}4d` }} />
                              <div style={{ flex: 1, background: pal.elevated, borderRadius: '2px' }} />
                            </div>
                            <span className="theme-card-line" style={{ background: pal.muted, opacity: 0.4 }} />
                            <span className="theme-card-line short" style={{ background: pal.muted, opacity: 0.4 }} />
                          </div>
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

              </div>
              <aside className="ws-settings-aside" aria-label="Preview">
                <WorkspacePreview name={workspace.name} themeId={themeId} density={uiDensity} layoutPreset={layoutPreset} prefs={terminalPrefs} />
              </aside>
              </div>

              <div id="ws-page-terminal" className="ws-terminal-page" hidden={page !== 'terminal'}>
              <p className="ws-settings-save-note">Terminal appearance applies immediately. Use Save workspace settings to apply your default shell.</p>
              <TerminalOverrideSection workspaceId={workspace.id} />

              <DefaultShellSettings profiles={shellProfiles} selectedId={defaultShellProfileId} onSelect={setDefaultShellProfileId}
                applyToIdle={applyShellToIdlePanes} onApplyToIdle={setApplyShellToIdlePanes} rootPath={workspace.rootPath} />
              </div>
            </div>
          </div>

          {error ? <div className="modal-error" role="alert">{error}</div> : null}

          <footer className="modal-actions">
            <p>{page === 'memory' ? 'Memory changes use Apply memory settings above.' : page === 'delegation' ? 'Delegation changes apply immediately.' : 'Save applies theme, density, layout and default shell.'}</p>
            <button type="button" className="secondary-action" onClick={embedded ? discard : onClose}>{embedded ? 'Discard changes' : 'Close'}</button>
            <button type="submit" className="primary-action" disabled={isSaving}>{isSaving ? 'Saving…' : 'Save workspace settings'}</button>
          </footer>
        </form>
      </>
  if (embedded) return <div className="workspace-settings-modal-v2 settings-workspace-content">{content}</div>
  return <Dialog open onOpenChange={(next) => { if (!next) onClose() }}>
    <DialogContent unstyled showCloseButton={false} overlayClassName={LEGACY_MODAL_OVERLAY} className="modal workspace-settings-modal-v2 modal-dialog-surface">{content}</DialogContent>
  </Dialog>
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
        <span>Customize terminal for this workspace</span>
      </label>

      {customize ? (
        <div className="ws-terminal-overrides">
          <label className="field">
            <span>Font</span>
            <select value={resolved.fontFamily} onChange={(e) => setOverride(workspaceId, 'fontFamily', e.target.value)}>
              {FONT_PRESETS.map((f) => <option key={f} value={f}>{f.split(',')[0]}</option>)}
              {FONT_PRESETS.includes(resolved.fontFamily) ? null : <option value={resolved.fontFamily}>{resolved.fontFamily.split(',')[0]}</option>}
            </select>
          </label>
          <label className="field">
            <span>Font size — {resolved.fontSize}px</span>
            <input type="range" min={8} max={32} step={1} value={resolved.fontSize} onChange={(e) => setOverride(workspaceId, 'fontSize', Number(e.target.value))} />
          </label>
          <label className="field">
            <span>Line height — {resolved.lineHeight.toFixed(1)}</span>
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
        <p className="ws-settings-hint">Using global terminal preferences (Settings → Terminal).</p>
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
