import { Check, Maximize2, Minimize2, Palette, Settings2, SquareTerminal, X } from 'lucide-react'
import { useEffect, useRef, useState, type FormEvent, type ReactElement } from 'react'
import type { ShellProfile, UpdateWorkspaceSettingsInput, Workspace, WorkspaceDensity, WorkspaceLayoutPreset, WorkspaceThemeId } from '../../../shared/types/workspace'
import { LAYOUT_PRESETS, WORKSPACE_DENSITIES } from './workspaceOptions'
import { useSettingsStore } from '../../store/settings.store'
import { resolveDensity } from '../../design/density'
import { AppearanceSettings } from '../Settings/AppearanceSettings'
import { WorkspaceMemorySettings } from './WorkspaceMemorySettings'
import { WorkspaceDelegationSettings } from './WorkspaceDelegationSettings'
import { ModalRoot, ModalSurface, ModalTitle } from '../../ui/Modal'
import { useResolvedTerminalPrefs, useTerminalPrefsStore, type TerminalCursorStyle, type TerminalPrefs } from '../../store/terminal-prefs.store'
import './WorkspaceSettingsModal.css'
import { DefaultShellSettings } from './DefaultShellSettings'
import { useSharedProjectMemory } from '../../hooks/useSharedProjectMemory'
import { Button, ErrorState, Select } from '../../ui'
import { formatNumber } from '../../utils/formatTime'
import { humanizeError } from '../../utils/humanizeError'
import { useTranslation } from 'react-i18next'
import { i18n } from '../../i18n'

const tc = i18n.getFixedT(null, 'code')
import { SETTINGS_PAGES } from './workspaceSettingsPages'
export { SETTINGS_PAGES }


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

