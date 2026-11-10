import { Activity, ArrowLeft, ArrowUpCircle, Bell, Bot, ChevronRight, Keyboard, Palette, Settings2, ShieldCheck, Smartphone, SquareTerminal, Wrench, X, type LucideIcon } from 'lucide-react'
import { i18n } from '../../i18n'
import { Suspense, useEffect, useRef, useState, type CSSProperties, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import { ModalRoot, ModalSurface, ModalTitle } from '../../ui/Modal'
import { EmptyState, Skeleton, TextField } from '../../ui'
import type { SettingsModalProps, SettingsSection } from './SettingsModal'
import { SETTINGS_PAGES } from '../Workspace/workspaceSettingsPages'
import { ErrorBoundary } from '../common/ErrorBoundary'
import { chunk, lazyFrom } from '../../lib/chunk'
import { useSharedProjectMemory } from '../../hooks/useSharedProjectMemory'
import type { ShellProfile, UpdateWorkspaceSettingsInput, Workspace } from '../../../shared/types/workspace'
import { SeenSitesSetting } from './SeenSitesSetting'
import { ExternalEditorSetting } from './ExternalEditorSetting'
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
const DevicesSettings = lazyFrom(SETTINGS_CHUNK, module => module.DevicesSettings)
const retryPages = (): void => { for (const page of [SettingsContent, WorkspaceSettingsModal, PolicySettings, KeyboardSettings, DevicesSettings]) page.retry() }

export type AppPage = 'general' | 'appearance' | 'providers' | 'policy' | 'notifications' | 'keyboard' | 'terminal' | 'mcp' | 'devices' | 'privacy' | 'activity' | 'diagnostics' | 'about'
export type SettingsDestination = { scope: 'application'; page: AppPage } | { scope: 'workspace'; workspaceId: string; page: typeof SETTINGS_PAGES[number]['id'] }
export type Page = { id: string; label: string; hint?: string }

const ts = i18n.getFixedT(null, 'settings')

function appPage(id: AppPage, icon: LucideIcon, defaultLabel: string, defaultHint = '') {
  return {
    id,
    icon,
    get label() { return ts(`center.pages.${id}.label`, { defaultValue: defaultLabel }) },
    get hint() { return ts(`center.pages.${id}.hint`, { defaultValue: defaultHint }) }
  }
}

export const APPLICATION_SETTINGS_PAGES = [
  appPage('general', Settings2, 'General', 'Navigation, workspace caches and default external editor.'),
  appPage('appearance', Palette, 'Appearance', 'Theme, font sizing and layout density.'),
  appPage('providers', Bot, 'Agents', 'Default model, fallback chain and provider API keys.'),
  appPage('policy', ShieldCheck, 'Approvals and safety', 'Safety boundaries, read-only paths and write permissions.'),
  appPage('notifications', Bell, 'Notifications', 'Desktop alerts, sound effects and quiet hours.'),
  appPage('keyboard', Keyboard, 'Keyboard', 'Keyboard shortcuts and custom chords.'),
  appPage('terminal', SquareTerminal, 'Terminal', 'Default shell, scrollback buffer and font overrides.'),
  appPage('mcp', Wrench, 'MCP servers and skills', 'Connected MCP servers, custom tools and agent skills.'),
  appPage('devices', Smartphone, 'Phone and devices', 'Linked mobile devices and companion app connections.'),
  appPage('privacy', ShieldCheck, 'Data and privacy', 'Diagnostics telemetry, audit retention and data export.'),
  appPage('activity', Activity, 'Agent activity', 'What agents changed through OXESpace, and what you decided.'),
  appPage('diagnostics', Activity, 'Diagnostics', 'System health, runtime logs and active background tasks.'),
  appPage('about', ArrowUpCircle, 'About', 'Version details, release notes and open-source licenses.')
] as const

export function searchSettingsPages(query: string): Page[] {
  const needle = query.trim().toLowerCase()
  if (!needle) return []
  const all: readonly Page[] = [...APPLICATION_SETTINGS_PAGES, ...SETTINGS_PAGES]
  return all.filter(page => `${page.label} ${page.hint ?? ''}`.toLowerCase().includes(needle))
}

/**
 * The application page a deep link or a saved destination opens. A page that no longer exists lands on Settings' first page.
 */
export function resolveAppPage(page: string): AppPage {
  return (APPLICATION_SETTINGS_PAGES.find(p => p.id === page)?.id as AppPage) ?? 'general'
}

export function SettingsCenter(props: SettingsModalProps & {
  workspaces: Workspace[]; initialWorkspaceId?: string; initialPage?: AppPage; shellProfiles: ShellProfile[]; allowWorkspaceScope?: boolean
  onSave: (input: UpdateWorkspaceSettingsInput) => Promise<void>
}): ReactElement {
  const { t } = useTranslation('settings')
  const [destination, setDestination] = useState<SettingsDestination>(() => {
    if (props.allowWorkspaceScope !== false && props.initialWorkspaceId) return { scope: 'workspace', workspaceId: props.initialWorkspaceId, page: 'general' }
    if (props.initialPage) return { scope: 'application', page: resolveAppPage(props.initialPage) }
    try {
      const saved = JSON.parse(localStorage.getItem('oxe.settings.destination') ?? 'null') as SettingsDestination
      if (saved?.scope === 'application' && typeof saved.page === 'string') return { scope: 'application', page: resolveAppPage(saved.page) }
      if (props.allowWorkspaceScope !== false && saved?.scope === 'workspace' && props.workspaces.some(w => w.id === saved.workspaceId) && SETTINGS_PAGES.some(p => p.id === saved.page)) return saved
    } catch { /* Invalid preferences use safe defaults. */ }
    return { scope: 'application', page: 'appearance' }
  })
  const navigationWidth = useNavigationPrefs(state => state.width)
  const [query, setQuery] = useState('')
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
  // Every setting applies at once (U2), so leaving a page never has anything to save or discard.
  const go = (next: SettingsDestination): void => {
    setDestination(next)
    try { localStorage.setItem('oxe.settings.destination', JSON.stringify(next)) } catch { /* Preferences are optional. */ }
  }
  const close = (): void => props.onClose()
  const pages = destination.scope === 'workspace' ? SETTINGS_PAGES : APPLICATION_SETTINGS_PAGES
  const filtered = pages.filter(p => `${p.label} ${p.hint ?? ''}`.toLowerCase().includes(query.toLowerCase()))
  return <ModalRoot open onOpenChange={open => { if (!open) close() }}>
    <ModalSurface className="settings-center" style={{ '--settings-navigation-width': `${navigationWidth}px` } as CSSProperties} scrimClassName="settings-center-overlay" toasts aria-describedby={undefined}
      onCloseAutoFocus={event => { if (returnPane.current) { event.preventDefault(); requestAnimationFrame(() => window.dispatchEvent(new CustomEvent('oxe:focus-pane', { detail: { paneId: returnPane.current } }))) } }}
      onPointerDownOutside={event => event.preventDefault()}>
      <aside className="settings-center-nav">
        <ModalTitle className="settings-center-title"><Settings2 size={16} />{t('center.title')}</ModalTitle>
        <SearchField className="settings-search" ref={search} label={t('center.searchLabel')} placeholder={t('center.searchPlaceholder')} value={query} onChange={setQuery} shortcut="Ctrl F" />
        <div className="settings-scope"><span>{t('center.settingsFor')}</span>
          <div className="settings-scope-choices" role="group" aria-label={t('center.scope')}>
            <button type="button" aria-pressed={destination.scope === 'application'} onClick={() => go({ scope: 'application', page: 'appearance' })}>{t('center.application')}</button>
            {scopeWorkspace && <button type="button" aria-pressed={destination.scope === 'workspace'} title={scopeWorkspace.rootPath}
              onClick={() => go({ scope: 'workspace', workspaceId: scopeWorkspace.id, page: 'general' })}>
              <span>{scopeWorkspace.name}</span><small>{t('center.currentWorkspace')}</small>
            </button>}
          </div>
        </div>
        <div className="settings-scope settings-compact-category"><span>{t('center.category')}</span>
          <div className="settings-category-choices" role="group" aria-label={t('center.categoryGroup')}>
            {filtered.map(page => <button type="button" key={page.id} aria-pressed={destination.page === page.id}
              onClick={() => go(destination.scope === 'application' ? { scope: 'application', page: page.id as AppPage } : { ...destination, page: page.id as typeof SETTINGS_PAGES[number]['id'] })}>{page.label}</button>)}
            {!filtered.length && <EmptyState compact title={t('center.noMatch')} />}
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
        <div ref={content} className={`settings-center-content${destination.scope === 'workspace' ? ' is-workspace' : ''}`}><ErrorBoundary id="settings-page" component="SettingsCenter" compact label={t('center.title')} onReset={retryPages}><Suspense fallback={<Skeleton lines={6} label={t('center.title')} />}>
          {destination.scope === 'workspace' ? workspace ? <WorkspaceSettingsModal key={workspace.id} embedded workspace={workspace} selectedPageId={destination.page}
            shellProfiles={props.shellProfiles} onSave={props.onSave} onClose={close}
            onOpenDiagnostics={() => go({ scope: 'application', page: 'diagnostics' })}
            onOpenTerminal={(paneId, targetWorkspaceId) => {
              returnPane.current = paneId
              void useWorkspaceStore.getState().setActiveWorkspace(targetWorkspaceId ?? workspace.id)
              useUIStore.getState().setMaximizedPane(null)
              useUIStore.getState().setActivePane(paneId)
              useTerminalStore.getState().setActivePaneId(paneId)
              props.onClose()
            }} />
            : <section className="settings-general"><h2>{t('center.workspaceClosed')}</h2><p>{t('center.workspaceClosedHint')}</p></section>
            : destination.page === 'general' ? <GeneralSettings /> : destination.page === 'policy' ? <PolicySettings workspaceId={scopeWorkspace?.id} /> : destination.page === 'keyboard' ? <KeyboardSettings /> : destination.page === 'devices' ? <DevicesSettings /> : <SettingsContent {...props} section={destination.page} onClose={close} />}
        </Suspense></ErrorBoundary></div>
      </main>
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
    </div><ExternalEditorSetting /><SeenSitesSetting /></section>
}
