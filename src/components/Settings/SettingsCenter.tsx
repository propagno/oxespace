import { Activity, ArrowLeft, ArrowUpCircle, Bell, Bot, GitBranch, History, Keyboard, KeyRound, Lock, Palette, Settings2, ShieldCheck, Smartphone, SquareTerminal, Wrench, X, type LucideIcon } from 'lucide-react'
import { i18n } from '../../i18n'
import { Suspense, useEffect, useRef, useState, type CSSProperties, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import { ModalRoot, ModalSurface, ModalTitle } from '../../ui/Modal'
import { EmptyState, IconButton, SegmentedControl, SettingRow, SettingsSection as SettingsGroup, Skeleton, TextField } from '../../ui'
import { SettingsPageTitle } from '../../ui/Settings'
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
const GitHubIntegrationSettings = lazyFrom(SETTINGS_CHUNK, module => module.GitHubIntegrationSettings)
const retryPages = (): void => { for (const page of [SettingsContent, WorkspaceSettingsModal, PolicySettings, AgentPermissionsSettings, KeyboardSettings, DevicesSettings, GitHubIntegrationSettings]) page.retry() }

export type AppPage = 'general' | 'appearance' | 'providers' | 'policy' | 'agent-permissions' | 'notifications' | 'keyboard' | 'terminal' | 'mcp' | 'devices' | 'github' | 'privacy' | 'activity' | 'diagnostics' | 'about'
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

/** Every application page, in order. The navigation groups them in the nine sections below (BRD-23). */
export const APPLICATION_SETTINGS_PAGES = [
  appPage('general', Settings2, 'General', 'Navigation, workspace caches and default external editor.', ['editor', 'vscode', 'cursor', 'sites', 'cache']),
  appPage('appearance', Palette, 'Appearance', 'Theme, font sizing and layout density.', ['theme', 'dark', 'light', 'surface', 'oled', 'black', 'white', 'font', 'density', 'language', 'locale']),
  appPage('providers', Bot, 'Agents', 'Default model, fallback chain and provider API keys.', ['claude', 'codex', 'model', 'agent', 'cli', 'idle', 'thinking', 'steer', 'queue', 'paste', 'fold', 'conversation']),
  appPage('policy', ShieldCheck, 'Approvals and safety', 'Safety boundaries, read-only paths and write permissions.', ['approvals', 'safety', 'sandbox', 'rules', 'yaml']),
  appPage('agent-permissions', KeyRound, 'What agents can do', 'Always allowed commands, databases, HTTP hosts and policy rules.', ['permissions', 'commands', 'databases', 'hosts', 'http', 'allowed', 'revoke']),
  appPage('notifications', Bell, 'Notifications', 'Desktop alerts', ['alerts', 'bell', 'desktop']),
  appPage('keyboard', Keyboard, 'Keyboard', 'Keyboard shortcuts and custom chords.', ['shortcuts', 'keybindings', 'chords', 'hotkeys']),
  appPage('terminal', SquareTerminal, 'Terminal', 'Default shell, scrollback buffer and font overrides.', ['shell', 'scrollback', 'cursor', 'powershell', 'bash', 'zsh']),
  appPage('mcp', Wrench, 'MCP servers and skills', 'Connected MCP servers, custom tools and agent skills.', ['mcp', 'tools', 'skills', 'servers', 'oxe.yaml']),
  appPage('devices', Smartphone, 'Phone and devices', 'Linked mobile devices and companion app connections.', ['phone', 'mobile', 'android', 'mirror', 'qr', 'network', 'pairing']),
  appPage('github', GitBranch, 'GitHub', 'GitHub CLI authentication and pull request integration.', ['github', 'gh', 'azure', 'azure devops', 'az', 'auth', 'login', 'git', 'pr', 'pull request']),
  appPage('privacy', Lock, 'Data and privacy', 'Usage count and data export', ['export', 'privacy', 'usage', 'count']),
  appPage('activity', History, 'Agent activity', 'What agents changed through OXESpace, and what you decided.', ['audit', 'outgoing', 'proxy', 'hosts', 'network', 'changes', 'containers']),
  appPage('diagnostics', Activity, 'Diagnostics', 'System health, runtime logs and active background tasks.', ['health', 'logs', 'doctor', 'troubleshooting', 'support']),
  appPage('about', ArrowUpCircle, 'About', 'Version details, release notes and open-source licenses.', ['version', 'updates', 'release', 'changelog', 'licenses'])
] as const

export type AppSectionId = 'general' | 'appearance' | 'agents' | 'notifications' | 'keyboard' | 'terminal' | 'mcp' | 'devices' | 'git' | 'data' | 'about'

function appSection(id: AppSectionId, icon: LucideIcon, pages: readonly AppPage[]) {
  return {
    id,
    icon,
    pages,
    get label() { return ts(`center.sections.${id}.label`) },
    get hint() { return ts(`center.sections.${id}.hint`) }
  }
}

/**
 * Application settings sections, in order (BRD-23 + OXE-431). A section of several pages shows them as a choice above
 * the page; every page keeps its id, so deep links and saved destinations still land.
 */
export const APPLICATION_SETTINGS_SECTIONS = [
  appSection('general', Settings2, ['general']),
  appSection('appearance', Palette, ['appearance']),
  appSection('agents', Bot, ['providers', 'policy', 'agent-permissions']),
  appSection('notifications', Bell, ['notifications']),
  appSection('keyboard', Keyboard, ['keyboard']),
  appSection('terminal', SquareTerminal, ['terminal']),
  appSection('mcp', Wrench, ['mcp']),
  appSection('devices', Smartphone, ['devices']),
  appSection('git', GitBranch, ['github']),
  appSection('data', Activity, ['privacy', 'activity', 'diagnostics']),
  appSection('about', ArrowUpCircle, ['about'])
] as const
type AppSection = typeof APPLICATION_SETTINGS_SECTIONS[number]

const appPageOf = (id: AppPage): Page => APPLICATION_SETTINGS_PAGES.find(page => page.id === id) ?? APPLICATION_SETTINGS_PAGES[0]

/** The section a page belongs to. */
export function sectionOfPage(page: AppPage): AppSection {
  return APPLICATION_SETTINGS_SECTIONS.find(section => (section.pages as readonly AppPage[]).includes(page)) ?? APPLICATION_SETTINGS_SECTIONS[0]
}

function matchesPage(page: Page, query: string): boolean {
  const needle = query.trim().toLowerCase()
  if (!needle) return true
  return `${page.label} ${page.hint ?? ''} ${(page.keywords ?? []).join(' ')}`.toLowerCase().includes(needle)
}

function matchesSection(section: AppSection, query: string): boolean {
  return matchesPage(section, query) || section.pages.some(id => matchesPage(appPageOf(id), query))
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
  if (page === 'git') return 'github'
  if (page === 'skills') return 'mcp'
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

type Scope = 'app' | 'workspace'

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
  // The application page to return to when the scope goes back to App.
  const lastAppPage = useRef<AppPage>(destination.scope === 'application' ? destination.page : 'general')
  // Ctrl+F (Cmd+F) reaches the search from anywhere in Settings; the field says so to assistive technology. Set when
  // the field mounts: the dialog draws its content after the first effects run.
  const searchRef = (input: HTMLInputElement | null): void => {
    search.current = input
    input?.setAttribute('aria-keyshortcuts', 'Control+F Meta+F')
  }
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
      const page = resolveAppPage(requestedPage)
      lastAppPage.current = page
      setDestination({ scope: 'application', page })
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
    if (next.scope === 'application') lastAppPage.current = next.page
    setDestination(next)
    try { localStorage.setItem('oxe.settings.destination', JSON.stringify(next)) } catch { /* Preferences are optional. */ }
  }
  const close = (): void => props.onClose()
  const isMcpPanelOpen = useUIStore(state => state.isMcpPanelOpen)
  const mcpCount = useMcpStore(selectMcpServers(scopeWorkspace?.id ?? activeWorkspaceId)).length
  const activityCount = useActivityStore(state => state.items.length)
  const readyAgentsCount = (props.agentReadiness ?? []).filter(r => r.status === 'ready' || r.status === 'partial').length
  const appBadge = (id: string): number => (id === 'providers' ? readyAgentsCount : id === 'mcp' ? mcpCount : id === 'activity' ? activityCount : 0)
  const sectionBadge = (section: AppSection): number => section.pages.reduce((sum, id) => sum + appBadge(id), 0)
  const scope: Scope = destination.scope === 'workspace' && scopeWorkspace ? 'workspace' : 'app'
  const chooseScope = (next: Scope): void => {
    if (next === scope) return
    if (next === 'workspace' && scopeWorkspace) go({ scope: 'workspace', workspaceId: scopeWorkspace.id, page: 'general' })
    else go({ scope: 'application', page: lastAppPage.current })
  }
  const currentSection = destination.scope === 'application' ? sectionOfPage(destination.page) : undefined
  type Entry = { key: string; entry: NavEntry; current: boolean; onSelect: () => void; badge: number }
  const entries: Entry[] = scope === 'workspace' && scopeWorkspace
    ? SETTINGS_PAGES.filter(p => matchesPage(p, query)).map(page => ({
      key: `ws-${page.id}`,
      entry: { id: page.id, label: page.label, hint: page.hint, icon: page.icon },
      current: destination.scope === 'workspace' && destination.page === page.id,
      onSelect: () => go({ scope: 'workspace', workspaceId: scopeWorkspace.id, page: page.id }),
      badge: 0
    }))
    : APPLICATION_SETTINGS_SECTIONS.filter(section => matchesSection(section, query)).map(section => ({
      key: `app-${section.id}`,
      entry: { id: section.id, label: section.label, hint: section.hint, icon: section.icon },
      current: currentSection?.id === section.id,
      onSelect: () => { if (currentSection?.id !== section.id) go({ scope: 'application', page: section.pages[0] }) },
      badge: sectionBadge(section)
    }))
  const caption = scope === 'workspace' && scopeWorkspace ? t('center.workspaceNamed', { name: scopeWorkspace.name }) : t('center.application')
  const renderNavButton = ({ key, entry: { icon: Icon, ...page }, current, onSelect, badge }: Entry): ReactElement => (
    <button
      key={key}
      title={page.hint}
      aria-label={`${page.label}${badge > 0 ? ` (${badge})` : ''} ${page.hint ?? ''}`}
      aria-current={current ? 'page' : undefined}
      onClick={onSelect}
    >
      <Icon size={16} aria-hidden="true" /><span>{page.label}</span>
      {/* Drawn from the attribute, so the button's text is its name: as text, "MCP servers and skills3" was not in
          the accessible name and a voice user could not say what they read (label-content-name-mismatch). */}
      {badge > 0 ? <small className="settings-nav-badge" aria-hidden="true" data-count={badge} /> : null}
    </button>
  )

  const hasChildDialogOpen = (): boolean => {
    if (useUIStore.getState().isMcpPanelOpen) return true
    const surface = document.querySelector<HTMLElement>('.settings-center[role="dialog"]')
    const dialogs = Array.from(document.querySelectorAll<HTMLElement>('[role="dialog"]'))
    return surface
      ? dialogs.some(d => d !== surface && (surface.contains(d) || Boolean(surface.compareDocumentPosition(d) & Node.DOCUMENT_POSITION_FOLLOWING)))
      : dialogs.length > 1
  }

  return <ModalRoot open modal={!isMcpPanelOpen} onOpenChange={open => { if (!open && !hasChildDialogOpen()) close() }}>
    <ModalSurface className="settings-center" style={{ '--settings-navigation-width': `${navigationWidth}px` } as CSSProperties} scrimClassName="settings-center-overlay" toasts aria-describedby={undefined}
      onEscapeKeyDown={event => {
        if (hasChildDialogOpen()) {
          event.preventDefault()
          ;(event as KeyboardEvent & { __oxeDeferredToChild?: boolean }).__oxeDeferredToChild = true
        }
      }}
      onCloseAutoFocus={event => {
        // Opened from a control (the gear, a menu): back to it. Opened from the keyboard inside a terminal: back to the pane.
        if (opener && !opener.closest('[data-testid="pane-container"]')) { event.preventDefault(); requestAnimationFrame(() => { if (opener.isConnected) opener.focus({ preventScroll: true }) }) }
        else if (returnPane.current) { event.preventDefault(); requestAnimationFrame(() => window.dispatchEvent(new CustomEvent('oxe:focus-pane', { detail: { paneId: returnPane.current } }))) }
      }}
      onPointerDownOutside={event => event.preventDefault()}>
      <aside className="settings-center-nav">
        <ModalTitle className="settings-center-title"><Settings2 size={16} />{t('center.title')}</ModalTitle>
        {scopeWorkspace ? <div className="settings-scope-select" data-ui="settings-scope">
          <SegmentedControl<Scope> label={t('center.scope')} value={scope} onChange={chooseScope}
            options={[{ value: 'app', label: t('center.scopeApp') }, { value: 'workspace', label: scopeWorkspace.name }]} />
        </div> : null}
        <SearchField className="settings-search" ref={searchRef} label={t('center.searchLabel')} placeholder={t('center.searchPlaceholder')} value={query} onChange={setQuery} shortcut="Ctrl F" />
        <div className="settings-scope settings-compact-category"><span>{t('center.category')}</span>
          <div className="settings-category-choices" role="group" aria-label={t('center.categoryGroup')}>
            {entries.map(item => <button type="button" key={item.key} aria-pressed={item.current} onClick={item.onSelect}>{item.entry.label}</button>)}
            {entries.length === 0 && <EmptyState compact title={t('center.noMatch')} />}
          </div>
        </div>
        <nav aria-label={t('center.categories')}>
          {entries.length > 0 && <>
            <span className="settings-nav-caption">{caption}</span>
            {entries.map(renderNavButton)}
          </>}
          {entries.length === 0 && <p className="settings-scope">{t('center.noMatch')}</p>}
        </nav>
        <div className="settings-nav-footer">
          <button className="settings-back" onClick={close}><ArrowLeft size={14} />{t('center.backToWork')}</button>
        </div>
      </aside>
      <main className="settings-center-main">
        <header className="settings-center-toolbar">
          <IconButton variant="ghost" className="settings-center-close" label={t('center.close')} title={t('center.closeTitle')} icon={<X size={16} aria-hidden="true" />} onClick={close} />
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
            : <section className="settings-general" data-ui="settings-page"><SettingsPageTitle>{t('center.workspaceClosed')}</SettingsPageTitle><p>{t('center.workspaceClosedHint')}</p></section>
            : <>
              {currentSection && currentSection.pages.length > 1 ? <div className="settings-section-pages">
                <SegmentedControl<AppPage> label={t('center.sectionPages')} value={destination.page} onChange={page => go({ scope: 'application', page })}
                  options={currentSection.pages.map(id => ({ value: id, label: appPageOf(id).label }))} />
              </div> : null}
              {destination.page === 'general' ? <GeneralSettings /> : destination.page === 'policy' ? <PolicySettings workspaceId={scopeWorkspace?.id} scope="application" /> : destination.page === 'agent-permissions' ? <AgentPermissionsSettings workspaceId={scopeWorkspace?.id ?? ''} /> : destination.page === 'keyboard' ? <KeyboardSettings /> : destination.page === 'devices' ? <DevicesSettings /> : destination.page === 'github' ? <GitHubIntegrationSettings /> : destination.page === 'privacy' ? <DataSettings /> : <SettingsContent {...props} section={destination.page as SettingsSection} onClose={close} />}
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
  // BRD-06: every option is a SettingRow inside a SettingsSection (the single mould); no hand-made cards.
  return <section className="settings-general" data-ui="settings-page"><SettingsPageTitle>{t('general.title')}</SettingsPageTitle><p>{t('general.description')}</p>
    <SettingsGroup title={t('general.navigation')}>
      <SettingRow htmlFor="workspace-cache-cap" label={t('general.cacheLabel')} description={t('general.cacheHint')}
        control={<TextField id="workspace-cache-cap" className="settings-general-cap" type="number" min={VISITED_WORKSPACES_CAP_MIN} max={VISITED_WORKSPACES_CAP_MAX} value={cap} onChange={e => { const value = e.currentTarget.valueAsNumber; if (Number.isFinite(value)) setCap(value) }} />} />
      <ExternalEditorSetting />
    </SettingsGroup>
    <SeenSitesSetting /></section>
}
