import { Suspense, lazy, useEffect, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import { Plus, RefreshCw, Settings, ShieldCheck } from 'lucide-react'
import { NavigationRail, SidebarActions, SidebarFooter, type RailAction } from '../Navigation/NavigationChrome'
import { useUIStore } from '../../store/ui.store'
import { SIDEBAR_MAX_WIDTH, SIDEBAR_MIN_WIDTH, SIDEBAR_RESIZE_STEP, SIDEBAR_WIDTH, useNavigationPrefs } from '../../store/navigation-prefs.store'
import { Splitter } from '../../ui/Splitter'
import { ConnectionList } from './ConnectionList'
import { useOxeQueryCatalog } from './catalog'
import { useOxeQueryStore } from './oxequery.store'
import './OxeQuery.css'

const PreferencesDialog = lazy(() => import('./PreferencesDialog').then(module => ({ default: module.PreferencesDialog })))

/** Left navigation of the OxeQuery mode: the rail plus the saved connections. Containers live in OxePod. */
export function OxeQuerySidebar(): ReactElement {
  useOxeQueryCatalog()
  const { t } = useTranslation('oxequery')
  const collapsed = useUIStore(state => state.isSidebarCollapsed)
  // Shares its width with the Thread sidebar: both are the app's left column.
  const width = useNavigationPrefs(state => state.width), setWidth = useNavigationPrefs(state => state.setWidth)
  const toggleCollapse = useUIStore(state => state.toggleSidebar)
  const activeTab = useOxeQueryStore(state => state.activeTab)
  const settings = useOxeQueryStore(state => state.preferencesOpen)
  const setSettings = useOxeQueryStore(state => state.setPreferencesOpen)
  useEffect(() => { void useOxeQueryStore.getState().refreshConnections() }, [])

  const railPrimary: RailAction[] = [{ id: 'new-connection', label: t('connections.new'), icon: Plus, onClick: () => useOxeQueryStore.getState().openDialog(null) }]
  const railContext: RailAction = { id: 'refresh', label: t('sidebar.refresh'), ariaLabel: t('sidebar.refresh'), icon: RefreshCw, onClick: () => { void useOxeQueryStore.getState().refreshConnections() } }
  return <aside className={`thread-navigation oq-sidebar${collapsed ? ' thread-navigation-collapsed' : ''}`} aria-label={t('sidebar.label')}>
    {collapsed && <NavigationRail mode="data" primary={railPrimary} context={railContext} onToggle={toggleCollapse} />}
    {!collapsed && <div className="oq-sidebar-content">
      <header><strong>OxeQuery</strong><SidebarActions actions={railPrimary} /><button type="button" className="oq-icon" data-oq-action="settings" aria-label={t('sidebar.settings')} title={t('sidebar.settings')} onClick={() => setSettings(true)}><Settings size={13} aria-hidden="true" /></button></header>
      <ConnectionList activeTab={activeTab} />
      <button type="button" className="oq-nav-item" aria-current={activeTab === 'activity' ? 'page' : undefined} onClick={() => useOxeQueryStore.getState().openActivity()}>
        <ShieldCheck size={14} aria-hidden="true" /><span>{t('activity.label')}</span></button>
      <SidebarFooter context={railContext} onToggle={toggleCollapse} />
    </div>}
    <Suspense fallback={null}>{settings && <PreferencesDialog onClose={() => setSettings(false)} />}</Suspense>
    {!collapsed && <Splitter orientation="vertical" label={t('sidebar.width')} value={width} min={SIDEBAR_MIN_WIDTH} max={SIDEBAR_MAX_WIDTH} defaultValue={SIDEBAR_WIDTH} step={SIDEBAR_RESIZE_STEP} onChange={setWidth} />}
  </aside>
}
