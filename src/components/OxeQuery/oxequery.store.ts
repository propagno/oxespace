import { create } from 'zustand'
import type { ContainerEngine, ContainerEngineInfo, ContainerSummary, OxeQueryConnection } from '../../../shared/types/oxequery'
import { errorMessage, oq } from './client'

export type OxeQueryTab =
  | { id: 'containers'; kind: 'containers'; title: string }
  | { id: string; kind: 'connection'; title: string; connectionId: string }

interface OxeQueryState {
  engines: ContainerEngineInfo[]
  engine?: ContainerEngine
  containers: ContainerSummary[]
  containersError: string | null
  containersLoading: boolean
  connections: OxeQueryConnection[]
  connectionsError: string | null
  tabs: OxeQueryTab[]
  activeTab: string
  /** Container whose details are open; shared so the sidebar can open it. */
  selectedContainer: string | null
  dialog: { open: boolean; editing: OxeQueryConnection | null }
  refreshContainers(engine?: ContainerEngine): Promise<void>
  refreshConnections(): Promise<void>
  openConnection(connection: OxeQueryConnection): void
  closeTab(id: string): void
  setActiveTab(id: string): void
  selectContainer(id: string | null): void
  openDialog(editing?: OxeQueryConnection | null): void
  closeDialog(): void
  forgetConnection(id: string): void
}

const CONTAINERS: OxeQueryTab = { id: 'containers', kind: 'containers', title: 'Containers' }
let containerRequest = 0

export const useOxeQueryStore = create<OxeQueryState>((set, get) => ({
  engines: [], containers: [], containersError: null, containersLoading: false, connections: [], connectionsError: null,
  tabs: [CONTAINERS], activeTab: 'containers', selectedContainer: null, dialog: { open: false, editing: null },

  refreshContainers: async engine => {
    const request = ++containerRequest
    set({ containersLoading: true })
    try {
      const requested = engine ?? get().engine
      const result = await oq('containers.list', requested ? { engine: requested } : {})
      if (request !== containerRequest) return
      set({ containers: result.containers, engine: result.engine, containersError: null, containersLoading: false })
    } catch (error) {
      if (request !== containerRequest) return
      set({ containers: [], containersError: errorMessage(error), containersLoading: false })
    }
    try { set({ engines: await oq('containers.engines', {}) }) } catch { /* the list error already explains it */ }
  },

  refreshConnections: async () => {
    try { set({ connections: await oq('connections.list', {}), connectionsError: null }) }
    catch (error) { set({ connectionsError: errorMessage(error) }) }
  },

  openConnection: connection => set(state => {
    const id = `connection:${connection.id}`
    const tabs = state.tabs.some(tab => tab.id === id) ? state.tabs : [...state.tabs, { id, kind: 'connection' as const, title: connection.name, connectionId: connection.id }]
    return { tabs, activeTab: id }
  }),

  closeTab: id => set(state => {
    if (id === 'containers') return state
    const tabs = state.tabs.filter(tab => tab.id !== id)
    return { tabs, activeTab: state.activeTab === id ? 'containers' : state.activeTab }
  }),

  setActiveTab: id => set({ activeTab: id }),
  selectContainer: id => set({ selectedContainer: id, ...(id ? { activeTab: 'containers' } : {}) }),
  openDialog: editing => set({ dialog: { open: true, editing: editing ?? null } }),
  closeDialog: () => set({ dialog: { open: false, editing: null } }),
  forgetConnection: id => set(state => ({
    connections: state.connections.filter(connection => connection.id !== id),
    tabs: state.tabs.filter(tab => tab.kind !== 'connection' || tab.connectionId !== id),
    activeTab: state.activeTab === `connection:${id}` ? 'containers' : state.activeTab
  }))
}))
