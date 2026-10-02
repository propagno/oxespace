import { Activity, ArrowLeft, ArrowUpCircle, Bell, Bot, ChevronRight, Mic, Settings2, SquareTerminal, X } from 'lucide-react'
import { useEffect, useRef, useState, type CSSProperties, type ReactElement } from 'react'
import { Dialog, DialogContent, DialogTitle } from '../ui/dialog'
import { SettingsContent, type SettingsModalProps, type SettingsSection } from './SettingsModal'
import { SETTINGS_PAGES, WorkspaceSettingsModal } from '../Workspace/WorkspaceSettingsModal'
import type { ShellProfile, UpdateWorkspaceSettingsInput, Workspace } from '../../../shared/types/workspace'
import './SettingsCenter.css'
import { useUIStore } from '../../store/ui.store'
import { useWorkspaceStore } from '../../store/workspace.store'
import { SearchField } from '../Navigation/SearchField'
import { useNavigationPrefs } from '../../store/navigation-prefs.store'
import { useTerminalStore } from '../../store/terminal.store'
import { useSettingsStore, VISITED_WORKSPACES_CAP_MAX, VISITED_WORKSPACES_CAP_MIN } from '../../store/settings.store'

export type SettingsDestination = { scope: 'application'; page: 'general' | SettingsSection } | { scope: 'workspace'; workspaceId: string; page: typeof SETTINGS_PAGES[number]['id'] }
const appPages = [
  { id: 'general', icon: Settings2, label: 'General', hint: 'Navigation and workspace preferences' },
  { id: 'providers', icon: Bot, label: 'Agents', hint: 'CLI discovery, providers and custom profiles' },
  { id: 'terminal', icon: SquareTerminal, label: 'Terminal', hint: 'Font, cursor, scrolling and behavior' },
  { id: 'voice', icon: Mic, label: 'Voice', hint: 'Microphone and local transcription' },
  { id: 'notifications', icon: Bell, label: 'Notifications', hint: 'Alerts and sounds' },
  { id: 'updates', icon: ArrowUpCircle, label: 'Updates', hint: 'Version, downloads and installation' },
  { id: 'diagnostics', icon: Activity, label: 'Diagnostics', hint: 'Application health and troubleshooting' }
] as const

