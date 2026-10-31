import { Suspense, lazy, useEffect, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import { Database, Plus, X } from 'lucide-react'
import { EmptyState } from '../../ui/Display'
import { Button } from '../../ui/Button'
import { ConnectionDialog } from './ConnectionDialog'
import { ActivityPanel } from './ActivityPanel'
import { MongoWorkbench } from './MongoWorkbench'
import { SqlWorkbench } from './SqlWorkbench'
import { useOxeQueryCatalog } from './catalog'
import { useOxeQueryStore, type OxeQueryTab } from './oxequery.store'
import './OxeQuery.css'

const NewDatabaseDialog = lazy(() => import('./NewDatabaseDialog').then(module => ({ default: module.NewDatabaseDialog })))

/** Main area of the OxeQuery mode: one tab per opened connection, plus agent activity when asked for. */
export function OxeQueryView({ active }: { active: boolean }): ReactElement {
  useOxeQueryCatalog()
  const { t } = useTranslation('oxequery')
  const tabs = useOxeQueryStore(state => state.tabs)
  const activeTab = useOxeQueryStore(state => state.activeTab)
  const connections = useOxeQueryStore(state => state.connections)
  const setActiveTab = useOxeQueryStore(state => state.setActiveTab)
  const closeTab = useOxeQueryStore(state => state.closeTab)
  const newDatabase = useOxeQueryStore(state => state.newDatabaseOpen)

  useEffect(() => { if (active) void useOxeQueryStore.getState().refreshConnections() }, [active])

  const titleOf = (tab: OxeQueryTab): string => tab.kind === 'connection' ? tab.title : t('view.tab.activity')
  return <div className="oq-view" aria-label="OxeQuery">
    {tabs.length > 0 && <div className="oq-tabs" role="tablist" aria-label={t('view.openViews')}>
      {tabs.map(tab => <span key={tab.id} className="oq-tab" data-active={tab.id === activeTab} data-color={tab.kind === 'connection' ? connections.find(item => item.id === tab.connectionId)?.color || undefined : undefined}
        data-environment={tab.kind === 'connection' ? connections.find(item => item.id === tab.connectionId)?.environment : undefined}>
        <button type="button" role="tab" aria-selected={tab.id === activeTab} data-oq-tab={tab.kind} onClick={() => setActiveTab(tab.id)}>{titleOf(tab)}</button>
        <button type="button" aria-label={t('view.closeTab', { name: titleOf(tab) })} className="oq-tab-close" onClick={() => closeTab(tab.id)}><X size={12} aria-hidden="true" /></button>
      </span>)}
    </div>}
    <div className="oq-panels">
      {tabs.length === 0 && <div className="oq-panel oq-welcome"><EmptyState icon={<Database size={22} aria-hidden="true" />} title={t('welcome.title')}
        actions={<>
          <Button variant="primary" icon={<Plus size={13} aria-hidden="true" />} data-oq-action="newConnection" onClick={() => useOxeQueryStore.getState().openDialog(null)}>{t('connections.new')}</Button>
          <Button icon={<Database size={13} aria-hidden="true" />} title={t('welcome.newDatabaseTitle')} onClick={() => useOxeQueryStore.getState().setNewDatabaseOpen(true)}>{t('welcome.newDatabase')}</Button>
        </>}>{connections.length ? t('welcome.textSaved') : t('welcome.text')}</EmptyState></div>}
      {tabs.map(tab => {
        const visible = tab.id === activeTab
        if (tab.kind === 'activity') return <div key={tab.id} className="oq-panel" hidden={!visible} role="tabpanel"><ActivityPanel active={active && visible} /></div>
        const connection = connections.find(item => item.id === tab.connectionId)
        return <div key={tab.id} className="oq-panel" hidden={!visible} role="tabpanel">
          {!connection ? <div className="oq-placeholder"><EmptyState title={t('view.connectionGone')} actions={<button type="button" onClick={() => closeTab(tab.id)}>{t('view.closeThisTab')}</button>} /></div>
            : connection.engine === 'postgres' ? <SqlWorkbench connection={connection} /> : <MongoWorkbench connection={connection} />}
        </div>
      })}
    </div>
    <ConnectionDialog />
    <Suspense fallback={null}>{newDatabase && <NewDatabaseDialog onClose={() => useOxeQueryStore.getState().setNewDatabaseOpen(false)} />}</Suspense>
  </div>
}
