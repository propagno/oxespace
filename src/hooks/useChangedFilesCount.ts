import { useEffect, useState } from 'react'

/**
 * OXE-185 (AG-04d): OxeCode's changed-files count of a scope, from main's one debounced counter
 * (window.oxe.git.changedCount). Every reader of the same rootPath (the Changes button, the panel's count) shares one
 * module-level entry, so they show the same N from one IPC call. A null rootPath asks nothing. OxeChat is not part of it.
 */
interface CountEntry {
  value: number | null
  fetchedAt: number
  inFlight: Promise<void> | null
  stale?: boolean
}

const FRESH_MS = 2_000
const entries = new Map<string, CountEntry>()
const listeners = new Map<string, Set<() => void>>()

function notify(rootPath: string): void {
  for (const listener of listeners.get(rootPath) ?? []) listener()
}

function refresh(rootPath: string, force = false): void {
  const entry = entries.get(rootPath) ?? { value: null, fetchedAt: 0, inFlight: null }
  entries.set(rootPath, entry)
  if (entry.inFlight) {
    if (force) entry.stale = true
    return
  }
  if (!force && entry.fetchedAt > 0 && Date.now() - entry.fetchedAt < FRESH_MS) return
  const git = typeof window !== 'undefined' ? window.oxe?.git : undefined
  if (!git?.changedCount) return
  entry.stale = false
  entry.inFlight = git.changedCount({ rootPath })
    .then((value) => { entry.value = typeof value === 'number' ? value : null })
    .catch(() => { entry.value = null })
    .finally(() => {
      entry.inFlight = null
      entry.fetchedAt = Date.now()
      notify(rootPath)
      if (entry.stale) {
        entry.stale = false
        if ((listeners.get(rootPath)?.size ?? 0) > 0) refresh(rootPath, true)
      }
    })
}

export function useChangedFilesCount(rootPath: string | null): number | null {
  const [, rerender] = useState(0)

  useEffect(() => {
    if (!rootPath) return
    const listener = (): void => rerender((n) => n + 1)
    let set = listeners.get(rootPath)
    if (!set) { set = new Set(); listeners.set(rootPath, set) }
    set.add(listener)
    refresh(rootPath)
    const onFocus = (): void => refresh(rootPath, true)
    window.addEventListener('focus', onFocus)
    return () => {
      window.removeEventListener('focus', onFocus)
      set!.delete(listener)
      if (set!.size === 0) listeners.delete(rootPath)
    }
  }, [rootPath])

  if (!rootPath) return null
  return entries.get(rootPath)?.value ?? null
}
