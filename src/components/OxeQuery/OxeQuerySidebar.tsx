import { Suspense, lazy, useEffect, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import { Plus, RefreshCw, Settings, ShieldCheck } from 'lucide-react'
import { NavigationRail, RailItems, SidebarFooterBar, SidebarHeaderActions, type RailAction } from '../Navigation/NavigationChrome'
import { useUIStore } from '../../store/ui.store'
import { SIDEBAR_MAX_WIDTH, SIDEBAR_MIN_WIDTH, SIDEBAR_RESIZE_STEP, SIDEBAR_WIDTH, useNavigationPrefs } from '../../store/navigation-prefs.store'
import { IconButton, SidebarHeader, SidebarRow, Splitter } from '../../ui'
import { ConnectionList } from './ConnectionList'
import { useOxeQueryCatalog } from './catalog'
import { useOxeQueryStore } from './oxequery.store'
import './OxeQuery.css'

const PreferencesDialog = lazy(() => import('./PreferencesDialog').then(module => ({ default: module.PreferencesDialog })))

/** Left navigation of the OxeQuery mode: the rail plus the saved connections. Containers live in OxePod. */
export function OxeQuerySidebar(): ReactElement {
  useOxeQueryCatalog()
  const { t } = useTranslation('oxequery')
  const collapsed = useUIStore(state => state.oxequerySidebarCollapsed)
  // Shares its width with the Thread sidebar: both are the app's left column.
  const width = useNavigationPrefs(state => state.width), setWidth = useNavigationPrefs(state => state.setWidth)
  const toggleCollapse = useUIStore(state => state.toggleOxeQuerySidebar)
  const activeTab = useOxeQueryStore(state => state.activeTab)
  const connections = useOxeQueryStore(state => state.connections)
  const settings = useOxeQueryStore(state => state.preferencesOpen)
  const setSettings = useOxeQueryStore(state => state.setPreferencesOpen)
  useEffect(() => { void useOxeQueryStore.getState().refreshConnections() }, [])

  const activeConnection = activeTab.startsWith('connection:')
    ? connections.find(connection => `connection:${connection.id}` === activeTab)
    : connections[0]

  const railPrimary: RailAction[] = [{ id: 'new-connection', label: t('connections.new'), icon: Plus, onClick: () => useOxeQueryStore.getState().openDialog(null) }]
  const railContext: RailAction = { id: 'refresh', label: t('sidebar.refresh'), ariaLabel: t('sidebar.refresh'), icon: RefreshCw, onClick: () => { void useOxeQueryStore.getState().refreshConnections() } }
  return <aside className={`thread-navigation oq-sidebar${collapsed ? ' thread-navigation-collapsed' : ''}`} aria-label={t('sidebar.label')}>
    {collapsed && <NavigationRail mode="data" primary={railPrimary} context={railContext} onToggle={toggleCollapse}>
      <RailItems label={t('connections.title')} items={connections.map(connection => ({ id: connection.id, label: connection.name, current: activeTab === `connection:${connection.id}`,
        onSelect: () => useOxeQueryStore.getState().openConnection(connection) }))} />
    </NavigationRail>}
    {!collapsed && <div className="oq-sidebar-content">
      <header className="oq-sidebar-header">
        <SidebarHeader
          title="OxeQuery"
          actions={<>
            <SidebarHeaderActions actions={railPrimary} />
            <IconButton
              size="sm"
              data-oq-action="settings"
              label={t('sidebar.settings')}
              title={t('sidebar.settings')}
              icon={<Settings size={14} aria-hidden="true" />}
              onClick={() => setSettings(true)}
            />
          </>}
        />
      </header>
      <div className="oq-sidebar-body">
        {activeConnection && <div className="oq-active-conn" data-testid="oq-active-connection">
          <div className="oq-active-conn-top">
            <span className="oq-status-dot" data-env={activeConnection.environment} aria-hidden="true" />
            <strong className="oq-active-conn-name">{activeConnection.name}</strong>
          </div>
          <div className="oq-active-conn-sub">
            <span>{activeConnection.engine} · {activeConnection.host}:{activeConnection.port}{activeConnection.database ? `/${activeConnection.database}` : ''}</span>
          </div>
        </div>}
        <ConnectionList activeTab={activeTab} />
        <SidebarRow
          className="oq-activity-row"
          selected={activeTab === 'activity'}
          lead={<ShieldCheck size={14} aria-hidden="true" />}
          title={t('activity.label')}
          onSelect={() => useOxeQueryStore.getState().openActivity()}
        />
      </div>
      <SidebarFooterBar context={railContext} onToggle={toggleCollapse} />
    </div>}
    <Suspense fallback={null}>{settings && <PreferencesDialog onClose={() => setSettings(false)} />}</Suspense>
    {!collapsed && <Splitter orientation="vertical" label={t('sidebar.width')} value={width} min={SIDEBAR_MIN_WIDTH} max={SIDEBAR_MAX_WIDTH} defaultValue={SIDEBAR_WIDTH} step={SIDEBAR_RESIZE_STEP} onChange={setWidth} />}
  </aside>
}
