import { Activity, ArrowLeft, ArrowUpCircle, Bell, Bot, ChevronRight, Keyboard, Mic, Palette, Settings2, ShieldCheck, SquareTerminal, X } from 'lucide-react'
import { useEffect, useRef, useState, type CSSProperties, type ReactElement } from 'react'
import { ModalRoot, ModalSurface, ModalTitle } from '../../ui/Modal'
import { Button, Dialog, TextField } from '../../ui'
import { SettingsContent, type SettingsModalProps, type SettingsSection } from './SettingsModal'
import { SETTINGS_PAGES, WorkspaceSettingsModal } from '../Workspace/WorkspaceSettingsModal'
import { useSharedProjectMemory } from '../../hooks/useSharedProjectMemory'
import type { ShellProfile, UpdateWorkspaceSettingsInput, Workspace } from '../../../shared/types/workspace'
import { PolicySettings } from './PolicySettings'
import { KeyboardSettings } from './KeyboardSettings'
import './SettingsCenter.css'
import { useUIStore } from '../../store/ui.store'
import { useWorkspaceStore } from '../../store/workspace.store'
import { SearchField } from '../Navigation/SearchField'
import { useNavigationPrefs } from '../../store/navigation-prefs.store'
import { useTerminalStore } from '../../store/terminal.store'
import { useSettingsStore, VISITED_WORKSPACES_CAP_MAX, VISITED_WORKSPACES_CAP_MIN } from '../../store/settings.store'

type AppPage = 'general' | 'policy' | 'keyboard' | SettingsSection
export type SettingsDestination = { scope: 'application'; page: AppPage } | { scope: 'workspace'; workspaceId: string; page: typeof SETTINGS_PAGES[number]['id'] }
const appPages = [
  { id: 'general', icon: Settings2, label: 'General', hint: 'Navigation and workspace preferences' },
  { id: 'providers', icon: Bot, label: 'Agents', hint: 'Agent CLIs, custom agents and idle conversations' },
  { id: 'appearance', icon: Palette, label: 'Appearance', hint: 'Mode and language' },
  { id: 'terminal', icon: SquareTerminal, label: 'Terminal', hint: 'Font, cursor, scrolling and behavior' },
  { id: 'keyboard', icon: Keyboard, label: 'Keyboard', hint: 'Shortcuts and key bindings' },
  { id: 'voice', icon: Mic, label: 'Voice', hint: 'Microphone and local transcription' },
  { id: 'notifications', icon: Bell, label: 'Notifications', hint: 'Alerts and sounds' },
  { id: 'updates', icon: ArrowUpCircle, label: 'Updates', hint: 'Version, downloads and installation' },
  { id: 'policy', icon: ShieldCheck, label: 'Policy', hint: 'What agents are blocked from using' },
  { id: 'diagnostics', icon: Activity, label: 'Diagnostics', hint: 'Application health and troubleshooting' }
] as const

