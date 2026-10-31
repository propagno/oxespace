import { create } from 'zustand'
import type { DatabaseEngine, OxeQueryConnection } from '../../../shared/types/oxequery'
import { errorMessage, oq } from './client'

export type OxeQueryTab =
  | { id: 'activity'; kind: 'activity' }
  | { id: string; kind: 'connection'; title: string; connectionId: string }

/** A new connection filled in from elsewhere (a database container in OxePod); the password is still asked. */
export interface ConnectionDraft {
  engine: DatabaseEngine
  name: string
  host: string
  port: number
  database: string
  username: string
  /** The container it points at, so the connection remembers where it came from. */
  containerRef?: string
}

interface OxeQueryState {
  connections: OxeQueryConnection[]
  connectionsError: string | null
  tabs: OxeQueryTab[]
  /** The tab in front; empty when no tab is open and the welcome page shows. */
  activeTab: string
  dialog: { open: boolean; editing: OxeQueryConnection | null; draft?: ConnectionDraft }
  /** OxeQuery settings dialog; in the store so the palette opens it whether or not the sidebar is expanded. */
  preferencesOpen: boolean
  /** The New database wizard; in the store so the palette and the welcome page open the same one. */
  newDatabaseOpen: boolean
  refreshConnections(): Promise<void>
  openConnection(connection: OxeQueryConnection): void
  openActivity(): void
  closeTab(id: string): void
  setActiveTab(id: string): void
  openDialog(editing?: OxeQueryConnection | null, draft?: ConnectionDraft): void
  closeDialog(): void
  setPreferencesOpen(open: boolean): void
  setNewDatabaseOpen(open: boolean): void
  forgetConnection(id: string): void
}

/** The tab that takes the front when `closing` goes: its right-hand neighbour, else the left one, else none. */
function nextActive(tabs: OxeQueryTab[], closing: string, active: string): string {
  if (active !== closing) return active
  const index = tabs.findIndex(tab => tab.id === closing)
  const rest = tabs.filter(tab => tab.id !== closing)
  return rest[Math.min(index, rest.length - 1)]?.id ?? ''
}

export const useOxeQueryStore = create<OxeQueryState>((set) => ({
  connections: [], connectionsError: null, tabs: [], activeTab: '', dialog: { open: false, editing: null }, preferencesOpen: false, newDatabaseOpen: false,

  refreshConnections: async () => {
    try { set({ connections: await oq('connections.list', {}), connectionsError: null }) }
    catch (error) { set({ connectionsError: errorMessage(error) }) }
  },

  openConnection: connection => set(state => {
    const id = `connection:${connection.id}`
    const tabs = state.tabs.some(tab => tab.id === id) ? state.tabs : [...state.tabs, { id, kind: 'connection' as const, title: connection.name, connectionId: connection.id }]
    return { tabs, activeTab: id }
  }),

  openActivity: () => set(state => ({ tabs: state.tabs.some(tab => tab.kind === 'activity') ? state.tabs : [{ id: 'activity', kind: 'activity' as const }, ...state.tabs], activeTab: 'activity' })),

  closeTab: id => set(state => ({ tabs: state.tabs.filter(tab => tab.id !== id), activeTab: nextActive(state.tabs, id, state.activeTab) })),

  setActiveTab: id => set({ activeTab: id }),
  openDialog: (editing, draft) => set({ dialog: { open: true, editing: editing ?? null, ...(draft && !editing ? { draft } : {}) } }),
  closeDialog: () => set({ dialog: { open: false, editing: null } }),
  setPreferencesOpen: open => set({ preferencesOpen: open }),
  setNewDatabaseOpen: open => set({ newDatabaseOpen: open }),
  forgetConnection: id => set(state => {
    const closing = state.tabs.find(tab => tab.kind === 'connection' && tab.connectionId === id)
    return {
      connections: state.connections.filter(connection => connection.id !== id),
      tabs: state.tabs.filter(tab => tab.kind !== 'connection' || tab.connectionId !== id),
      activeTab: closing ? nextActive(state.tabs, closing.id, state.activeTab) : state.activeTab
    }
  })
}))
