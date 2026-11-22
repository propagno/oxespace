import { useMemo, useRef, useState, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronDown, ChevronRight, Copy, Database, Download, FolderOpen, Pencil, Plus, Search, Star, Trash2, Upload } from 'lucide-react'
import type { OxeQueryConnection } from '../../../shared/types/oxequery'
import { errorMessage, oq } from './client'
import { organize } from './connection-list-model'
import { useOxeQueryStore } from './oxequery.store'
import { copyText } from './catalog'
import { AnchoredMenu, Button, ConfirmDialog, EmptyState, ErrorState, IconButton, SidebarFilter, SidebarGroup, SidebarRow, SidebarSection, type MenuEntry } from '../../ui'
import { exportConnections, importConnections } from './connection-transfer'

/** The saved connections: favorites, recent, groups, search, and the actions on one connection. */
export function ConnectionList({ activeTab }: { activeTab: string }): ReactElement {
  const { t } = useTranslation('oxequery')
  const connections = useOxeQueryStore(state => state.connections)
  const connectionsError = useOxeQueryStore(state => state.connectionsError)
  // Kept in the store: collapsing the sidebar unmounts this list, and its folded sections and search came back reset (T61).
  const search = useOxeQueryStore(state => state.connectionSearch), setSearch = useOxeQueryStore(state => state.setConnectionSearch)
  const folded = useOxeQueryStore(state => state.foldedSections)
  const collapsed = useMemo(() => new Set(folded), [folded])
  const [failure, setFailure] = useState('')
  const [pendingDelete, setPendingDelete] = useState<{ id: string; name: string; ephemeral: boolean } | null>(null)
  const [menuKey, setMenuKey] = useState<string | null>(null)
  const listRef = useRef<HTMLElement | null>(null)
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
  const toggleSection = (id: string): void => store().toggleSection(id)

  const connectionMenuItems = (connection: OxeQueryConnection): MenuEntry[] => {
    const items: MenuEntry[] = [
      { label: t('contextMenu.open'), icon: <FolderOpen size={14} aria-hidden="true" />, onSelect: () => store().openConnection(connection) }
    ]
    if (!connection.ephemeral) {
      items.push(
        { label: t('common.edit'), icon: <Pencil size={14} aria-hidden="true" />, onSelect: () => store().openDialog(connection) },
        { label: t('connections.duplicate'), icon: <Copy size={14} aria-hidden="true" />, onSelect: () => { void run(() => oq('connections.duplicate', { id: connection.id })) } }
      )
    }
    items.push(
      { label: t('contextMenu.copyName'), icon: <Copy size={14} aria-hidden="true" />, onSelect: () => { void copyText(connection.name, t('contextMenu.copiedName'), t('contextMenu.copiedNameDone')) } },
      {
        label: t(connection.ephemeral ? 'common.close' : 'common.delete'),
        icon: <Trash2 size={14} aria-hidden="true" />,
        danger: true,
        onSelect: () => {
          if (connection.ephemeral) void remove(connection.id)
          else setPendingDelete({ id: connection.id, name: connection.name, ephemeral: false })
        }
      }
    )
    return items
  }

  const row = (connection: OxeQueryConnection, section: string): ReactElement => {
    const key = `${section}:${connection.id}`
    const tooltip = `${connection.engine} · ${connection.host}:${connection.port}${connection.ephemeral ? ` · ${t('connections.notSaved')}` : ''}`
    return (
      <div key={key} className="oq-connection-row" data-connection-key={key}
        onContextMenu={event => { if (event.defaultPrevented) return; event.preventDefault(); setMenuKey(key) }}>
        <SidebarRow
          className="oq-connection-item"
          onKeyDownCapture={event => { if (event.key === 'ContextMenu' || (event.key === 'F10' && event.shiftKey)) { event.preventDefault(); event.stopPropagation(); setMenuKey(key) } }}
          selected={activeTab === `connection:${connection.id}`}
          lead={connection.color ? <i className="oq-color-dot" data-color={connection.color} aria-hidden="true" /> : <Database size={14} aria-hidden="true" />}
          title={<span title={tooltip}>{connection.name}</span>}
          meta={<span className="oq-connection-meta">
            <small className="oq-engine-tag">{connection.engine === 'mongodb' ? 'Mongo' : 'PG'}</small>
            {connection.environment !== 'local' && <small className={connection.environment === 'prod' ? 'oq-prod' : 'oq-env'}>{t(`environment.short.${connection.environment}`)}</small>}
          </span>}
          onSelect={() => store().openConnection(connection)}
          actions={<>
            {!connection.ephemeral && <>
              <IconButton
                size="sm"
                className={connection.favorite ? 'oq-fav-on' : undefined}
                aria-pressed={connection.favorite}
                label={t(connection.favorite ? 'connections.unfavorite' : 'connections.favorite', { name: connection.name })}
                title={t(connection.favorite ? 'connections.removeFavorite' : 'connections.addFavorite')}
                data-on={connection.favorite || undefined}
                icon={<Star size={12} aria-hidden="true" />}
                onClick={() => void run(() => oq('connections.update', { id: connection.id, favorite: !connection.favorite }))}
              />
              <IconButton
                size="sm"
                label={t('connections.editNamed', { name: connection.name })}
                title={t('common.edit')}
                icon={<Pencil size={12} aria-hidden="true" />}
                onClick={() => store().openDialog(connection)}
              />
              <IconButton
                size="sm"
                label={t('connections.duplicateNamed', { name: connection.name })}
                title={t('connections.duplicate')}
                icon={<Copy size={12} aria-hidden="true" />}
                onClick={() => void run(() => oq('connections.duplicate', { id: connection.id }))}
              />
            </>}
            <IconButton
              size="sm"
              label={t(connection.ephemeral ? 'connections.closeNamed' : 'connections.deleteNamed', { name: connection.name })}
              title={t(connection.ephemeral ? 'common.close' : 'common.delete')}
              icon={<Trash2 size={12} aria-hidden="true" />}
              onClick={() => connection.ephemeral ? void remove(connection.id) : setPendingDelete({ id: connection.id, name: connection.name, ephemeral: false })}
            />
          </>}
        />
        {menuKey === key && <AnchoredMenu open onOpenChange={open => { if (!open) setMenuKey(null) }} label={t('contextMenu.connectionLabel', { name: connection.name })}
          items={connectionMenuItems(connection)} returnFocus={() => [...(listRef.current?.querySelectorAll<HTMLElement>('[data-connection-key]') ?? [])].find(el => el.dataset.connectionKey === key)?.querySelector<HTMLElement>('[data-ui="sidebar-row"]') ?? null} />}
      </div>
    )
  }

  return <section ref={listRef} aria-label={t('connections.title')}>
    <SidebarSection
      label={t('connections.title')}
      action={<span className="oq-h3-actions">
        <IconButton size="sm" data-oq-action="importConnections" label={t('connections.import')} title={t('connections.importTitle')} icon={<Upload size={13} aria-hidden="true" />} onClick={() => void run(importConnections)} />
        <IconButton size="sm" data-oq-action="exportConnections" label={t('connections.export')} title={t('connections.exportTitle')} disabled={connections.length === 0} icon={<Download size={13} aria-hidden="true" />} onClick={() => void run(exportConnections)} />
        <IconButton size="sm" data-oq-action="newConnection" label={t('connections.new')} title={t('connections.new')} icon={<Plus size={14} aria-hidden="true" />} onClick={() => store().openDialog(null)} />
      </span>}
    />
    {connections.length > 4 && (
      <SidebarFilter
        className="oq-conn-search"
        icon={<Search size={12} aria-hidden="true" />}
        aria-label={t('connections.search')}
        placeholder={t('connections.search')}
        value={search}
        onChange={event => setSearch(event.target.value)}
        onClear={() => setSearch('')}
        clearLabel={t('common.clear', { defaultValue: 'Clear' })}
      />
    )}
    {connectionsError && <ErrorState compact title={t('connections.loadFailed')} message={connectionsError} onRetry={() => void store().refreshConnections()} retryLabel={t('common.tryAgain')} />}
    {failure && <ErrorState compact title={failure} />}
    {pendingDelete && <ConfirmDialog danger title={t('connections.deleteTitle', { name: pendingDelete.name })} confirmLabel={t('common.delete')} cancelLabel={t('common.cancel')}
      description={t('connections.deleteDescription')}
      onCancel={() => setPendingDelete(null)} onConfirm={() => void remove(pendingDelete.id)} />}
    {connections.length === 0 && !connectionsError && <EmptyState compact title={t('connections.emptyTitle')} actions={<Button size="sm" onClick={() => store().openDialog(null)}>{t('connections.new')}</Button>}>{t('connections.emptyText')}</EmptyState>}
    {search.trim() && sections.length === 0 && <p className="oq-muted" role="status">{t('common.noMatch', { text: search.trim() })}</p>}
    {sections.map(section => {
      const headed = sections.length > 1 || section.id === 'results' || section.id.startsWith('group:')
      const open = !collapsed.has(section.id)
      return <div key={section.id} className="oq-conn-section" data-section={section.id}>
        {headed && (
          <SidebarGroup
            className="oq-conn-heading"
            aria-expanded={open}
            lead={open ? <ChevronDown size={12} aria-hidden="true" /> : <ChevronRight size={12} aria-hidden="true" />}
            title={section.title}
            meta={section.connections.length}
            onSelect={() => toggleSection(section.id)}
          />
        )}
        {(open || !headed) && section.connections.map(connection => row(connection, section.id))}
      </div>
    })}
  </section>
}