export function SettingsCenter(props: SettingsModalProps & {
  workspaces: Workspace[]; initialWorkspaceId?: string; initialPage?: AppPage; shellProfiles: ShellProfile[]; allowWorkspaceScope?: boolean
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
    return { scope: 'application', page: 'appearance' }
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
  const memoryOn = useSharedProjectMemory(destination.scope === 'workspace' ? destination.workspaceId : undefined) === true
  const pages = destination.scope === 'workspace' ? SETTINGS_PAGES.filter(p => p.id !== 'memory' || memoryOn) : appPages
  const filtered = pages.filter(p => `${p.label} ${p.hint}`.toLowerCase().includes(query.toLowerCase()))
  return <ModalRoot open onOpenChange={open => { if (!open && !pending) close() }}>
    <ModalSurface className="settings-center" style={{ '--settings-navigation-width': `${navigationWidth}px` } as CSSProperties} scrimClassName="settings-center-overlay" aria-describedby={undefined}
      onCloseAutoFocus={event => { if (returnPane.current) { event.preventDefault(); requestAnimationFrame(() => window.dispatchEvent(new CustomEvent('oxe:focus-pane', { detail: { paneId: returnPane.current } }))) } }}
      onPointerDownOutside={event => event.preventDefault()}>
      <aside className="settings-center-nav">
        <ModalTitle className="settings-center-title"><Settings2 size={16} />Settings</ModalTitle>
        <SearchField className="settings-search" ref={search} label="Search settings" placeholder="Filter categories" value={query} onChange={setQuery} shortcut="Ctrl F" />
        <div className="settings-scope"><span>Settings for</span>
          <div className="settings-scope-choices" role="group" aria-label="Settings scope">
            <button type="button" aria-pressed={destination.scope === 'application'} onClick={() => go({ scope: 'application', page: 'appearance' })}>Application</button>
            {scopeWorkspace && <button type="button" aria-pressed={destination.scope === 'workspace'} title={scopeWorkspace.rootPath}
              onClick={() => go({ scope: 'workspace', workspaceId: scopeWorkspace.id, page: 'appearance' })}>
              <span>{scopeWorkspace.name}</span><small>Current workspace</small>
            </button>}
          </div>
        </div>
        <div className="settings-scope settings-compact-category"><span>Category</span>
          <div className="settings-category-choices" role="group" aria-label="Settings category">
            {filtered.map(page => <button type="button" key={page.id} aria-pressed={destination.page === page.id}
              onClick={() => go(destination.scope === 'application' ? { scope: 'application', page: page.id as AppPage } : { ...destination, page: page.id as typeof SETTINGS_PAGES[number]['id'] })}>{page.label}</button>)}
            {!filtered.length && <span className="settings-category-empty">No matching settings</span>}
          </div>
        </div>
        <nav aria-label="Settings categories">
          <span className="settings-nav-caption">{destination.scope === 'application' ? 'Application' : 'Workspace'}</span>
          {filtered.map(({ icon: Icon, ...page }) => <button key={page.id} title={page.hint} aria-label={`${page.label} ${page.hint}`} aria-current={destination.page === page.id ? 'page' : undefined}
            onClick={() => go(destination.scope === 'application' ? { scope: 'application', page: page.id as AppPage } : { ...destination, page: page.id as typeof SETTINGS_PAGES[number]['id'] })}>
            <Icon size={16} aria-hidden="true" /><span>{page.label}</span>
          </button>)}
          {!filtered.length && <p className="settings-scope">No matching settings.</p>}
        </nav>
        <div className="settings-nav-footer">
          <p className="settings-scope-note" title={workspace?.rootPath}>{workspace ? workspace.name : 'Applies across workspaces'}</p>
          <button className="settings-back" onClick={close}><ArrowLeft size={14} />Back to work</button>
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
            : destination.page === 'general' ? <GeneralSettings /> : destination.page === 'policy' ? <PolicySettings workspaceId={scopeWorkspace?.id} /> : destination.page === 'keyboard' ? <KeyboardSettings /> : <SettingsContent {...props} section={destination.page} onClose={close} />}
        </div>
      </main>
      {pending && <Dialog title="Save your changes?" size="sm" onClose={() => { if (!saving) setPending(null) }}
        description="Your workspace has unapplied changes. If saving fails, stay here to inspect the error and try again."
        footer={<>
          <Button disabled={saving} autoFocus onClick={() => setPending(null)}>Stay</Button>
          <Button variant="danger" disabled={saving} onClick={() => { draft.current?.discard(); const action = pending; setPending(null); action() }}>Discard</Button>
          <Button variant="primary" loading={saving} onClick={async () => {
            setSaving(true)
            try { if (await draft.current?.save()) { const action = pending; setPending(null); action() } }
            finally { setSaving(false) }
          }}>{saving ? 'Saving…' : 'Save and continue'}</Button>
        </>} />}
    </ModalSurface>
  </ModalRoot>
}

function GeneralSettings(): ReactElement {
  const cap = useSettingsStore(s => s.visitedWorkspacesCap)
  const setCap = useSettingsStore(s => s.setVisitedWorkspacesCap)
  return <section className="settings-general"><h2>General</h2><p>Preferences that apply across every workspace.</p>
    <h3>Workspace navigation</h3>
    <div className="settings-general-card"><div><label htmlFor="workspace-cache-cap">Recently visited workspaces kept ready</label>
      <p>Keep terminal views available when switching workspaces. Changes apply automatically.</p></div>
      <TextField id="workspace-cache-cap" type="number" min={VISITED_WORKSPACES_CAP_MIN} max={VISITED_WORKSPACES_CAP_MAX} value={cap} onChange={e => { const value = e.currentTarget.valueAsNumber; if (Number.isFinite(value)) setCap(value) }} />
    </div></section>
}
