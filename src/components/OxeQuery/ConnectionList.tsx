import { useMemo, useState, type ReactElement } from 'react'
import { ChevronDown, ChevronRight, Copy, Database, Download, Pencil, Plus, Search, Star, Trash2, Upload } from 'lucide-react'
import type { OxeQueryConnection } from '../../../shared/types/oxequery'
import { errorMessage, oq } from './client'
import { organize } from './connection-list-model'
import { useOxeQueryStore } from './oxequery.store'

/** The saved connections: favorites, recent, groups, search, and the actions on one connection. */
export function ConnectionList({ activeTab }: { activeTab: string }): ReactElement {
  const connections = useOxeQueryStore(state => state.connections)
  const connectionsError = useOxeQueryStore(state => state.connectionsError)
  const [search, setSearch] = useState('')
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set())
  const [notice, setNotice] = useState('')
  const [pendingDelete, setPendingDelete] = useState<{ id: string; name: string; ephemeral: boolean } | null>(null)
  const sections = useMemo(() => organize(connections, search), [connections, search])
  const store = useOxeQueryStore.getState

  const run = async (action: () => Promise<unknown>): Promise<void> => {
    setNotice('')
    try { await action(); await store().refreshConnections() } catch (cause) { setNotice(errorMessage(cause)) }
  }
  const remove = async (id: string): Promise<void> => {
    setPendingDelete(null)
    try { await oq('connections.delete', { id }); store().forgetConnection(id) } catch (cause) { setNotice(errorMessage(cause)) }
  }
  const toggleSection = (id: string): void => setCollapsed(current => { const next = new Set(current); if (next.has(id)) next.delete(id); else next.add(id); return next })

  const row = (connection: OxeQueryConnection, section: string): ReactElement => <div key={`${section}:${connection.id}`} className="oq-connection-row">
    <button type="button" className="oq-nav-item" aria-current={activeTab === `connection:${connection.id}` ? 'page' : undefined}
      title={`${connection.engine} · ${connection.host}:${connection.port}${connection.ephemeral ? ' · not saved' : ''}`} onClick={() => store().openConnection(connection)}>
      {connection.color ? <i className="oq-color-dot" data-color={connection.color} aria-hidden="true" /> : <Database size={14} aria-hidden="true" />}
      <span>{connection.name}</span>
      <small className="oq-engine-tag">{connection.engine === 'mongodb' ? 'Mongo' : 'PG'}</small>
      {connection.environment !== 'local' && <small className={connection.environment === 'prod' ? 'oq-prod' : 'oq-env'}>{connection.environment}</small>}</button>
    {!connection.ephemeral && <>
      <button type="button" className="oq-icon" aria-pressed={connection.favorite} aria-label={`${connection.favorite ? 'Unfavorite' : 'Favorite'} ${connection.name}`} title={connection.favorite ? 'Remove from favorites' : 'Add to favorites'}
        data-on={connection.favorite || undefined} onClick={() => void run(() => oq('connections.update', { id: connection.id, favorite: !connection.favorite }))}><Star size={12} aria-hidden="true" /></button>
      <button type="button" className="oq-icon" aria-label={`Edit ${connection.name}`} title="Edit" onClick={() => store().openDialog(connection)}><Pencil size={12} aria-hidden="true" /></button>
      <button type="button" className="oq-icon" aria-label={`Duplicate ${connection.name}`} title="Duplicate" onClick={() => void run(() => oq('connections.duplicate', { id: connection.id }))}><Copy size={12} aria-hidden="true" /></button>
    </>}
    <button type="button" className="oq-icon" aria-label={`${connection.ephemeral ? 'Close' : 'Delete'} ${connection.name}`} title={connection.ephemeral ? 'Close' : 'Delete'}
      onClick={() => connection.ephemeral ? void remove(connection.id) : setPendingDelete({ id: connection.id, name: connection.name, ephemeral: false })}><Trash2 size={12} aria-hidden="true" /></button>
  </div>

  return <section aria-label="Connections">
    <h3>Connections<span className="oq-h3-actions">
      <button type="button" className="oq-icon" aria-label="Import connections" title="Import connections from a file" onClick={() => void run(async () => {
        const result = await oq('connections.import', {})
        if (result.imported || result.skipped) setNotice(`${result.imported} imported${result.skipped ? `, ${result.skipped} skipped (a tunnel with a key or password cannot be imported)` : ''}.`)
      })}><Upload size={13} aria-hidden="true" /></button>
      <button type="button" className="oq-icon" aria-label="Export connections" title="Export connections to a file (no passwords)" disabled={connections.length === 0}
        onClick={() => void run(async () => { const result = await oq('connections.export', {}); if (result.saved) setNotice(`${result.count} exported without passwords or keys.`) })}><Download size={13} aria-hidden="true" /></button>
      <button type="button" className="oq-icon" aria-label="New connection" title="New connection" onClick={() => store().openDialog(null)}><Plus size={14} aria-hidden="true" /></button></span></h3>
    {connections.length > 4 && <label className="oq-conn-search"><Search size={12} aria-hidden="true" /><input type="search" aria-label="Search connections" placeholder="Search connections" value={search} onChange={event => setSearch(event.target.value)} /></label>}
    {connectionsError && <p role="alert" className="oq-error">{connectionsError}</p>}
    {notice && <p role="status" className="oq-muted">{notice}</p>}
    {pendingDelete && <div className="oq-confirm" role="alertdialog" aria-label="Confirm delete connection" onKeyDown={event => { if (event.key === 'Escape') setPendingDelete(null) }}>
      <strong>Delete “{pendingDelete.name}”?</strong>
      <p>Its saved password, keys and certificates are removed too. The database itself is not touched.</p>
      <div><button type="button" autoFocus onClick={() => setPendingDelete(null)}>Cancel</button>
        <button type="button" className="oq-danger" onClick={() => void remove(pendingDelete.id)}>Delete</button></div>
    </div>}
    {connections.length === 0 && !connectionsError && <p className="oq-muted">No connections yet. Press <strong>Query</strong> on a database container, or add one with +.</p>}
    {search.trim() && sections.length === 0 && <p className="oq-muted" role="status">Nothing matches “{search.trim()}”.</p>}
    {sections.map(section => {
      const headed = sections.length > 1 || section.id === 'results' || section.id.startsWith('group:')
      const open = !collapsed.has(section.id)
      return <div key={section.id} className="oq-conn-section" data-section={section.id}>
        {headed && <button type="button" className="oq-conn-heading" aria-expanded={open} onClick={() => toggleSection(section.id)}>
          {open ? <ChevronDown size={12} aria-hidden="true" /> : <ChevronRight size={12} aria-hidden="true" />}{section.title}<small>{section.connections.length}</small></button>}
        {(open || !headed) && section.connections.map(connection => row(connection, section.id))}
      </div>
    })}
  </section>
}
