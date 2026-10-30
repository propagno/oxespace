import { Suspense, lazy, useEffect, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import { Boxes, Plus, RefreshCw, Settings } from 'lucide-react'
import { NavigationRail, SidebarActions, SidebarFooter, type RailAction } from '../Navigation/NavigationChrome'
import { useUIStore } from '../../store/ui.store'
import { SIDEBAR_MAX_WIDTH, SIDEBAR_MIN_WIDTH, SIDEBAR_RESIZE_STEP, SIDEBAR_WIDTH, useNavigationPrefs } from '../../store/navigation-prefs.store'
import { Splitter } from '../../ui/Splitter'
import { ConnectionList } from './ConnectionList'
import { useOxeQueryCatalog } from './catalog'

const PreferencesDialog = lazy(() => import('./PreferencesDialog').then(module => ({ default: module.PreferencesDialog })))
import { useOxeQueryStore } from './oxequery.store'
import { isDatabaseImage } from './ContainersPanel'
import './OxeQuery.css'

/** Left navigation of the OxeQuery mode: the rail plus containers and saved connections. */
export function OxeQuerySidebar(): ReactElement {
  useOxeQueryCatalog()
  const { t } = useTranslation('oxequery')
  const collapsed = useUIStore(state => state.isSidebarCollapsed)
  // Shares its width with the Thread sidebar: both are the app's left column.
  const width = useNavigationPrefs(state => state.width), setWidth = useNavigationPrefs(state => state.setWidth)
  const toggleCollapse = useUIStore(state => state.toggleSidebar)
  const containers = useOxeQueryStore(state => state.containers)
  const activeTab = useOxeQueryStore(state => state.activeTab)
  const selectedContainer = useOxeQueryStore(state => state.selectedContainer)
  const containersError = useOxeQueryStore(state => state.containersError)

  const settings = useOxeQueryStore(state => state.preferencesOpen)
  const setSettings = useOxeQueryStore(state => state.setPreferencesOpen)
  useEffect(() => { void useOxeQueryStore.getState().refreshConnections() }, [])

  const running = containers.filter(container => container.state === 'running').length
  const listed = [...containers].sort((a, b) => Number(b.state === 'running') - Number(a.state === 'running') || a.name.localeCompare(b.name)).slice(0, 12)

  const railPrimary: RailAction[] = [{ id: 'new-connection', label: t('connections.new'), icon: Plus, onClick: () => useOxeQueryStore.getState().openDialog(null) }]
  const railContext: RailAction = { id: 'refresh', label: t('sidebar.refresh'), ariaLabel: t('sidebar.refresh'), icon: RefreshCw, onClick: () => { void useOxeQueryStore.getState().refreshContainers(); void useOxeQueryStore.getState().refreshConnections() } }
  return <aside className={`thread-navigation oq-sidebar${collapsed ? ' thread-navigation-collapsed' : ''}`} aria-label={t('sidebar.label')}>
    {collapsed && <NavigationRail mode="data" primary={railPrimary} context={railContext} onToggle={toggleCollapse} />}
    {!collapsed && <div className="oq-sidebar-content">
      <header><strong>OxeQuery</strong><SidebarActions actions={railPrimary} /><button type="button" className="oq-icon" data-oq-action="settings" aria-label={t('sidebar.settings')} title={t('sidebar.settings')} onClick={() => setSettings(true)}><Settings size={13} aria-hidden="true" /></button></header>
      <section aria-label={t('view.tab.containers')}>
        <h3>{t('view.tab.containers')}</h3>
        <button type="button" className="oq-nav-item" aria-current={activeTab === 'containers' ? 'page' : undefined} onClick={() => useOxeQueryStore.getState().setActiveTab('containers')}>
          <Boxes size={14} aria-hidden="true" /><span>{t('sidebar.allContainers')}</span><small>{containers.length ? t('sidebar.running', { count: running }) : ''}</small></button>
        {containersError && containers.length === 0 && <p className="oq-muted oq-side-note" title={containersError}>{/permission denied/i.test(containersError) ? t('sidebar.engineRefused') : t('sidebar.noEngine')}</p>}
        {listed.map(container => <button key={container.id} type="button" className="oq-nav-item oq-container-item" title={`${container.name} · ${container.image}
${container.status}`}
          aria-current={activeTab === 'containers' && selectedContainer === container.id ? 'true' : undefined} onClick={() => useOxeQueryStore.getState().selectContainer(container.id)}>
          <i className="oq-dot" data-state={container.state} aria-hidden="true" /><span>{container.name}</span>
          {isDatabaseImage(container.image) && <small className="oq-engine-tag">{/mongo/i.test(container.image) ? 'Mongo' : 'PG'}</small>}</button>)}
        {containers.length > listed.length && <p className="oq-muted oq-side-note">{t('sidebar.more', { count: containers.length - listed.length })}</p>}
      </section>
      <ConnectionList activeTab={activeTab} />
      <SidebarFooter context={railContext} onToggle={toggleCollapse} />
    </div>}
    <Suspense fallback={null}>{settings && <PreferencesDialog onClose={() => setSettings(false)} />}</Suspense>
    {!collapsed && <Splitter orientation="vertical" label={t('sidebar.width')} value={width} min={SIDEBAR_MIN_WIDTH} max={SIDEBAR_MAX_WIDTH} defaultValue={SIDEBAR_WIDTH} step={SIDEBAR_RESIZE_STEP} onChange={setWidth} />}
  </aside>
}