export function SettingsCenter(props: SettingsModalProps & {
  workspaces: Workspace[]; initialWorkspaceId?: string; initialPage?: SettingsSection; shellProfiles: ShellProfile[]; allowWorkspaceScope?: boolean
  onSave: (input: UpdateWorkspaceSettingsInput) => Promise<void>
}): ReactElement {
  const [destination, setDestination] = useState<SettingsDestination>(() => {
    if (props.allowWorkspaceScope !== false && props.initialWorkspaceId) return { scope: 'workspace', workspaceId: props.initialWorkspaceId, page: 'appearance' }
    if (props.initialPage) return { scope: 'application', page: props.initialPage }
    try {
      const saved = JSON.parse(localStorage.getItem('oxe.settings.destination') ?? 'null') as SettingsDestination
      if (saved?.scope === 'application' && appPages.some(p => p.id === saved.page)) return saved
      if (props.allowWorkspaceScope !== false && saved?.scope === 'workspace' && props.workspaces.some(w => w.id === saved.workspaceId) && SETTINGS_PAGES.some(p => p.id === saved.page)) return saved
    } catch { /* Invalid preferences use safe defaults. */ }
    return { scope: 'application', page: 'general' }
  })
  const navigationWidth = useNavigationPrefs(state => state.width)
  const [query, setQuery] = useState('')
  const [pending, setPending] = useState<(() => void) | null>(null)
  const [saving, setSaving] = useState(false)
  const draft = useRef<{ dirty: boolean; save: () => Promise<boolean>; discard: () => void } | null>(null)
  const search = useRef<HTMLInputElement>(null)
  const content = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const focusSearch = (event: KeyboardEvent): void => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'f') {
        event.preventDefault(); event.stopPropagation(); search.current?.focus()
      }
    }
    window.addEventListener('keydown', focusSearch, true)
    return () => window.removeEventListener('keydown', focusSearch, true)
  }, [])
  useEffect(() => { if (content.current) content.current.scrollTop = 0 }, [destination])
  const returnPane = useRef(useUIStore.getState().activePaneId)
  const workspace = destination.scope === 'workspace' ? props.workspaces.find(w => w.id === destination.workspaceId) : undefined
  const activeWorkspaceId = useWorkspaceStore(state => state.activeWorkspaceId)
  const scopeWorkspace = props.allowWorkspaceScope === false ? undefined : workspace ?? props.workspaces.find(w => w.id === activeWorkspaceId) ?? props.workspaces[0]
  const navigate = (action: () => void): void => {
    if (draft.current?.dirty) setPending(() => action)
    else action()
  }
  const go = (next: SettingsDestination): void => navigate(() => {
    draft.current = null; setDestination(next)
    try { localStorage.setItem('oxe.settings.destination', JSON.stringify(next)) } catch { /* Preferences are optional. */ }
  })
  const close = (): void => navigate(props.onClose)
  const pages = destination.scope === 'workspace' ? SETTINGS_PAGES : appPages
  const filtered = pages.filter(p => `${p.label} ${p.hint}`.toLowerCase().includes(query.toLowerCase()))
  return <Dialog open onOpenChange={open => { if (!open && !pending) close() }}>
    <DialogContent unstyled showCloseButton={false} className="settings-center" style={{ '--settings-navigation-width': `${navigationWidth}px` } as CSSProperties} overlayClassName="settings-center-overlay" aria-describedby={undefined}
      onCloseAutoFocus={event => { if (returnPane.current) { event.preventDefault(); requestAnimationFrame(() => window.dispatchEvent(new CustomEvent('oxe:focus-pane', { detail: { paneId: returnPane.current } }))) } }}
      onPointerDownOutside={event => event.preventDefault()}>
      <aside className="settings-center-nav">
        <DialogTitle className="settings-center-title"><Settings2 size={18} />Settings</DialogTitle>
        <SearchField className="settings-search" ref={search} label="Search settings" placeholder="Filter categories" value={query} onChange={setQuery} shortcut="Ctrl F" />
        <div className="settings-scope"><span>Settings for</span>
          <div className="settings-scope-choices" role="group" aria-label="Settings scope">
            <button type="button" aria-pressed={destination.scope === 'application'} onClick={() => go({ scope: 'application', page: 'general' })}>Application</button>
            {scopeWorkspace && <button type="button" aria-pressed={destination.scope === 'workspace'} title={scopeWorkspace.rootPath}
              onClick={() => go({ scope: 'workspace', workspaceId: scopeWorkspace.id, page: 'appearance' })}>
              <span>{scopeWorkspace.name}</span><small>Current workspace</small>
            </button>}
          </div>
        </div>
        <div className="settings-scope settings-compact-category"><span>Category</span>
          <div className="settings-category-choices" role="group" aria-label="Settings category">
            {filtered.map(page => <button type="button" key={page.id} aria-pressed={destination.page === page.id}
              onClick={() => go(destination.scope === 'application' ? { scope: 'application', page: page.id as 'general' | SettingsSection } : { ...destination, page: page.id as typeof SETTINGS_PAGES[number]['id'] })}>{page.label}</button>)}
            {!filtered.length && <span className="settings-category-empty">No matching settings</span>}
          </div>
        </div>
        <nav aria-label="Settings categories">
          <span className="settings-nav-caption">{destination.scope === 'application' ? 'Application' : 'Workspace'}</span>
          {filtered.map(({ icon: Icon, ...page }) => <button key={page.id} title={page.hint} aria-label={`${page.label} ${page.hint}`} aria-current={destination.page === page.id ? 'page' : undefined}
            onClick={() => go(destination.scope === 'application' ? { scope: 'application', page: page.id as 'general' | SettingsSection } : { ...destination, page: page.id as typeof SETTINGS_PAGES[number]['id'] })}>
            <Icon size={16} aria-hidden="true" /><span>{page.label}</span>
          </button>)}
          {!filtered.length && <p className="settings-scope">No matching settings.</p>}
        </nav>
        <div className="settings-nav-footer">
          <p className="settings-scope-note" title={workspace?.rootPath}>{workspace ? workspace.name : 'Applies across workspaces'}</p>
          <button className="settings-back" onClick={close}><ArrowLeft size={15} />Back to work</button>
        </div>
      </aside>
      <main className="settings-center-main">
        <header className="settings-center-toolbar">
          <div><span>Settings</span><ChevronRight size={12} aria-hidden="true" /><span title={workspace?.rootPath}>{workspace?.name ?? 'Application'}</span></div>
          <button type="button" aria-label="Close settings" title="Close settings (Esc)" onClick={close}><X size={16} aria-hidden="true" /></button>
        </header>
        <div ref={content} className={`settings-center-content${destination.scope === 'workspace' ? ' is-workspace' : ''}`}>
          {destination.scope === 'workspace' ? workspace ? <WorkspaceSettingsModal key={workspace.id} embedded workspace={workspace} selectedPageId={destination.page}
            shellProfiles={props.shellProfiles} onSave={props.onSave} onClose={close} onDraftChange={value => { draft.current = value }}
            onOpenDiagnostics={() => go({ scope: 'application', page: 'diagnostics' })}
            onOpenTerminal={(paneId, targetWorkspaceId) => navigate(() => {
              returnPane.current = paneId
              void useWorkspaceStore.getState().setActiveWorkspace(targetWorkspaceId ?? workspace.id)
              useUIStore.getState().setMaximizedPane(null)
              useUIStore.getState().setActivePane(paneId)
              useTerminalStore.getState().setActivePaneId(paneId)
              props.onClose()
            })} />
            : <section className="settings-general"><h2>Workspace closed</h2><p>Select another workspace or return to work.</p></section>
            : destination.page === 'general' ? <GeneralSettings onNavigate={page => go({ scope: 'application', page })} /> : <SettingsContent {...props} section={destination.page} onClose={close} />}
        </div>
      </main>
      {pending && <Dialog open onOpenChange={open => { if (!open && !saving) setPending(null) }}><DialogContent unstyled showCloseButton={false} className="settings-unsaved" overlayClassName="settings-unsaved-overlay" aria-describedby={undefined}>
        <DialogTitle>Save your changes?</DialogTitle><p>Your workspace has unapplied changes. If saving fails, stay here to inspect the error and try again.</p>
        <div><button disabled={saving} onClick={() => setPending(null)}>Stay</button>
          <button disabled={saving} onClick={() => { draft.current?.discard(); const action = pending; setPending(null); action() }}>Discard</button>
          <button className="primary-action" disabled={saving} onClick={async () => {
            setSaving(true)
            try { if (await draft.current?.save()) { const action = pending; setPending(null); action() } }
            finally { setSaving(false) }
          }}>{saving ? 'Saving…' : 'Save and continue'}</button></div>
      </DialogContent></Dialog>}
    </DialogContent>
  </Dialog>
}

