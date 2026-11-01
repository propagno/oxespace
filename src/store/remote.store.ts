import { useEffect } from 'react'
import { create } from 'zustand'
import type { RemoteApi, RemoteChange, RemoteDevice, RemoteGatewayStatus, RemotePairingPrompt } from '../../shared/types/remote'

/**
 * The phone gateway as the window sees it (Settings › Devices and the panes' "Allow typing from the phone"). It reads
 * `window.oxe.remote` once the first view needs it and follows `remote:changed`; it never keeps anything itself.
 */
interface RemoteState {
  status: RemoteGatewayStatus | null
  devices: RemoteDevice[] | null
  /** A phone asking to pair, waiting for the person. */
  pairing: RemotePairingPrompt | null
  /** Reading the gateway failed. */
  loadError: string | null
  apply: (change: RemoteChange) => void
  reload: () => Promise<void>
}

export const remoteApi = (): RemoteApi | undefined => window.oxe?.remote

export const useRemoteStore = create<RemoteState>((set) => ({
  status: null,
  devices: null,
  pairing: null,
  loadError: null,
  apply: (change) => set(state => ({
    status: change.status ?? state.status,
    devices: change.devices ?? state.devices,
    pairing: change.pairing === undefined ? state.pairing : change.pairing
  })),
  reload: async () => {
    const api = remoteApi()
    if (!api) return
    try {
      const [status, devices] = await Promise.all([api.status(), api.devices()])
      set({ status, devices, loadError: null })
    } catch (cause) {
      set({ loadError: cause instanceof Error ? cause.message : String(cause) })
    }
  }
}))

let watchers = 0
let stop: (() => void) | null = null

/** Follows the gateway while a view that shows it is mounted; the first one reads it, the last one stops listening. */
export function useRemoteGateway(): void {
  useEffect(() => {
    const api = remoteApi()
    if (!api) return
    watchers++
    if (watchers === 1) {
      stop = api.onChanged(change => useRemoteStore.getState().apply(change))
      void useRemoteStore.getState().reload()
    }
    return () => {
      watchers--
      if (watchers === 0) { stop?.(); stop = null }
    }
  }, [])
}

// bisect only (F7.3): which fields change during a cold switch
useRemoteStore.subscribe((next, prev) => { const w = window as unknown as { __stores?: Record<string, number> }; w.__stores ??= {}
  for (const key of Object.keys(next)) if ((next as unknown as Record<string, unknown>)[key] !== (prev as unknown as Record<string, unknown>)[key]) w.__stores['Remote.' + key] = (w.__stores['Remote.' + key] ?? 0) + 1 })
