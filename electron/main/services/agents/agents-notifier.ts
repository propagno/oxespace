/**
 * S7.1 · "Something an agent does changed": a pane's state, a conversation, a delegation or a work run. The sources call
 * this; the agents read model, once loaded, answers with one `agents:changed` push. Bursts are folded into one push a
 * moment later, well inside the one second the spec allows (§13). Kept tiny and free of Electron so any service can call
 * it without growing the main entry.
 */
const FOLD_MS = 50

let listener: (() => void) | null = null
let pending: ReturnType<typeof setTimeout> | null = null

export function notifyAgentsChanged(): void {
  if (!listener || pending) return
  pending = setTimeout(() => {
    pending = null
    try { listener?.() } catch { /* a failed push never breaks the source that changed */ }
  }, FOLD_MS)
}

/** One listener: the read model. Returns a function that removes it. */
export function onAgentsChanged(next: () => void): () => void {
  listener = next
  return () => {
    if (listener === next) listener = null
    if (pending) { clearTimeout(pending); pending = null }
  }
}
