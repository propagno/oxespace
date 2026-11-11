// Frozen helper for the CR-F4-8 and CR-F4-D acceptance tests (OXE program, phase F4). Written by the planner; the
// executor must not edit it. It builds window.oxe with the REAL preload (electron/preload/api.ts createOxeApi) over a
// fake PreloadIpc, so a renderer call only reaches the fake main when the preload exposes it on the channel that
// IPC_CHANNELS names. The fake main answers by "<group>.<key>" (the IPC_CHANNELS key whose value is the channel invoked);
// the key names are agreed with BACKEND's CR-F4-7 (thread.places, placeDiff, placeRead, resolvePath, placeDriftAnswer,
// placeUndo, placeRestore, placeDiscard, panes, collisions, agentSummary; push thread.placesChanged).
import { createOxeApi, type PreloadIpc } from '../../../electron/preload/api'
import { IPC_CHANNELS } from '../../../shared/types/ipc'

export type FakeMain = Record<string, (...args: unknown[]) => unknown>
type Listener = (event: unknown, payload: unknown) => void

function channelKeys(): Map<string, string> {
  const keys = new Map<string, string>()
  for (const [group, entries] of Object.entries(IPC_CHANNELS as Record<string, unknown>)) {
    if (typeof entries === 'string') { keys.set(entries, group); continue }
    if (!entries || typeof entries !== 'object') continue
    for (const [key, channel] of Object.entries(entries as Record<string, unknown>)) {
      if (typeof channel === 'string') keys.set(channel, `${group}.${key}`)
    }
  }
  return keys
}

/** window.oxe through the real preload. `invoked` lists every call main received, by key, with its arguments. */
export function preloadOxe(main: FakeMain): { invoked: Array<[string, unknown[]]>; emit: (key: string, payload: unknown) => void } {
  const keys = channelKeys()
  const listeners = new Map<string, Set<Listener>>()
  const invoked: Array<[string, unknown[]]> = []
  const ipc: PreloadIpc = {
    invoke: async (channel, ...args) => {
      const key = keys.get(channel) ?? channel
      invoked.push([key, args])
      const answer = main[key]
      return answer ? answer(...args) : undefined
    },
    on: (channel, listener) => {
      const set = listeners.get(channel) ?? new Set<Listener>()
      set.add(listener as Listener)
      listeners.set(channel, set)
    },
    removeListener: (channel, listener) => { listeners.get(channel)?.delete(listener as Listener) }
  }
  Object.defineProperty(window, 'oxe', { configurable: true, writable: true, value: createOxeApi(ipc) })
  const emit = (key: string, payload: unknown): void => {
    const channel = [...keys.entries()].find(([, name]) => name === key)?.[0]
    if (!channel) throw new Error(`IPC_CHANNELS has no ${key}`)
    for (const listener of [...(listeners.get(channel) ?? [])]) listener({}, payload)
  }
  return { invoked, emit }
}
