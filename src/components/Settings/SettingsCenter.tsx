import { ArrowLeft, Search, Settings2 } from 'lucide-react'
import { useRef, useState, type ReactElement } from 'react'
import { Dialog, DialogContent, DialogTitle } from '../ui/dialog'
import { SettingsContent, type SettingsModalProps, type SettingsSection } from './SettingsModal'
import { SETTINGS_PAGES, WorkspaceSettingsModal } from '../Workspace/WorkspaceSettingsModal'
import type { ShellProfile, UpdateWorkspaceSettingsInput, Workspace } from '../../../shared/types/workspace'
import './SettingsCenter.css'
import { useUIStore } from '../../store/ui.store'

export type SettingsDestination = { scope: 'application'; page: 'general' | SettingsSection } | { scope: 'workspace'; workspaceId: string; page: typeof SETTINGS_PAGES[number]['id'] }
const appPages = [
  { id: 'general', label: 'General', hint: 'Navigation and workspace preferences' },
  { id: 'providers', label: 'Agents', hint: 'CLI discovery, providers and custom profiles' },
  { id: 'terminal', label: 'Terminal', hint: 'Font, cursor, scrolling and behavior' },
  { id: 'voice', label: 'Voice', hint: 'Microphone and local transcription' },
  { id: 'notifications', label: 'Notifications', hint: 'Alerts and sounds' },
  { id: 'updates', label: 'Updates', hint: 'Version, downloads and installation' },
  { id: 'diagnostics', label: 'Diagnostics', hint: 'Application health and troubleshooting' }
] as const
import { useSettingsStore, VISITED_WORKSPACES_CAP_MAX, VISITED_WORKSPACES_CAP_MIN } from '../../store/settings.store'

export function SettingsCenter(props: SettingsModalProps & {
  workspaces: Workspace[]; initialWorkspaceId?: string; initialPage?: SettingsSection; shellProfiles: ShellProfile[]
  onSave: (input: UpdateWorkspaceSettingsInput) => Promise<void>
}): ReactElement {
  const [destination, setDestination] = useState<SettingsDestination>(() => {
    if (props.initialWorkspaceId) return { scope: 'workspace', workspaceId: props.initialWorkspaceId, page: 'appearance' }
    if (props.initialPage) return { scope: 'application', page: props.initialPage }
    try {
      const saved = JSON.parse(localStorage.getItem('oxe.settings.destination') ?? 'null') as SettingsDestination
      if (saved?.scope === 'application' && appPages.some(p => p.id === saved.page)) return saved
      if (saved?.scope === 'workspace' && props.workspaces.some(w => w.id === saved.workspaceId) && SETTINGS_PAGES.some(p => p.id === saved.page)) return saved
    } catch { /* Invalid preferences use safe defaults. */ }
    return { scope: 'application', page: 'general' }
  })
  const [query, setQuery] = useState('')
  const [pending, setPending] = useState<(() => void) | null>(null)
  const [saving, setSaving] = useState(false)
  const draft = useRef<{ dirty: boolean; save: () => Promise<boolean>; discard: () => void } | null>(null)
  const search = useRef<HTMLInputElement>(null)
  const returnPane = useRef(useUIStore.getState().activePaneId)
  const workspace = destination.scope === 'workspace' ? props.workspaces.find(w => w.id === destination.workspaceId) : undefined
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
    <DialogContent unstyled showCloseButton={false} className="settings-center" overlayClassName="settings-center-overlay" aria-describedby={undefined}
      onCloseAutoFocus={event => { if (returnPane.current) { event.preventDefault(); requestAnimationFrame(() => window.dispatchEvent(new CustomEvent('oxe:focus-pane', { detail: { paneId: returnPane.current } }))) } }}
      onPointerDownOutside={event => event.preventDefault()}
      onKeyDown={event => { if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'f') { event.preventDefault(); event.stopPropagation(); search.current?.focus() } }}>
      <aside className="settings-center-nav">
        <button className="settings-back" onClick={close}><ArrowLeft size={16} />Back to work</button>
        <DialogTitle className="settings-center-title"><Settings2 size={18} />Settings</DialogTitle>
        <label className="settings-search"><Search size={15} /><input ref={search} aria-label="Search settings" placeholder="Search settings" value={query} onChange={e => setQuery(e.target.value)} /><kbd>Ctrl F</kbd></label>
        <label className="settings-scope">Settings for
          <select aria-label="Settings scope" value={destination.scope === 'application' ? 'application' : destination.workspaceId}
            onChange={e => go(e.target.value === 'application' ? { scope: 'application', page: 'general' } : { scope: 'workspace', workspaceId: e.target.value, page: 'appearance' })}>
            <option value="application">Application</option>
            {props.workspaces.map(w => <option key={w.id} value={w.id}>{w.name} — {w.rootPath}</option>)}
          </select>
        </label>
        <label className="settings-scope settings-compact-category">Category
          <select aria-label="Settings category" value={destination.page} onChange={event => go(destination.scope === 'application'
            ? { scope: 'application', page: event.target.value as 'general' | SettingsSection }
            : { ...destination, page: event.target.value as typeof SETTINGS_PAGES[number]['id'] })}>
            {filtered.map(page => <option key={page.id} value={page.id}>{page.label}</option>)}
          </select>
        </label>
        <nav aria-label="Settings categories">
          {filtered.map(page => <button key={page.id} aria-current={destination.page === page.id ? 'page' : undefined}
            onClick={() => go(destination.scope === 'application' ? { scope: 'application', page: page.id as 'general' | SettingsSection } : { ...destination, page: page.id as typeof SETTINGS_PAGES[number]['id'] })}>
            <span>{page.label}</span><small>{page.hint}</small>
          </button>)}
          {!filtered.length && <p className="settings-scope">No matching settings.</p>}
        </nav>
        <p className="settings-scope settings-scope-note" title={workspace?.rootPath}>{workspace ? `${workspace.name}\n${workspace.rootPath}` : 'Application preferences apply across workspaces.'}</p>
      </aside>
      <main className="settings-center-main">
        {destination.scope === 'workspace' ? workspace ? <WorkspaceSettingsModal key={workspace.id} embedded workspace={workspace} selectedPageId={destination.page}
          shellProfiles={props.shellProfiles} onSave={props.onSave} onClose={close} onDraftChange={value => { draft.current = value }} />
          : <section className="settings-general"><h2>Workspace closed</h2><p>Select another workspace or return to work.</p></section>
          : destination.page === 'general' ? <GeneralSettings /> : <SettingsContent {...props} section={destination.page} onClose={close} />}
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

function GeneralSettings(): ReactElement {
  const cap = useSettingsStore(s => s.visitedWorkspacesCap)
  const setCap = useSettingsStore(s => s.setVisitedWorkspacesCap)
  return <section className="settings-general"><h2>General</h2><p>Application-wide navigation and workspace preferences.</p>
    <div className="settings-general-card"><label htmlFor="workspace-cache-cap">Recently visited workspaces kept ready</label>
      <p>Keep terminal views available when switching workspaces. Changes apply automatically.</p>
      <input id="workspace-cache-cap" type="number" min={VISITED_WORKSPACES_CAP_MIN} max={VISITED_WORKSPACES_CAP_MAX} value={cap} onChange={e => { const value = e.currentTarget.valueAsNumber; if (Number.isFinite(value)) setCap(value) }} />
    </div></section>
}
