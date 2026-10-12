import { useEffect, useState, type ReactElement } from 'react'
import { Boxes, Database, Pencil, Plus, RefreshCw, Trash2 } from 'lucide-react'
import { NavigationRail } from '../Navigation/NavigationChrome'
import { useUIStore } from '../../store/ui.store'
import { errorMessage, oq } from './client'
import { useOxeQueryStore } from './oxequery.store'
import { isDatabaseImage } from './ContainersPanel'
import './OxeQuery.css'

/** Left navigation of the OxeQuery mode: the rail plus containers and saved connections. */
export function OxeQuerySidebar({ onSelectMode }: { onSelectMode: (mode: 'code' | 'thread') => void }): ReactElement {
  const collapsed = useUIStore(state => state.isSidebarCollapsed)
  const toggleCollapse = useUIStore(state => state.toggleSidebar)
  const containers = useOxeQueryStore(state => state.containers)
  const connections = useOxeQueryStore(state => state.connections)
  const connectionsError = useOxeQueryStore(state => state.connectionsError)
  const activeTab = useOxeQueryStore(state => state.activeTab)
  const selectedContainer = useOxeQueryStore(state => state.selectedContainer)
  const containersError = useOxeQueryStore(state => state.containersError)
  const [notice, setNotice] = useState('')

  useEffect(() => { void useOxeQueryStore.getState().refreshConnections() }, [])

  const running = containers.filter(container => container.state === 'running').length
  const listed = [...containers].sort((a, b) => Number(b.state === 'running') - Number(a.state === 'running') || a.name.localeCompare(b.name)).slice(0, 12)
  const remove = async (id: string, name: string): Promise<void> => {
    if (!window.confirm(`Delete the connection "${name}"? Its saved password is removed too.`)) return
    try { await oq('connections.delete', { id }); useOxeQueryStore.getState().forgetConnection(id) }
    catch (cause) { setNotice(errorMessage(cause)) }
  }

  return <aside className={`thread-navigation oq-sidebar${collapsed ? ' thread-navigation-collapsed' : ''}`} aria-label="OxeQuery sidebar">
    <NavigationRail mode="data" collapsed={collapsed} onSelectMode={mode => { if (mode !== 'data') onSelectMode(mode) }} onToggle={toggleCollapse}
      primary={[{ id: 'new-connection', label: 'New connection', icon: Plus, onClick: () => useOxeQueryStore.getState().openDialog(null) }]}
      context={{ id: 'refresh', label: 'Refresh containers', ariaLabel: 'Refresh containers', icon: RefreshCw, onClick: () => { void useOxeQueryStore.getState().refreshContainers(); void useOxeQueryStore.getState().refreshConnections() } }} />
    {!collapsed && <div className="oq-sidebar-content">
      <header><strong>OxeQuery</strong></header>
      <section aria-label="Containers">
        <h3>Containers</h3>
        <button type="button" className="oq-nav-item" aria-current={activeTab === 'containers' ? 'page' : undefined} onClick={() => useOxeQueryStore.getState().setActiveTab('containers')}>
          <Boxes size={14} aria-hidden="true" /><span>All containers</span><small>{containers.length ? `${running} running` : ''}</small></button>
        {containersError && containers.length === 0 && <p className="oq-muted oq-side-note">No container engine is reachable yet.</p>}
        {listed.map(container => <button key={container.id} type="button" className="oq-nav-item oq-container-item" title={`${container.name} · ${container.image}
${container.status}`}
          aria-current={activeTab === 'containers' && selectedContainer === container.id ? 'true' : undefined} onClick={() => useOxeQueryStore.getState().selectContainer(container.id)}>
          <i className="oq-dot" data-state={container.state} aria-hidden="true" /><span>{container.name}</span>
          {isDatabaseImage(container.image) && <small className="oq-engine-tag">{/mongo/i.test(container.image) ? 'Mongo' : 'PG'}</small>}</button>)}
        {containers.length > listed.length && <p className="oq-muted oq-side-note">+{containers.length - listed.length} more in All containers</p>}
      </section>
      <section aria-label="Connections">
        <h3>Connections<button type="button" className="oq-icon" aria-label="New connection" title="New connection" onClick={() => useOxeQueryStore.getState().openDialog(null)}><Plus size={14} aria-hidden="true" /></button></h3>
        {connectionsError && <p role="alert" className="oq-error">{connectionsError}</p>}
        {notice && <p role="alert" className="oq-error">{notice}</p>}
        {connections.length === 0 && !connectionsError && <p className="oq-muted">No connections yet. Press <strong>Query</strong> on a database container, or add one with +.</p>}
        {connections.map(connection => <div key={connection.id} className="oq-connection-row">
          <button type="button" className="oq-nav-item" aria-current={activeTab === `connection:${connection.id}` ? 'page' : undefined}
            title={`${connection.engine} · ${connection.host}:${connection.port}`} onClick={() => useOxeQueryStore.getState().openConnection(connection)}>
            <Database size={14} aria-hidden="true" /><span>{connection.name}</span>
            <small className="oq-engine-tag">{connection.engine === 'mongodb' ? 'Mongo' : 'PG'}</small>
            {connection.environment !== 'local' && <small className={connection.environment === 'prod' ? 'oq-prod' : 'oq-env'}>{connection.environment}</small>}</button>
          <button type="button" className="oq-icon" aria-label={`Edit ${connection.name}`} title="Edit" onClick={() => useOxeQueryStore.getState().openDialog(connection)}><Pencil size={12} aria-hidden="true" /></button>
          <button type="button" className="oq-icon" aria-label={`Delete ${connection.name}`} title="Delete" onClick={() => void remove(connection.id, connection.name)}><Trash2 size={12} aria-hidden="true" /></button>
        </div>)}
      </section>
    </div>}
  </aside>
}