const CURSOR_OPTIONS: TerminalCursorStyle[] = ['block', 'bar', 'underline']

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
  const { t } = useTranslation('code')
  const [themeId, setThemeId] = useState<WorkspaceThemeId>(workspace.themeId)
  const [uiDensity, setUiDensity] = useState<WorkspaceDensity>(workspace.uiDensity)
  const [layoutPreset, setLayoutPreset] = useState<WorkspaceLayoutPreset>(workspace.layoutPreset)
  const [defaultShellProfileId, setDefaultShellProfileId] = useState(workspace.defaultShellProfileId)
  const [applyShellToIdlePanes, setApplyShellToIdlePanes] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  const [isSaving, setSaving] = useState(false)
  const [localPage, setPage] = useState<(typeof SETTINGS_PAGES)[number]['id']>('appearance')
  const page = selectedPageId ?? localPage
  const memoryOn = useSharedProjectMemory(workspace.id) === true
  const visiblePages = SETTINGS_PAGES.filter(item => item.id !== 'memory' || memoryOn)
  const selectedPage = SETTINGS_PAGES.find(item => item.id === page)!
  const contentRef = useRef<HTMLDivElement>(null)
  useEffect(() => { if (contentRef.current) contentRef.current.scrollTop = 0 }, [page])

  // Resolved terminal prefs (global ← workspace override) — drives the preview
  // live as the user edits the Terminal section below.
  const terminalPrefs = useResolvedTerminalPrefs(workspace.id)

  const save = async (): Promise<boolean> => {
    setSaving(true)
    setError(null)
    try {
      await onSave({ workspaceId: workspace.id, themeId, uiDensity, layoutPreset, defaultShellProfileId, applyShellToIdlePanes })
      setApplyShellToIdlePanes(false)
      setSaved(true)
      if (!embedded) onClose()
      return true
    } catch (err) {
      setError(humanizeError(err, t('workspace.settings.saveFailed')))
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
  useEffect(() => { setSaved(false) }, [themeId, uiDensity, layoutPreset, defaultShellProfileId, applyShellToIdlePanes])
  useEffect(() => { onDraftChange?.({ dirty, save, discard }) })
  const handleSubmit = async (event: FormEvent<HTMLFormElement>): Promise<void> => { event.preventDefault(); await save() }

  const content = <>
        {!embedded &&
        <header className="modal-header">
          <div className="ws-settings-title-group">
            <ModalTitle asChild>
              <h2>{t('sidebar.settings')}</h2>
            </ModalTitle>
            <span className="ws-settings-subtitle">{workspace.name}</span>
            <span className="ws-settings-root" title={workspace.rootPath}>{workspace.rootPath}</span>
          </div>
          <Button variant="ghost" size="sm" square aria-label={t('workspace.settings.close')} onClick={onClose}>
            <X size={16} aria-hidden="true" />
          </Button>
        </header>}

        <form
          className="ws-settings-form-v2"
          onSubmit={handleSubmit}
        >
          <div className="ws-settings-body">
            {!embedded && <nav className="ws-settings-nav" aria-label={t('workspace.settings.sections')}>
              <span className="ws-settings-nav-label">{t('workspace.settings.navLabel')}</span>
              {visiblePages.map(({ id, label, hint, icon: Icon }) => <button key={id} type="button" aria-pressed={page === id} aria-controls={`ws-page-${id}`} onClick={() => { setPage(id); if (contentRef.current) contentRef.current.scrollTop = 0 }}>
                <Icon size={16} aria-hidden="true" /><span><strong>{label}</strong>{' '}<small>{hint}</small></span>
              </button>)}
              <p>{t('workspace.settings.scopedTo')}<br /><strong>{workspace.name}</strong></p>
            </nav>}
            <div className="ws-settings-main" ref={contentRef}>
              <header className="ws-settings-page-heading"><h3>{selectedPage.label}</h3><p>{selectedPage.description}</p></header>
              {memoryOn && <div id="ws-page-memory" hidden={page !== 'memory'}><WorkspaceMemorySettings workspaceId={workspace.id} /></div>}
              <div id="ws-page-delegation" hidden={page !== 'delegation'}><WorkspaceDelegationSettings workspaceId={workspace.id} paneIds={workspace.panes.map(pane => pane.id)} onOpenTerminal={onOpenTerminal} onOpenDiagnostics={onOpenDiagnostics} /></div>
              <div id="ws-page-appearance" className="ws-appearance-layout" hidden={page !== 'appearance'}>
              <div className="ws-appearance-controls">
              <section className="ws-settings-section" aria-labelledby="ws-section-appearance">
                <header className="ws-settings-section-header">
                  <Palette size={14} aria-hidden="true" />
                  <h3 id="ws-section-appearance">{t('workspace.settings.pages.appearance.label')}</h3>
                </header>

                <div className="ws-settings-field-label">{t('workspace.settings.mode')}</div>
                <AppearanceSettings />
                <p className="ws-settings-hint">{t('workspace.settings.modeHint')}</p>

                <div className="ws-settings-field-label">{t('workspace.settings.density')}</div>
                <div className="density-toggle" role="radiogroup" aria-label={t('workspace.settings.density')}>
                  {WORKSPACE_DENSITIES.map(({ id, label }) => {
                    const Icon = id === 'compact' ? Minimize2 : id === 'comfortable' ? Maximize2 : Settings2
                    return <button key={id} type="button" role="radio" aria-checked={uiDensity === id}
                      className={`density-option${uiDensity === id ? ' selected' : ''}`} onClick={() => setUiDensity(id)}>
                      <Icon size={14} aria-hidden="true" />
                      <span>{label}</span>
                    </button>
                  })}
                </div>
              </section>

              <section className="ws-settings-section" aria-labelledby="ws-section-layout">
                <header className="ws-settings-section-header">
                  <SquareTerminal size={14} aria-hidden="true" />
                  <h3 id="ws-section-layout">{t('workspace.settings.layout')}</h3>
                </header>
                <div className="layout-card-grid" role="radiogroup" aria-label={t('workspace.settings.layoutPreset')}>
                  {LAYOUT_PRESETS.map((preset) => {
                    const grid = PRESET_GRIDS[preset]
                    const selected = layoutPreset === preset
                    return (
                      <button key={preset} type="button" role="radio" aria-checked={selected}
                        className={`layout-card${selected ? ' selected' : ''}`} onClick={() => setLayoutPreset(preset)}
                        aria-label={t('workspace.status.panes', { count: preset })}
                        title={`${grid.rows}×${grid.cols} (${t('workspace.status.panes', { count: preset })})`}>
                        <LayoutPreview rows={grid.rows} cols={grid.cols} />
                        <span className="layout-card-label">{preset}</span>
                      </button>
                    )
                  })}
                </div>
              </section>

              </div>
              <aside className="ws-settings-aside" aria-label={t('workspace.settings.preview')}>
                <WorkspacePreview name={workspace.name} themeId={themeId} density={uiDensity} layoutPreset={layoutPreset} prefs={terminalPrefs} />
              </aside>
              </div>

              <div id="ws-page-terminal" className="ws-terminal-page" hidden={page !== 'terminal'}>
              <p className="ws-settings-save-note">{t('workspace.settings.terminalNote')}</p>
              <TerminalOverrideSection workspaceId={workspace.id} />

              <DefaultShellSettings profiles={shellProfiles} selectedId={defaultShellProfileId} onSelect={setDefaultShellProfileId}
                applyToIdle={applyShellToIdlePanes} onApplyToIdle={setApplyShellToIdlePanes} rootPath={workspace.rootPath} />
              </div>
            </div>
          </div>

          {error ? <ErrorState compact title={t('workspace.settings.saveFailed')} message={error} /> : null}
          {saved && !error ? <div className="ws-settings-saved" role="status"><Check size={14} aria-hidden="true" />{t('workspace.settings.saved')}</div> : null}

          <footer className="modal-actions">
            <p>{page === 'memory' ? t('workspace.settings.footer.memory') : page === 'delegation' ? t('workspace.settings.footer.delegation') : t('workspace.settings.footer.default')}</p>
            <Button variant="secondary" onClick={embedded ? discard : onClose}>{embedded ? t('workspace.settings.discard') : t('workspace.settings.closeButton')}</Button>
            <Button type="submit" variant="primary" disabled={isSaving}>{isSaving ? t('editor.saving') : t('workspace.settings.save')}</Button>
          </footer>
        </form>
      </>
  if (embedded) return <div className="workspace-settings-modal-v2 settings-workspace-content">{content}</div>
  return <ModalRoot open onOpenChange={(next) => { if (!next) onClose() }}>
    <ModalSurface className="modal workspace-settings-modal-v2 modal-dialog-surface">{content}</ModalSurface>
  </ModalRoot>
}

/* ── Live preview ─────────────────────────────────────────────────── */

function WorkspacePreview({ name, themeId, density, layoutPreset, prefs }: {
  name: string
  themeId: WorkspaceThemeId
  density: WorkspaceDensity
  layoutPreset: WorkspaceLayoutPreset
  prefs: TerminalPrefs
}): ReactElement {
  const grid = PRESET_GRIDS[layoutPreset]
  const resolved = resolveDensity(density, useSettingsStore(state => state.density))
  const gap = resolved === 'compact' ? 3 : 6
  // Clamp the sample text size so big fonts don't overflow the small preview.
  const sampleSize = Math.max(9, Math.min(prefs.fontSize, 16))

  return (
    <div className="ws-preview">
      <div className="ws-preview-label">{tc('workspace.settings.preview')}</div>
      <div className="ws-preview-window">
        <div className="ws-preview-titlebar">
          <span className="ws-preview-dot" />
          <span className="ws-preview-title">{name}</span>
        </div>
        <div
          className="ws-preview-grid"
          style={{ gridTemplateColumns: `repeat(${grid.cols}, 1fr)`, gridTemplateRows: `repeat(${grid.rows}, 1fr)`, gap }}
          aria-hidden="true"
        >
          {Array.from({ length: layoutPreset }).map((_, i) => (
            <div key={i} className={`ws-preview-tile${i === 0 ? ' is-active' : ''}`} />
          ))}
        </div>
        <div
          className="ws-preview-sample"
          style={{ fontFamily: prefs.fontFamily, fontSize: sampleSize, lineHeight: prefs.lineHeight, letterSpacing: prefs.letterSpacing }}
        >
          <div><span className="ws-preview-accent">~/{name.toLowerCase().replace(/\s+/g, '-').slice(0, 16)}</span> <span className="ws-preview-muted">main</span></div>
          <div><span className="ws-preview-accent">❯</span> <span>npm run dev</span></div>
          <div className="ws-preview-muted">
            ready in 312 ms
            <span className={`ws-preview-cursor cursor-${prefs.cursorStyle}${prefs.cursorBlink ? ' blink' : ''}`} />
          </div>
        </div>
      </div>
      <div className="ws-preview-caption">
        {tc(`workspace.density.${resolved}`)}{density === 'default' ? ` (${tc('workspace.density.default')})` : ''} · {tc('workspace.status.panes', { count: layoutPreset })} · {prefs.fontSize}px
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
        <h3 id="ws-section-terminal">{tc('panels.terminal')}</h3>
      </header>

      <label className="checkbox-field">
        <input type="checkbox" checked={customize} onChange={(e) => toggleCustomize(e.currentTarget.checked)} />
        <span>{tc('workspace.settings.customize')}</span>
      </label>

      {customize ? (
        <div className="ws-terminal-overrides">
          <label className="field">
            <span>{tc('workspace.settings.font')}</span>
            <Select value={resolved.fontFamily} onChange={(e) => setOverride(workspaceId, 'fontFamily', e.target.value)}>
              {FONT_PRESETS.map((f) => <option key={f} value={f}>{f.split(',')[0]}</option>)}
              {FONT_PRESETS.includes(resolved.fontFamily) ? null : <option value={resolved.fontFamily}>{resolved.fontFamily.split(',')[0]}</option>}
            </Select>
          </label>
          <label className="field">
            <span>{tc('workspace.settings.fontSize', { size: resolved.fontSize })}</span>
            <input type="range" min={8} max={32} step={1} value={resolved.fontSize} onChange={(e) => setOverride(workspaceId, 'fontSize', Number(e.target.value))} />
          </label>
          {resolved.fontSize !== global.fontSize && <button type="button" className="ws-settings-use-default" onClick={() => setOverride(workspaceId, 'fontSize', undefined)}>{tc('workspace.settings.useAppSize', { size: global.fontSize })}</button>}
          <label className="field">
            <span>{tc('workspace.settings.lineHeight', { value: formatNumber(resolved.lineHeight, { minimumFractionDigits: 1, maximumFractionDigits: 1 }) })}</span>
            <input type="range" min={1} max={2} step={0.1} value={resolved.lineHeight} onChange={(e) => setOverride(workspaceId, 'lineHeight', Number(e.target.value))} />
          </label>
          <label className="field">
            <span>{tc('workspace.settings.cursor')}</span>
            <Select value={resolved.cursorStyle} onChange={(e) => setOverride(workspaceId, 'cursorStyle', e.target.value as TerminalCursorStyle)}>
              {WS_CURSOR_OPTIONS.map((style) => <option key={style} value={style}>{tc(`workspace.settings.cursorStyle.${style}`)}</option>)}
            </Select>
          </label>
        </div>
      ) : (
        <p className="ws-settings-hint">{tc('workspace.settings.usingGlobal')}</p>
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
