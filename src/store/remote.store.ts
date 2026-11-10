import { useEffect } from 'react'
import { create } from 'zustand'
import type { MainMessage } from '../../shared/messages'
import type { RemoteApi, RemoteChange, RemoteDevice, RemoteGatewayStatus, RemotePairingPrompt } from '../../shared/types/remote'

/**
 * The phone gateway as the window sees it. It follows `remote:changed` and `remote:pairing-failed` from the app's start
 * (T86): a phone asking to pair must reach the person wherever they are, not only while Settings › Devices or a pane's
 * "Allow typing from the phone" is on screen. It never keeps anything itself.
 */
interface RemoteState {
  status: RemoteGatewayStatus | null
  devices: RemoteDevice[] | null
  /** A phone asking to pair, waiting for the person. */
  pairing: RemotePairingPrompt | null
  /** The last pairing attempt that failed (`remote.pairing.failed`), until the person starts again or dismisses it. */
  failure: MainMessage | null
  /** Reading the gateway failed. */
  loadError: string | null
  apply: (change: RemoteChange) => void
  failed: (message: MainMessage) => void
  clearFailure: () => void
  reload: () => Promise<void>
}

export const remoteApi = (): RemoteApi | undefined => window.oxe?.remote

export const useRemoteStore = create<RemoteState>((set) => ({
  status: null,
  devices: null,
  pairing: null,
  failure: null,
  loadError: null,
  apply: (change) => set(state => ({
    status: change.status ?? state.status,
    devices: change.devices ?? state.devices,
    pairing: change.pairing === undefined ? state.pairing : change.pairing
  })),
  failed: (message) => set({ failure: message }),
  clearFailure: () => set({ failure: null }),
  reload: async () => {
    const api = remoteApi()
    if (!api) return
    try {
      const [status, devices] = await Promise.all([api.status(), api.devices()])
      // The status carries the question waiting for the person (T86), so a window that opens or reloads shows it too.
      set({ status, devices, loadError: null, pairing: status.pendingPairing ?? null })
    } catch (cause) {
      set({ loadError: cause instanceof Error ? cause.message : String(cause) })
    }
  }
}))

let following = false

/**
 * Follows the gateway for the rest of the session: once, from the app's root (src/components/Remote). Reads it, so a
 * prompt that was already waiting shows too.
 */
export function followRemoteGateway(): void {
  const api = remoteApi()
  if (!api || following) return
  following = true
  api.onChanged(change => useRemoteStore.getState().apply(change))
  api.onPairingFailed?.(message => useRemoteStore.getState().failed(message))
  void useRemoteStore.getState().reload()
}

/** A view that shows the gateway reads it fresh when it opens; the app keeps following it either way. */
export function useRemoteGateway(): void {
  useEffect(() => {
    if (!remoteApi()) return
    followRemoteGateway()
    void useRemoteStore.getState().reload()
  }, [])
}

/** Tests only: forget that the gateway is followed. */
export function resetRemoteFollowForTests(): void { following = false }
