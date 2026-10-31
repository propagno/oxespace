import { useSyncExternalStore } from 'react'
import type { AppConnectivity } from '../../shared/types/app'

export type Connectivity = AppConnectivity['state']

/**
 * Whether the computer has a network route, as the main process reads it (`app:connectivity`, pushed on change).
 * One subscription for the whole window, shared by every place that shows the offline state. It starts as `unknown`
 * and stays there when the main process cannot say, so nothing claims offline without being told.
 */
let current: Connectivity = 'unknown'
let started = false
const listeners = new Set<() => void>()

function set(next: Connectivity): void {
  if (next === current) return
  current = next
  for (const listener of listeners) listener()
}

function start(): void {
  if (started) return
  started = true
  const api = window.oxe?.app
  api?.onConnectivity?.(state => set(state.state))
  api?.connectivity?.().then(state => set(state.state), () => { /* no answer: stays unknown */ })
}

function subscribe(listener: () => void): () => void {
  start()
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

export function useConnectivity(): Connectivity {
  return useSyncExternalStore(subscribe, () => current, () => 'unknown')
}

/** For tests: forget what was read, so the next subscriber asks the main process again. */
export function resetConnectivity(): void {
  current = 'unknown'
  started = false
  listeners.clear()
}
