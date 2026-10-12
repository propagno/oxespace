import { useEffect, type ReactElement } from 'react'
import { X } from 'lucide-react'
import { ConnectionDialog } from './ConnectionDialog'
import { ContainersPanel } from './ContainersPanel'
import { MongoWorkbench } from './MongoWorkbench'
import { SqlWorkbench } from './SqlWorkbench'
import { useOxeQueryStore } from './oxequery.store'
import './OxeQuery.css'

/** Main area of the OxeQuery mode: a tab for containers and one per opened connection. */
export function OxeQueryView({ active }: { active: boolean }): ReactElement {
  const tabs = useOxeQueryStore(state => state.tabs)
  const activeTab = useOxeQueryStore(state => state.activeTab)
  const connections = useOxeQueryStore(state => state.connections)
  const setActiveTab = useOxeQueryStore(state => state.setActiveTab)
  const closeTab = useOxeQueryStore(state => state.closeTab)

  useEffect(() => { if (active) void useOxeQueryStore.getState().refreshConnections() }, [active])

  return <div className="oq-view" aria-label="OxeQuery">
    <div className="oq-tabs" role="tablist" aria-label="Open views">
      {tabs.map(tab => <span key={tab.id} className="oq-tab" data-active={tab.id === activeTab}>
        <button type="button" role="tab" aria-selected={tab.id === activeTab} onClick={() => setActiveTab(tab.id)}>{tab.title}</button>
        {tab.id !== 'containers' && <button type="button" aria-label={`Close ${tab.title}`} className="oq-tab-close" onClick={() => closeTab(tab.id)}><X size={12} aria-hidden="true" /></button>}
      </span>)}
    </div>
    <div className="oq-panels">
      {tabs.map(tab => {
        const visible = tab.id === activeTab
        if (tab.kind === 'containers') return <div key={tab.id} className="oq-panel" hidden={!visible} role="tabpanel"><ContainersPanel active={active && visible} /></div>
        const connection = connections.find(item => item.id === tab.connectionId)
        return <div key={tab.id} className="oq-panel" hidden={!visible} role="tabpanel">
          {!connection ? <div className="oq-empty"><p>This connection no longer exists.</p></div>
            : connection.engine === 'postgres' ? <SqlWorkbench connection={connection} /> : <MongoWorkbench connection={connection} />}
        </div>
      })}
    </div>
    <ConnectionDialog />
  </div>
}
