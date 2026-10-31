import { Activity, ArrowLeft, ArrowUpCircle, Bell, Bot, ChevronRight, Keyboard, Mic, Palette, Settings2, ShieldCheck, SquareTerminal, X } from 'lucide-react'
import { Suspense, useEffect, useRef, useState, type CSSProperties, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import { ModalRoot, ModalSurface, ModalTitle } from '../../ui/Modal'
import { Button, Dialog, LoadingState, TextField } from '../../ui'
import type { SettingsModalProps, SettingsSection } from './SettingsModal'
import { SETTINGS_PAGES } from '../Workspace/workspaceSettingsPages'
import { ErrorBoundary } from '../common/ErrorBoundary'
import { chunk, lazyFrom } from '../../lib/chunk'
import { useSharedProjectMemory } from '../../hooks/useSharedProjectMemory'
import type { ShellProfile, UpdateWorkspaceSettingsInput, Workspace } from '../../../shared/types/workspace'
import { SeenSitesSetting } from './SeenSitesSetting'
import './SettingsCenter.css'
import { useUIStore } from '../../store/ui.store'
import { useWorkspaceStore } from '../../store/workspace.store'
import { SearchField } from '../Navigation/SearchField'
import { useNavigationPrefs } from '../../store/navigation-prefs.store'
import { useTerminalStore } from '../../store/terminal.store'
import { useSettingsStore, VISITED_WORKSPACES_CAP_MAX, VISITED_WORKSPACES_CAP_MIN } from '../../store/settings.store'

/**
 * The pages, one chunk preloaded at idle (src/lib/idlePreload.ts). The frame around them is in the boot bundle, so the
 * first click opens Settings at once, with one dialog: the pages fill its content area when they arrive.
 */
export const SETTINGS_CHUNK = chunk(() => import('./settingsPages'))
const SettingsContent = lazyFrom(SETTINGS_CHUNK, module => module.SettingsContent)
const WorkspaceSettingsModal = lazyFrom(SETTINGS_CHUNK, module => module.WorkspaceSettingsModal)
const PolicySettings = lazyFrom(SETTINGS_CHUNK, module => module.PolicySettings)
const KeyboardSettings = lazyFrom(SETTINGS_CHUNK, module => module.KeyboardSettings)
const retryPages = (): void => { for (const page of [SettingsContent, WorkspaceSettingsModal, PolicySettings, KeyboardSettings]) page.retry() }

type AppPage = 'general' | 'policy' | 'keyboard' | SettingsSection
export type SettingsDestination = { scope: 'application'; page: AppPage } | { scope: 'workspace'; workspaceId: string; page: typeof SETTINGS_PAGES[number]['id'] }
const appPages = [
  { id: 'general', icon: Settings2 }, { id: 'providers', icon: Bot }, { id: 'appearance', icon: Palette },
  { id: 'terminal', icon: SquareTerminal }, { id: 'keyboard', icon: Keyboard }, { id: 'voice', icon: Mic },
  { id: 'notifications', icon: Bell }, { id: 'updates', icon: ArrowUpCircle }, { id: 'policy', icon: ShieldCheck },
  { id: 'diagnostics', icon: Activity }
] as const

export function SettingsCenter(props: SettingsModalProps & {
  workspaces: Workspace[]; initialWorkspaceId?: string; initialPage?: AppPage; shellProfiles: ShellProfile[]; allowWorkspaceScope?: boolean
  onSave: (input: UpdateWorkspaceSettingsInput) => Promise<void>
}): ReactElement {
  const { t } = useTranslation('settings')
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
  const pages = destination.scope === 'workspace' ? SETTINGS_PAGES.filter(p => p.id !== 'memory' || memoryOn)
    : appPages.map(p => ({ ...p, label: t(`center.pages.${p.id}.label`), hint: t(`center.pages.${p.id}.hint`) }))
  const filtered = pages.filter(p => `${p.label} ${p.hint}`.toLowerCase().includes(query.toLowerCase()))
  return <ModalRoot open onOpenChange={open => { if (!open && !pending) close() }}>
    <ModalSurface className="settings-center" style={{ '--settings-navigation-width': `${navigationWidth}px` } as CSSProperties} scrimClassName="settings-center-overlay" aria-describedby={undefined}
      onCloseAutoFocus={event => { if (returnPane.current) { event.preventDefault(); requestAnimationFrame(() => window.dispatchEvent(new CustomEvent('oxe:focus-pane', { detail: { paneId: returnPane.current } }))) } }}
      onPointerDownOutside={event => event.preventDefault()}>
      <aside className="settings-center-nav">
        <ModalTitle className="settings-center-title"><Settings2 size={16} />{t('center.title')}</ModalTitle>
        <SearchField className="settings-search" ref={search} label={t('center.searchLabel')} placeholder={t('center.searchPlaceholder')} value={query} onChange={setQuery} shortcut="Ctrl F" />
        <div className="settings-scope"><span>{t('center.settingsFor')}</span>
          <div className="settings-scope-choices" role="group" aria-label={t('center.scope')}>
            <button type="button" aria-pressed={destination.scope === 'application'} onClick={() => go({ scope: 'application', page: 'appearance' })}>{t('center.application')}</button>
            {scopeWorkspace && <button type="button" aria-pressed={destination.scope === 'workspace'} title={scopeWorkspace.rootPath}
              onClick={() => go({ scope: 'workspace', workspaceId: scopeWorkspace.id, page: 'appearance' })}>
              <span>{scopeWorkspace.name}</span><small>{t('center.currentWorkspace')}</small>
            </button>}
          </div>
        </div>
        <div className="settings-scope settings-compact-category"><span>{t('center.category')}</span>
          <div className="settings-category-choices" role="group" aria-label={t('center.categoryGroup')}>
            {filtered.map(page => <button type="button" key={page.id} aria-pressed={destination.page === page.id}
              onClick={() => go(destination.scope === 'application' ? { scope: 'application', page: page.id as AppPage } : { ...destination, page: page.id as typeof SETTINGS_PAGES[number]['id'] })}>{page.label}</button>)}
            {!filtered.length && <span className="settings-category-empty">{t('center.noMatch')}</span>}
          </div>
        </div>
        <nav aria-label={t('center.categories')}>
          <span className="settings-nav-caption">{destination.scope === 'application' ? t('center.application') : t('center.workspace')}</span>
          {filtered.map(({ icon: Icon, ...page }) => <button key={page.id} title={page.hint} aria-label={`${page.label} ${page.hint}`} aria-current={destination.page === page.id ? 'page' : undefined}
            onClick={() => go(destination.scope === 'application' ? { scope: 'application', page: page.id as AppPage } : { ...destination, page: page.id as typeof SETTINGS_PAGES[number]['id'] })}>
            <Icon size={16} aria-hidden="true" /><span>{page.label}</span>
          </button>)}
          {!filtered.length && <p className="settings-scope">{t('center.noMatch')}</p>}
        </nav>
        <div className="settings-nav-footer">
          <p className="settings-scope-note" title={workspace?.rootPath}>{workspace ? workspace.name : t('center.appliesAcross')}</p>
          <button className="settings-back" onClick={close}><ArrowLeft size={14} />{t('center.backToWork')}</button>
        </div>
      </aside>
      <main className="settings-center-main">
        <header className="settings-center-toolbar">
          <div><span>{t('center.title')}</span><ChevronRight size={12} aria-hidden="true" /><span title={workspace?.rootPath}>{workspace?.name ?? t('center.application')}</span></div>
          <button type="button" aria-label={t('center.close')} title={t('center.closeTitle')} onClick={close}><X size={16} aria-hidden="true" /></button>
        </header>
        <div ref={content} className={`settings-center-content${destination.scope === 'workspace' ? ' is-workspace' : ''}`}><ErrorBoundary id="settings-page" component="SettingsCenter" compact label={t('center.title')} onReset={retryPages}><Suspense fallback={<LoadingState />}>
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
            : <section className="settings-general"><h2>{t('center.workspaceClosed')}</h2><p>{t('center.workspaceClosedHint')}</p></section>
            : destination.page === 'general' ? <GeneralSettings /> : destination.page === 'policy' ? <PolicySettings workspaceId={scopeWorkspace?.id} /> : destination.page === 'keyboard' ? <KeyboardSettings /> : <SettingsContent {...props} section={destination.page} onClose={close} />}
        </Suspense></ErrorBoundary></div>
      </main>
      {pending && <Dialog title={t('center.unsaved.title')} size="sm" onClose={() => { if (!saving) setPending(null) }}
        description={t('center.unsaved.description')}
        footer={<>
          <Button disabled={saving} autoFocus onClick={() => setPending(null)}>{t('center.unsaved.stay')}</Button>
          <Button variant="danger" disabled={saving} onClick={() => { draft.current?.discard(); const action = pending; setPending(null); action() }}>{t('center.unsaved.discard')}</Button>
          <Button variant="primary" loading={saving} onClick={async () => {
            setSaving(true)
            try { if (await draft.current?.save()) { const action = pending; setPending(null); action() } }
            finally { setSaving(false) }
          }}>{saving ? t('center.unsaved.saving') : t('center.unsaved.save')}</Button>
        </>} />}
    </ModalSurface>
  </ModalRoot>
}

function GeneralSettings(): ReactElement {
  const cap = useSettingsStore(s => s.visitedWorkspacesCap)
  const setCap = useSettingsStore(s => s.setVisitedWorkspacesCap)
  const { t } = useTranslation('settings')
  return <section className="settings-general"><h2>{t('general.title')}</h2><p>{t('general.description')}</p>
    <h3>{t('general.navigation')}</h3>
    <div className="settings-general-card"><div><label htmlFor="workspace-cache-cap">{t('general.cacheLabel')}</label>
      <p>{t('general.cacheHint')}</p></div>
      <TextField id="workspace-cache-cap" type="number" min={VISITED_WORKSPACES_CAP_MIN} max={VISITED_WORKSPACES_CAP_MAX} value={cap} onChange={e => { const value = e.currentTarget.valueAsNumber; if (Number.isFinite(value)) setCap(value) }} />
    </div><SeenSitesSetting /></section>
}
