import { Activity, ArrowLeft, ArrowUpCircle, Bell, Bot, ChevronRight, History, Keyboard, KeyRound, Lock, Palette, Settings2, ShieldCheck, Smartphone, SquareTerminal, Wrench, X, type LucideIcon } from 'lucide-react'
import { i18n } from '../../i18n'
import { Suspense, useEffect, useRef, useState, type CSSProperties, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import { ModalRoot, ModalSurface, ModalTitle } from '../../ui/Modal'
import { EmptyState, Skeleton, TextField } from '../../ui'
import type { SettingsModalProps, SettingsSection } from './SettingsModal'
import { SETTINGS_PAGES } from '../Workspace/workspaceSettingsPages'
import { ErrorBoundary } from '../common/ErrorBoundary'
import { chunk, lazyFrom } from '../../lib/chunk'
import type { ShellProfile, UpdateWorkspaceSettingsInput, Workspace } from '../../../shared/types/workspace'
import { SeenSitesSetting } from './SeenSitesSetting'
import { ExternalEditorSetting } from './ExternalEditorSetting'
import { DataSettings } from './DataSettings'
import { RISKY_SETTING_ROWS } from './riskyRows'
import './SettingsCenter.css'
import { useUIStore } from '../../store/ui.store'
import { useWorkspaceStore } from '../../store/workspace.store'
import { SearchField } from '../Navigation/SearchField'
import { useNavigationPrefs } from '../../store/navigation-prefs.store'
import { useTerminalStore } from '../../store/terminal.store'
import { selectMcpServers, useMcpStore } from '../../store/mcp.store'
import { useActivityStore } from '../../store/activity.store'
import { useSettingsStore, VISITED_WORKSPACES_CAP_MAX, VISITED_WORKSPACES_CAP_MIN } from '../../store/settings.store'

/**
 * The pages, one chunk preloaded at idle (src/lib/idlePreload.ts). The frame around them is in the boot bundle, so the
 * first click opens Settings at once, with one dialog: the pages fill its content area when they arrive.
 */
export const SETTINGS_CHUNK = chunk(() => import('./settingsPages'))
const SettingsContent = lazyFrom(SETTINGS_CHUNK, module => module.SettingsContent)
const WorkspaceSettingsModal = lazyFrom(SETTINGS_CHUNK, module => module.WorkspaceSettingsModal)
const PolicySettings = lazyFrom(SETTINGS_CHUNK, module => module.PolicySettings)
const AgentPermissionsSettings = lazyFrom(SETTINGS_CHUNK, module => module.AgentPermissionsSettings)
const KeyboardSettings = lazyFrom(SETTINGS_CHUNK, module => module.KeyboardSettings)
const DevicesSettings = lazyFrom(SETTINGS_CHUNK, module => module.DevicesSettings)
const retryPages = (): void => { for (const page of [SettingsContent, WorkspaceSettingsModal, PolicySettings, AgentPermissionsSettings, KeyboardSettings, DevicesSettings]) page.retry() }

export type AppPage = 'general' | 'appearance' | 'providers' | 'policy' | 'agent-permissions' | 'notifications' | 'keyboard' | 'terminal' | 'mcp' | 'devices' | 'privacy' | 'activity' | 'diagnostics' | 'about'
export type SettingsDestination = { scope: 'application'; page: AppPage } | { scope: 'workspace'; workspaceId: string; page: typeof SETTINGS_PAGES[number]['id'] }
export type Page = { id: string; label: string; hint?: string; keywords?: readonly string[] }
type NavEntry = Page & { icon: LucideIcon }

const ts = i18n.getFixedT(null, 'settings')

function appPage(id: AppPage, icon: LucideIcon, defaultLabel: string, defaultHint = '', keywords: readonly string[] = []) {
  return {
    id,
    icon,
    keywords,
    get label() { return ts(`center.pages.${id}.label`, { defaultValue: defaultLabel }) },
    get hint() { return ts(`center.pages.${id}.hint`, { defaultValue: defaultHint }) }
  }
}

export const APPLICATION_SETTINGS_PAGES = [
  appPage('general', Settings2, 'General', 'Navigation, workspace caches and default external editor.', ['editor', 'vscode', 'cursor', 'sites', 'cache']),
  appPage('appearance', Palette, 'Appearance', 'Theme, font sizing and layout density.', ['theme', 'dark', 'light', 'font', 'density', 'language', 'locale']),
  appPage('providers', Bot, 'Agents', 'Default model, fallback chain and provider API keys.', ['claude', 'codex', 'model', 'agent', 'cli', 'idle']),
  appPage('policy', ShieldCheck, 'Approvals and safety', 'Safety boundaries, read-only paths and write permissions.', ['approvals', 'safety', 'sandbox', 'rules', 'yaml']),
  appPage('agent-permissions', KeyRound, 'What agents can do', 'Always allowed commands, databases, HTTP hosts and policy rules.', ['permissions', 'commands', 'databases', 'hosts', 'http', 'allowed', 'revoke']),
  appPage('notifications', Bell, 'Notifications', 'Desktop alerts', ['alerts', 'bell', 'desktop']),
  appPage('keyboard', Keyboard, 'Keyboard', 'Keyboard shortcuts and custom chords.', ['shortcuts', 'keybindings', 'chords', 'hotkeys']),
  appPage('terminal', SquareTerminal, 'Terminal', 'Default shell, scrollback buffer and font overrides.', ['shell', 'scrollback', 'cursor', 'powershell', 'bash', 'zsh']),
  appPage('mcp', Wrench, 'MCP servers and skills', 'Connected MCP servers, custom tools and agent skills.', ['mcp', 'tools', 'skills', 'servers', 'oxe.yaml']),
  appPage('devices', Smartphone, 'Phone and devices', 'Linked mobile devices and companion app connections.', ['phone', 'mobile', 'android', 'mirror', 'qr', 'network', 'pairing']),
  appPage('privacy', Lock, 'Data and privacy', 'Usage count and data export', ['export', 'privacy', 'usage', 'count']),
  appPage('activity', History, 'Agent activity', 'What agents changed through OXESpace, and what you decided.', ['audit', 'outgoing', 'proxy', 'hosts', 'network', 'changes', 'containers']),
  appPage('diagnostics', Activity, 'Diagnostics', 'System health, runtime logs and active background tasks.', ['health', 'logs', 'doctor', 'troubleshooting', 'support']),
  appPage('about', ArrowUpCircle, 'About', 'Version details, release notes and open-source licenses.', ['version', 'updates', 'release', 'changelog', 'licenses'])
] as const

function matchesPage(page: Page, query: string): boolean {
  const needle = query.trim().toLowerCase()
  if (!needle) return true
  return `${page.label} ${page.hint ?? ''} ${(page.keywords ?? []).join(' ')}`.toLowerCase().includes(needle)
}

export function searchSettingsPages(query: string): Page[] {
  const needle = query.trim().toLowerCase()
  if (!needle) return []
  const all: readonly Page[] = [...APPLICATION_SETTINGS_PAGES, ...SETTINGS_PAGES]
  return all.filter(page => matchesPage(page, needle))
}

/**
 * The application page a deep link or a saved destination opens. A page that no longer exists lands on Settings' first page.
 */
export function resolveAppPage(page: string): AppPage {
  return (APPLICATION_SETTINGS_PAGES.find(p => p.id === page)?.id as AppPage) ?? 'general'
}

export function restoreSettingsDestination(
  saved: unknown,
  workspaceIds: readonly string[],
  allowWorkspaceScope = true
): SettingsDestination {
  if (saved && typeof saved === 'object') {
    const candidate = saved as { scope?: unknown; page?: unknown; workspaceId?: unknown }
    if (candidate.scope === 'application' && typeof candidate.page === 'string') {
      return { scope: 'application', page: resolveAppPage(candidate.page) }
    }
    if (
      allowWorkspaceScope &&
      candidate.scope === 'workspace' &&
      typeof candidate.workspaceId === 'string' &&
      workspaceIds.includes(candidate.workspaceId)
    ) {
      const page = SETTINGS_PAGES.find(p => p.id === candidate.page)?.id ?? SETTINGS_PAGES[0].id
      return { scope: 'workspace', workspaceId: candidate.workspaceId, page }
    }
  }
  return { scope: 'application', page: 'appearance' }
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
      const saved = JSON.parse(localStorage.getItem('oxe.settings.destination') ?? 'null') as unknown
      return restoreSettingsDestination(saved, props.workspaces.map(w => w.id), props.allowWorkspaceScope !== false)
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
  const requestedPage = useUIStore(state => state.settingsInitialPage)
  const prevRequestedPage = useRef(requestedPage)
  useEffect(() => {
    if (requestedPage && requestedPage !== prevRequestedPage.current) {
      prevRequestedPage.current = requestedPage
      setDestination({ scope: 'application', page: resolveAppPage(requestedPage) })
    } else {
      prevRequestedPage.current = requestedPage
    }
  }, [requestedPage])
  const returnPane = useRef(useUIStore.getState().activePaneId)
  // What had focus when Settings opened (the gear, a menu item). Settings covers the whole window, so when it closes
  // that control is only just back on screen: focus is returned on the next frame, or it fell to <body> (visual QA r4).
  const [opener] = useState(() => document.activeElement instanceof HTMLElement && document.activeElement !== document.body ? document.activeElement : null)
  const workspace = destination.scope === 'workspace' ? props.workspaces.find(w => w.id === destination.workspaceId) : undefined
  const activeWorkspaceId = useWorkspaceStore(state => state.activeWorkspaceId)
  const scopeWorkspace = props.allowWorkspaceScope === false ? undefined : workspace ?? props.workspaces.find(w => w.id === activeWorkspaceId) ?? props.workspaces[0]
  // Every setting applies at once (U2), so leaving a page never has anything to save or discard.
  const go = (next: SettingsDestination): void => {
    setDestination(next)
    try { localStorage.setItem('oxe.settings.destination', JSON.stringify(next)) } catch { /* Preferences are optional. */ }
  }
  const close = (): void => props.onClose()
  const mcpCount = useMcpStore(selectMcpServers(scopeWorkspace?.id ?? activeWorkspaceId)).length
  const activityCount = useActivityStore(state => state.items.length)
  const readyAgentsCount = (props.agentReadiness ?? []).filter(r => r.status === 'ready' || r.status === 'partial').length
  const appBadge = (id: string): number => (id === 'providers' ? readyAgentsCount : id === 'mcp' ? mcpCount : id === 'activity' ? activityCount : 0)
  const appFiltered = APPLICATION_SETTINGS_PAGES.filter(p => matchesPage(p, query))
  const wsFiltered = scopeWorkspace ? SETTINGS_PAGES.filter(p => matchesPage(p, query)) : []
  const workspaceCaption = scopeWorkspace ? t('center.workspaceNamed', { name: scopeWorkspace.name }) : t('center.workspace')
  const renderNavButton = ({ icon: Icon, ...page }: NavEntry, current: boolean, onSelect: () => void, keyPrefix = '', inactiveScopeLabel?: string, badge = 0): ReactElement => (
    <button
      key={`${keyPrefix}${page.id}`}
      title={page.hint}
      aria-label={`${inactiveScopeLabel && page.id === 'general' ? `${inactiveScopeLabel}: ` : ''}${page.label}${badge > 0 ? ` (${badge})` : ''} ${page.hint ?? ''}`}
      aria-current={current ? 'page' : undefined}
      onClick={onSelect}
    >
      <Icon size={16} aria-hidden="true" /><span>{page.label}</span>
      {/* Drawn from the attribute, so the button's text is its name: as text, "MCP servers and skills3" was not in
          the accessible name and a voice user could not say what they read (label-content-name-mismatch). */}
      {badge > 0 ? <small className="settings-nav-badge" aria-hidden="true" data-count={badge} /> : null}
    </button>
  )
  const hasAnyNav = appFiltered.length > 0 || wsFiltered.length > 0

  return <ModalRoot open onOpenChange={open => { if (!open) close() }}>
    <ModalSurface className="settings-center" style={{ '--settings-navigation-width': `${navigationWidth}px` } as CSSProperties} scrimClassName="settings-center-overlay" toasts aria-describedby={undefined}
      onCloseAutoFocus={event => {
        // Opened from a control (the gear, a menu): back to it. Opened from the keyboard inside a terminal: back to the pane.
        if (opener && !opener.closest('[data-testid="pane-container"]')) { event.preventDefault(); requestAnimationFrame(() => { if (opener.isConnected) opener.focus({ preventScroll: true }) }) }
        else if (returnPane.current) { event.preventDefault(); requestAnimationFrame(() => window.dispatchEvent(new CustomEvent('oxe:focus-pane', { detail: { paneId: returnPane.current } }))) }
      }}
      onPointerDownOutside={event => event.preventDefault()}>
      <aside className="settings-center-nav">
        <ModalTitle className="settings-center-title"><Settings2 size={16} />{t('center.title')}</ModalTitle>
        <SearchField className="settings-search" ref={search} label={t('center.searchLabel')} placeholder={t('center.searchPlaceholder')} value={query} onChange={setQuery} shortcut="Ctrl F" />
        <div className="settings-scope settings-compact-category"><span>{t('center.category')}</span>
          <div className="settings-category-choices" role="group" aria-label={t('center.categoryGroup')}>
            {appFiltered.map(page => <button type="button" key={`app-${page.id}`} aria-pressed={destination.scope === 'application' && destination.page === page.id}
              onClick={() => go({ scope: 'application', page: page.id as AppPage })}>{page.label}</button>)}
            {scopeWorkspace && wsFiltered.map(page => <button type="button" key={`ws-${page.id}`} aria-pressed={destination.scope === 'workspace' && destination.page === page.id}
              onClick={() => go({ scope: 'workspace', workspaceId: scopeWorkspace.id, page: page.id as typeof SETTINGS_PAGES[number]['id'] })}>{`${scopeWorkspace.name}: ${page.label}`}</button>)}
            {!hasAnyNav && <EmptyState compact title={t('center.noMatch')} />}
          </div>
        </div>
        <nav aria-label={t('center.categories')}>
          {appFiltered.length > 0 && <>
            <span className="settings-nav-caption">{t('center.application')}</span>
            {appFiltered.map(page => renderNavButton(
              page,
              destination.scope === 'application' && destination.page === page.id,
              () => go({ scope: 'application', page: page.id as AppPage }),
              'app-',
              destination.scope !== 'application' ? t('center.application') : undefined,
              appBadge(page.id)
            ))}
          </>}
          {wsFiltered.length > 0 && scopeWorkspace && <>
            <span className="settings-nav-caption settings-nav-caption-sub">{workspaceCaption}</span>
            {wsFiltered.map(page => renderNavButton(
              page,
              destination.scope === 'workspace' && destination.page === page.id,
              () => go({ scope: 'workspace', workspaceId: scopeWorkspace.id, page: page.id as typeof SETTINGS_PAGES[number]['id'] }),
              'ws-',
              destination.scope !== 'workspace' ? workspaceCaption : undefined
            ))}
          </>}
          {!hasAnyNav && <p className="settings-scope">{t('center.noMatch')}</p>}
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
        <div ref={content} role="region" aria-label={t('center.title')} tabIndex={0} className={`settings-center-content${destination.scope === 'workspace' ? ' is-workspace' : ''}`}><ErrorBoundary id="settings-page" component="SettingsCenter" compact label={t('center.title')} onReset={retryPages}><Suspense fallback={<Skeleton lines={6} label={t('center.title')} />}>
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
            : <>
              {destination.page === 'general' ? <GeneralSettings /> : destination.page === 'policy' ? <PolicySettings workspaceId={scopeWorkspace?.id} scope="application" /> : destination.page === 'agent-permissions' ? <AgentPermissionsSettings workspaceId={scopeWorkspace?.id ?? ''} /> : destination.page === 'keyboard' ? <KeyboardSettings /> : destination.page === 'devices' ? <DevicesSettings /> : destination.page === 'privacy' ? <DataSettings /> : <SettingsContent {...props} section={destination.page} onClose={close} />}
              <footer className="settings-auto-apply-note" data-risky-count={RISKY_SETTING_ROWS.length}>{t('center.autoApplyNote')}</footer>
            </>}
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
