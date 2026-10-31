import { create } from 'zustand'
import type { ContainerEngine, ContainerEngineInfo, ContainerSummary } from '../../../shared/types/oxepod'
import { errorMessage, pod } from './client'
import { defaultSelection } from './pods-model'

/** What the main area of OxePod shows. */
export type PodView = 'container' | 'resources' | 'activity'
/** A clean-up waiting for the person's confirmation; the palette can ask for one. */
export type PendingPrune = 'containers' | 'images' | null

interface PodState {
  engines: ContainerEngineInfo[]
  engine?: ContainerEngine
  containers: ContainerSummary[]
  error: string | null
  loading: boolean
  /** The container whose details are open. */
  selected: string | null
  view: PodView
  filter: string
  pendingPrune: PendingPrune
  refresh(engine?: ContainerEngine): Promise<void>
  select(id: string | null): void
  show(view: PodView): void
  setFilter(filter: string): void
  askPrune(kind: PendingPrune): void
}

let request = 0
let refreshes = 0

export const useOxePodStore = create<PodState>((set, get) => ({
  engines: [], containers: [], error: null, loading: false, selected: null, view: 'container', filter: '', pendingPrune: null,

  refresh: async engine => {
    const current = ++request
    set({ loading: true })
    try {
      const requested = engine ?? get().engine
      const result = await pod('containers.list', requested ? { engine: requested } : {})
      if (current !== request) return
      const selected = get().selected
      // A removed container leaves the details; the first running one takes its place.
      const keep = selected && result.containers.some(item => item.id === selected) ? selected : defaultSelection(result.containers)
      set({ containers: result.containers, engine: result.engine, error: null, loading: false, selected: keep })
    } catch (error) {
      if (current !== request) return
      set({ containers: [], error: errorMessage(error), loading: false })
    }
    // Asking the CLI about its version and daemon costs several processes: while the list works, once
    // in a while is enough; after a failure, every refresh looks again (the person may have just started it).
    refreshes++
    if (get().error || get().engines.length === 0 || engine || refreshes % 10 === 0) {
      try { set({ engines: await pod('containers.engines', { refresh: !!get().error }) }) } catch { /* the list error already explains it */ }
    }
  },

  select: id => set({ selected: id, view: 'container' }),
  show: view => set({ view }),
  setFilter: filter => set({ filter }),
  askPrune: kind => set(kind ? { pendingPrune: kind, view: 'resources' } : { pendingPrune: null })
}))
