/**
 * S7.1 · "Something an agent does changed": a pane's state, a conversation, a delegation or a work run. The sources call
 * this; its listeners (the window's `agents:changed` push and the phone gateway's `agents` topic) read the overview
 * again. Bursts are folded into one call a moment later, well inside the one second the spec allows (§13). Kept tiny
 * and free of Electron so any service can call it without growing the main entry.
 */
const FOLD_MS = 50

const listeners = new Set<() => void>()
let pending: ReturnType<typeof setTimeout> | null = null

export function notifyAgentsChanged(): void {
  if (!listeners.size || pending) return
  pending = setTimeout(() => {
    pending = null
    for (const listener of [...listeners]) {
      try { listener() } catch { /* a failed push never breaks the source that changed, nor the other listener */ }
    }
  }, FOLD_MS)
}

/** Adds a listener; returns a function that removes it. */
export function onAgentsChanged(next: () => void): () => void {
  listeners.add(next)
  return () => {
    listeners.delete(next)
    if (!listeners.size && pending) { clearTimeout(pending); pending = null }
  }
}
