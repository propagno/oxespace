import { useMemo, useState, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronDown, ChevronRight, Copy, Database, Download, Pencil, Plus, Search, Star, Trash2, Upload } from 'lucide-react'
import type { OxeQueryConnection } from '../../../shared/types/oxequery'
import { errorMessage, oq } from './client'
import { organize } from './connection-list-model'
import { useOxeQueryStore } from './oxequery.store'
import { ConfirmDialog } from '../../ui/ConfirmDialog'
import { Button } from '../../ui/Button'
import { EmptyState, ErrorState } from '../../ui/Display'
import { exportConnections, importConnections } from './connection-transfer'

/** The saved connections: favorites, recent, groups, search, and the actions on one connection. */
export function ConnectionList({ activeTab }: { activeTab: string }): ReactElement {
  const { t } = useTranslation('oxequery')
  const connections = useOxeQueryStore(state => state.connections)
  const connectionsError = useOxeQueryStore(state => state.connectionsError)
  const [search, setSearch] = useState('')
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set())
  const [failure, setFailure] = useState('')
  const [pendingDelete, setPendingDelete] = useState<{ id: string; name: string; ephemeral: boolean } | null>(null)
  const sections = useMemo(() => organize(connections, search), [connections, search])
  const store = useOxeQueryStore.getState

  const run = async (action: () => Promise<unknown>): Promise<void> => {
    setFailure('')
    try { await action(); await store().refreshConnections() } catch (cause) { setFailure(errorMessage(cause)) }
  }
  const remove = async (id: string): Promise<void> => {
    setPendingDelete(null)
    try { await oq('connections.delete', { id }); store().forgetConnection(id) } catch (cause) { setFailure(errorMessage(cause)) }
  }
  const toggleSection = (id: string): void => setCollapsed(current => { const next = new Set(current); if (next.has(id)) next.delete(id); else next.add(id); return next })

  const row = (connection: OxeQueryConnection, section: string): ReactElement => <div key={`${section}:${connection.id}`} className="oq-connection-row">
    <button type="button" className="oq-nav-item" aria-current={activeTab === `connection:${connection.id}` ? 'page' : undefined}
      title={`${connection.engine} · ${connection.host}:${connection.port}${connection.ephemeral ? ` · ${t('connections.notSaved')}` : ''}`} onClick={() => store().openConnection(connection)}>
      {connection.color ? <i className="oq-color-dot" data-color={connection.color} aria-hidden="true" /> : <Database size={14} aria-hidden="true" />}
      <span>{connection.name}</span>
      <small className="oq-engine-tag">{connection.engine === 'mongodb' ? 'Mongo' : 'PG'}</small>
      {connection.environment !== 'local' && <small className={connection.environment === 'prod' ? 'oq-prod' : 'oq-env'}>{t(`environment.short.${connection.environment}`)}</small>}</button>
    {!connection.ephemeral && <>
      <button type="button" className="oq-icon" aria-pressed={connection.favorite} aria-label={t(connection.favorite ? 'connections.unfavorite' : 'connections.favorite', { name: connection.name })} title={t(connection.favorite ? 'connections.removeFavorite' : 'connections.addFavorite')}
        data-on={connection.favorite || undefined} onClick={() => void run(() => oq('connections.update', { id: connection.id, favorite: !connection.favorite }))}><Star size={12} aria-hidden="true" /></button>
      <button type="button" className="oq-icon" aria-label={t('connections.editNamed', { name: connection.name })} title={t('common.edit')} onClick={() => store().openDialog(connection)}><Pencil size={12} aria-hidden="true" /></button>
      <button type="button" className="oq-icon" aria-label={t('connections.duplicateNamed', { name: connection.name })} title={t('connections.duplicate')} onClick={() => void run(() => oq('connections.duplicate', { id: connection.id }))}><Copy size={12} aria-hidden="true" /></button>
    </>}
    <button type="button" className="oq-icon" aria-label={t(connection.ephemeral ? 'connections.closeNamed' : 'connections.deleteNamed', { name: connection.name })} title={t(connection.ephemeral ? 'common.close' : 'common.delete')}
      onClick={() => connection.ephemeral ? void remove(connection.id) : setPendingDelete({ id: connection.id, name: connection.name, ephemeral: false })}><Trash2 size={12} aria-hidden="true" /></button>
  </div>

  return <section aria-label={t('connections.title')}>
    <h3>{t('connections.title')}<span className="oq-h3-actions">
      <button type="button" className="oq-icon" data-oq-action="importConnections" aria-label={t('connections.import')} title={t('connections.importTitle')} onClick={() => void run(importConnections)}><Upload size={13} aria-hidden="true" /></button>
      <button type="button" className="oq-icon" data-oq-action="exportConnections" aria-label={t('connections.export')} title={t('connections.exportTitle')} disabled={connections.length === 0}
        onClick={() => void run(exportConnections)}><Download size={13} aria-hidden="true" /></button>
      <button type="button" className="oq-icon" data-oq-action="newConnection" aria-label={t('connections.new')} title={t('connections.new')} onClick={() => store().openDialog(null)}><Plus size={14} aria-hidden="true" /></button></span></h3>
    {connections.length > 4 && <label className="oq-conn-search"><Search size={12} aria-hidden="true" /><input type="search" aria-label={t('connections.search')} placeholder={t('connections.search')} value={search} onChange={event => setSearch(event.target.value)} /></label>}
    {connectionsError && <ErrorState compact title={t('connections.loadFailed')} message={connectionsError} onRetry={() => void store().refreshConnections()} retryLabel={t('common.tryAgain')} />}
    {failure && <ErrorState compact title={failure} />}
    {pendingDelete && <ConfirmDialog danger title={t('connections.deleteTitle', { name: pendingDelete.name })} confirmLabel={t('common.delete')} cancelLabel={t('common.cancel')}
      description={t('connections.deleteDescription')}
      onCancel={() => setPendingDelete(null)} onConfirm={() => void remove(pendingDelete.id)} />}
    {connections.length === 0 && !connectionsError && <EmptyState compact title={t('connections.emptyTitle')} actions={<Button size="sm" onClick={() => store().openDialog(null)}>{t('connections.add')}</Button>}>{t('connections.emptyText')}</EmptyState>}
    {search.trim() && sections.length === 0 && <p className="oq-muted" role="status">{t('common.noMatch', { text: search.trim() })}</p>}
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