function GeneralSettings({ onNavigate }: { onNavigate: (page: SettingsSection) => void }): ReactElement {
  const cap = useSettingsStore(s => s.visitedWorkspacesCap)
  const setCap = useSettingsStore(s => s.setVisitedWorkspacesCap)
  return <section className="settings-general"><h2>General</h2><p>Choose a part of OXESpace to configure. Every card opens an existing settings page.</p>
    <h3>Explore settings</h3>
    <div className="settings-general-grid">{appPages.filter(page => page.id !== 'general').map(({ id, icon: Icon, label, hint }) =>
      <button key={id} type="button" className="settings-general-destination" onClick={() => onNavigate(id)}>
        <span><Icon size={16} aria-hidden="true" /><strong>{label}</strong></span><small>{hint}</small>
      </button>)}</div>
    <h3>Workspace navigation</h3>
    <div className="settings-general-card"><div><label htmlFor="workspace-cache-cap">Recently visited workspaces kept ready</label>
      <p>Keep terminal views available when switching workspaces. Changes apply automatically.</p></div>
      <input id="workspace-cache-cap" type="number" min={VISITED_WORKSPACES_CAP_MIN} max={VISITED_WORKSPACES_CAP_MAX} value={cap} onChange={e => { const value = e.currentTarget.valueAsNumber; if (Number.isFinite(value)) setCap(value) }} />
    </div></section>
}
