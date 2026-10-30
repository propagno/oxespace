import { useEffect, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import { X } from 'lucide-react'
import { EmptyState } from '../../ui/Display'
import { ConnectionDialog } from './ConnectionDialog'
import { ActivityPanel } from './ActivityPanel'
import { ContainersPanel } from './ContainersPanel'
import { MongoWorkbench } from './MongoWorkbench'
import { SqlWorkbench } from './SqlWorkbench'
import { useOxeQueryCatalog } from './catalog'
import { useOxeQueryStore, type OxeQueryTab } from './oxequery.store'
import './OxeQuery.css'

/** Main area of the OxeQuery mode: a tab for containers and one per opened connection. */
export function OxeQueryView({ active }: { active: boolean }): ReactElement {
  useOxeQueryCatalog()
  const { t } = useTranslation('oxequery')
  const tabs = useOxeQueryStore(state => state.tabs)
  const activeTab = useOxeQueryStore(state => state.activeTab)
  const connections = useOxeQueryStore(state => state.connections)
  const setActiveTab = useOxeQueryStore(state => state.setActiveTab)
  const closeTab = useOxeQueryStore(state => state.closeTab)

  useEffect(() => { if (active) void useOxeQueryStore.getState().refreshConnections() }, [active])

  const titleOf = (tab: OxeQueryTab): string => tab.kind === 'connection' ? tab.title : t(`view.tab.${tab.kind}`)
  return <div className="oq-view" aria-label="OxeQuery">
    <div className="oq-tabs" role="tablist" aria-label={t('view.openViews')}>
      {tabs.map(tab => <span key={tab.id} className="oq-tab" data-active={tab.id === activeTab} data-color={tab.kind === 'connection' ? connections.find(item => item.id === tab.connectionId)?.color || undefined : undefined}
        data-environment={tab.kind === 'connection' ? connections.find(item => item.id === tab.connectionId)?.environment : undefined}>
        <button type="button" role="tab" aria-selected={tab.id === activeTab} data-oq-tab={tab.kind} onClick={() => setActiveTab(tab.id)}>{titleOf(tab)}</button>
        {tab.kind === 'connection' && <button type="button" aria-label={t('view.closeTab', { name: tab.title })} className="oq-tab-close" onClick={() => closeTab(tab.id)}><X size={12} aria-hidden="true" /></button>}
      </span>)}
    </div>
    <div className="oq-panels">
      {tabs.map(tab => {
        const visible = tab.id === activeTab
        if (tab.kind === 'containers') return <div key={tab.id} className="oq-panel" hidden={!visible} role="tabpanel"><ContainersPanel active={active && visible} /></div>
        if (tab.kind === 'activity') return <div key={tab.id} className="oq-panel" hidden={!visible} role="tabpanel"><ActivityPanel active={active && visible} /></div>
        const connection = connections.find(item => item.id === tab.connectionId)
        return <div key={tab.id} className="oq-panel" hidden={!visible} role="tabpanel">
          {!connection ? <div className="oq-placeholder"><EmptyState title={t('view.connectionGone')} actions={<button type="button" onClick={() => closeTab(tab.id)}>{t('view.closeThisTab')}</button>} /></div>
            : connection.engine === 'postgres' ? <SqlWorkbench connection={connection} /> : <MongoWorkbench connection={connection} />}
        </div>
      })}
    </div>
    <ConnectionDialog />
  </div>
}
