import { Suspense, lazy, useEffect, useState, type ReactElement } from 'react'
import { Boxes, Plus, RefreshCw, Settings } from 'lucide-react'
import { NavigationRail } from '../Navigation/NavigationChrome'
import { useUIStore } from '../../store/ui.store'
import { SIDEBAR_MAX_WIDTH, SIDEBAR_MIN_WIDTH, SIDEBAR_RESIZE_STEP, SIDEBAR_WIDTH, useNavigationPrefs } from '../../store/navigation-prefs.store'
import { Splitter } from '../../ui/Splitter'
import { ConnectionList } from './ConnectionList'

const PreferencesDialog = lazy(() => import('./PreferencesDialog').then(module => ({ default: module.PreferencesDialog })))
import { useOxeQueryStore } from './oxequery.store'
import { isDatabaseImage } from './ContainersPanel'
import './OxeQuery.css'

/** Left navigation of the OxeQuery mode: the rail plus containers and saved connections. */
export function OxeQuerySidebar({ onSelectMode }: { onSelectMode: (mode: 'code' | 'thread') => void }): ReactElement {
  const collapsed = useUIStore(state => state.isSidebarCollapsed)
  // Shares its width with the Thread sidebar: both are the app's left column.
  const width = useNavigationPrefs(state => state.width), setWidth = useNavigationPrefs(state => state.setWidth)
  const toggleCollapse = useUIStore(state => state.toggleSidebar)
  const containers = useOxeQueryStore(state => state.containers)
  const activeTab = useOxeQueryStore(state => state.activeTab)
  const selectedContainer = useOxeQueryStore(state => state.selectedContainer)
  const containersError = useOxeQueryStore(state => state.containersError)

  const [settings, setSettings] = useState(false)
  useEffect(() => { void useOxeQueryStore.getState().refreshConnections() }, [])

  const running = containers.filter(container => container.state === 'running').length
  const listed = [...containers].sort((a, b) => Number(b.state === 'running') - Number(a.state === 'running') || a.name.localeCompare(b.name)).slice(0, 12)

  return <aside className={`thread-navigation oq-sidebar${collapsed ? ' thread-navigation-collapsed' : ''}`} aria-label="OxeQuery sidebar">
    <NavigationRail mode="data" collapsed={collapsed} onSelectMode={mode => { if (mode !== 'data') onSelectMode(mode) }} onToggle={toggleCollapse}
      primary={[{ id: 'new-connection', label: 'New connection', icon: Plus, onClick: () => useOxeQueryStore.getState().openDialog(null) }]}
      context={{ id: 'refresh', label: 'Refresh containers', ariaLabel: 'Refresh containers', icon: RefreshCw, onClick: () => { void useOxeQueryStore.getState().refreshContainers(); void useOxeQueryStore.getState().refreshConnections() } }} />
    {!collapsed && <div className="oq-sidebar-content">
      <header><strong>OxeQuery</strong><button type="button" className="oq-icon" aria-label="OxeQuery settings" title="Settings" onClick={() => setSettings(true)}><Settings size={13} aria-hidden="true" /></button></header>
      <section aria-label="Containers">
        <h3>Containers</h3>
        <button type="button" className="oq-nav-item" aria-current={activeTab === 'containers' ? 'page' : undefined} onClick={() => useOxeQueryStore.getState().setActiveTab('containers')}>
          <Boxes size={14} aria-hidden="true" /><span>All containers</span><small>{containers.length ? `${running} running` : ''}</small></button>
        {containersError && containers.length === 0 && <p className="oq-muted oq-side-note" title={containersError}>{/permission denied/i.test(containersError) ? 'The container engine refused access. Open All containers for the fix.' : 'No container engine is reachable yet.'}</p>}
        {listed.map(container => <button key={container.id} type="button" className="oq-nav-item oq-container-item" title={`${container.name} · ${container.image}
${container.status}`}
          aria-current={activeTab === 'containers' && selectedContainer === container.id ? 'true' : undefined} onClick={() => useOxeQueryStore.getState().selectContainer(container.id)}>
          <i className="oq-dot" data-state={container.state} aria-hidden="true" /><span>{container.name}</span>
          {isDatabaseImage(container.image) && <small className="oq-engine-tag">{/mongo/i.test(container.image) ? 'Mongo' : 'PG'}</small>}</button>)}
        {containers.length > listed.length && <p className="oq-muted oq-side-note">+{containers.length - listed.length} more in All containers</p>}
      </section>
      <ConnectionList activeTab={activeTab} />
    </div>}
    <Suspense fallback={null}>{settings && <PreferencesDialog onClose={() => setSettings(false)} />}</Suspense>
    {!collapsed && <Splitter orientation="vertical" label="OxeQuery sidebar width" value={width} min={SIDEBAR_MIN_WIDTH} max={SIDEBAR_MAX_WIDTH} defaultValue={SIDEBAR_WIDTH} step={SIDEBAR_RESIZE_STEP} onChange={setWidth} />}
  </aside>
}
