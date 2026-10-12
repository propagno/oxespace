import { useEffect, useState, type ReactElement } from 'react'
import { Boxes, Database, Pencil, Plus, RefreshCw, Trash2 } from 'lucide-react'
import { NavigationRail } from '../Navigation/NavigationChrome'
import { useUIStore } from '../../store/ui.store'
import { errorMessage, oq } from './client'
import { useOxeQueryStore } from './oxequery.store'
import './OxeQuery.css'

/** Left navigation of the OxeQuery mode: the rail plus containers and saved connections. */
export function OxeQuerySidebar({ onSelectMode }: { onSelectMode: (mode: 'code' | 'thread') => void }): ReactElement {
  const collapsed = useUIStore(state => state.isSidebarCollapsed)
  const toggleCollapse = useUIStore(state => state.toggleSidebar)
  const containers = useOxeQueryStore(state => state.containers)
  const connections = useOxeQueryStore(state => state.connections)
  const connectionsError = useOxeQueryStore(state => state.connectionsError)
  const activeTab = useOxeQueryStore(state => state.activeTab)
  const [notice, setNotice] = useState('')

  useEffect(() => { void useOxeQueryStore.getState().refreshConnections() }, [])

  const running = containers.filter(container => container.state === 'running').length
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
          <Boxes size={14} aria-hidden="true" /><span>All containers</span><small>{containers.length ? `${running}/${containers.length}` : ''}</small></button>
      </section>
      <section aria-label="Connections">
        <h3>Connections<button type="button" className="oq-icon" aria-label="New connection" title="New connection" onClick={() => useOxeQueryStore.getState().openDialog(null)}><Plus size={14} aria-hidden="true" /></button></h3>
        {connectionsError && <p role="alert" className="oq-error">{connectionsError}</p>}
        {notice && <p role="alert" className="oq-error">{notice}</p>}
        {connections.length === 0 && !connectionsError && <p className="oq-muted">No connections yet. Add one, or press the database button on a Postgres or MongoDB container.</p>}
        {connections.map(connection => <div key={connection.id} className="oq-connection-row">
          <button type="button" className="oq-nav-item" aria-current={activeTab === `connection:${connection.id}` ? 'page' : undefined}
            title={`${connection.engine} · ${connection.host}:${connection.port}`} onClick={() => useOxeQueryStore.getState().openConnection(connection)}>
            <Database size={14} aria-hidden="true" /><span>{connection.name}</span>
            {connection.environment === 'prod' && <small className="oq-prod">prod</small>}</button>
          <button type="button" className="oq-icon" aria-label={`Edit ${connection.name}`} title="Edit" onClick={() => useOxeQueryStore.getState().openDialog(connection)}><Pencil size={12} aria-hidden="true" /></button>
          <button type="button" className="oq-icon" aria-label={`Delete ${connection.name}`} title="Delete" onClick={() => void remove(connection.id, connection.name)}><Trash2 size={12} aria-hidden="true" /></button>
        </div>)}
      </section>
    </div>}
  </aside>
}
