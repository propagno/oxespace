import { Suspense, lazy, useEffect, useRef, useState, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import { Database, Plus, X } from 'lucide-react'
import { AnchoredMenu } from '../../ui'
import { EmptyState } from '../../ui/Display'
import { Button, IconButton } from '../../ui/Button'
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
  const closeOtherTabs = useOxeQueryStore(state => state.closeOtherTabs)
  const closeTabsToRight = useOxeQueryStore(state => state.closeTabsToRight)
  const newDatabase = useOxeQueryStore(state => state.newDatabaseOpen)
  const [tabMenuId, setTabMenuId] = useState<string | null>(null)
  const tabsRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => { if (active) void useOxeQueryStore.getState().refreshConnections() }, [active])

  const currentTab = tabs.find(tab => tab.id === activeTab)
  const activeConnection = currentTab?.kind === 'connection'
    ? connections.find(item => item.id === currentTab.connectionId)
    : undefined

  const titleOf = (tab: OxeQueryTab): string => tab.kind === 'connection' ? tab.title : t('view.tab.activity')
  return <div className="oq-view" aria-label="OxeQuery">
    {tabs.length > 0 && <div className="oq-tabs-bar">
      <div ref={tabsRef} className="oq-tabs" role="tablist" aria-label={t('view.openViews')}>
        {tabs.map((tab, index) => <span key={tab.id} className="oq-tab" data-tab-id={tab.id} data-active={tab.id === activeTab} data-color={tab.kind === 'connection' ? connections.find(item => item.id === tab.connectionId)?.color || undefined : undefined}
          data-environment={tab.kind === 'connection' ? connections.find(item => item.id === tab.connectionId)?.environment : undefined}
          onContextMenu={event => { event.preventDefault(); setTabMenuId(tab.id) }}>
          <button type="button" role="tab" aria-selected={tab.id === activeTab} data-oq-tab={tab.kind} onClick={() => setActiveTab(tab.id)}
            onKeyDown={event => { if (event.key === 'ContextMenu' || (event.key === 'F10' && event.shiftKey)) { event.preventDefault(); setTabMenuId(tab.id) } }}>{titleOf(tab)}</button>
          <IconButton size="sm" variant="ghost" label={t('view.closeTab', { name: titleOf(tab) })} title={t('view.closeTab', { name: titleOf(tab) })} className="oq-tab-close" icon={<X size={12} aria-hidden="true" />} onClick={() => closeTab(tab.id)} />
          {tabMenuId === tab.id && <AnchoredMenu open onOpenChange={open => { if (!open) setTabMenuId(null) }} label={t('contextMenu.tabLabel', { name: titleOf(tab) })}
            items={[
              { label: t('common.close'), icon: <X size={14} aria-hidden="true" />, onSelect: () => closeTab(tab.id) },
              { label: t('contextMenu.closeOthers'), disabled: tabs.length <= 1, onSelect: () => closeOtherTabs(tab.id) },
              { label: t('contextMenu.closeToRight'), disabled: index >= tabs.length - 1, onSelect: () => closeTabsToRight(tab.id) }
            ]}
            returnFocus={() => [...(tabsRef.current?.querySelectorAll<HTMLElement>('[data-tab-id]') ?? [])].find(el => el.dataset.tabId === tab.id)?.querySelector<HTMLElement>('[role="tab"]') ?? null} />}
        </span>)}
      </div>
      {activeConnection && <div className="oq-view-meta">
        <span>{t(`form.agentsHint.${activeConnection.agentAccess}`)}</span>
        <span className="oq-env-pill" data-env={activeConnection.environment}>{t(`environment.short.${activeConnection.environment}`)}</span>
      </div>}
    </div>}
    <div className="oq-panels">
      {tabs.length === 0 && <div className="oq-panel oq-welcome"><EmptyState icon={<Database size={22} aria-hidden="true" />} title={t('welcome.title')}
        actions={<>
          <Button variant="primary" icon={<Plus size={13} aria-hidden="true" />} data-oq-action="newConnection" onClick={() => useOxeQueryStore.getState().openDialog(null)}>{t('connections.new')}</Button>
          <Button icon={<Database size={13} aria-hidden="true" />} title={t('welcome.newDatabaseTitle')} onClick={() => useOxeQueryStore.getState().setNewDatabaseOpen(true)}>{t('welcome.newDatabase')}</Button>
        </>}>{connections.length ? t('welcome.textSaved') : t('welcome.text')}</EmptyState></div>}
      {tabs.map(tab => {
        const visible = tab.id === activeTab
        if (tab.kind === 'activity') return <div key={tab.id} className="oq-panel" hidden={!visible} role="tabpanel"><ActivityPanel active={active && visible} hideHeading /></div>
        const connection = connections.find(item => item.id === tab.connectionId)
        return <div key={tab.id} className="oq-panel" hidden={!visible} role="tabpanel">
          {!connection ? <div className="oq-placeholder"><EmptyState title={t('view.connectionGone')} actions={<Button size="sm" onClick={() => closeTab(tab.id)}>{t('view.closeThisTab')}</Button>} /></div>
            : connection.engine === 'postgres' ? <SqlWorkbench connection={connection} /> : <MongoWorkbench connection={connection} />}
        </div>
      })}
    </div>
    <ConnectionDialog />
    <Suspense fallback={null}>{newDatabase && <NewDatabaseDialog onClose={() => useOxeQueryStore.getState().setNewDatabaseOpen(false)} />}</Suspense>
  </div>
}
