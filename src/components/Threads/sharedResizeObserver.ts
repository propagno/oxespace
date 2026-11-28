export type ResizeCallback = (entry: ResizeObserverEntry) => void

let sharedObserver: ResizeObserver | null = null
let sharedCtor: typeof ResizeObserver | null = null
let listeners = new WeakMap<Element, Set<ResizeCallback>>()

function ensureSharedObserver(): ResizeObserver | null {
  const CurrentCtor = typeof globalThis.ResizeObserver === 'function' ? globalThis.ResizeObserver : null
  if (!CurrentCtor) {
    if (sharedObserver) {
      try { sharedObserver.disconnect() } catch { /* ignore */ }
    }
    sharedObserver = null
    sharedCtor = null
    listeners = new WeakMap()
    return null
  }

  if (sharedObserver && sharedCtor === CurrentCtor) {
    return sharedObserver
  }

  if (sharedObserver) {
    try { sharedObserver.disconnect() } catch { /* ignore */ }
  }

  listeners = new WeakMap()
  sharedCtor = CurrentCtor
  sharedObserver = new CurrentCtor(entries => {
    for (const entry of entries) {
      const callbacks = listeners.get(entry.target)
      if (!callbacks) continue
      for (const callback of Array.from(callbacks)) {
        callback(entry)
      }
    }
  })
  return sharedObserver
}

/**
 * Observes resize events for `element` using a single shared `ResizeObserver` singleton
 * backed by a `WeakMap<Element, Set<ResizeCallback>>`.
 *
 * Returns an idempotent cleanup function that removes this callback and calls `unobserve`
 * when no callbacks remain for `element`. Automatically re-initializes if `globalThis.ResizeObserver`
 * is replaced (e.g., mocked in tests).
 */
export function observeElementResize(element: Element, callback: ResizeCallback): () => void {
  const observer = ensureSharedObserver()
  if (!observer) return () => undefined

  const registry = listeners
  let callbacks = registry.get(element)
  const isFirstForElement = !callbacks
  if (!callbacks) {
    callbacks = new Set()
    registry.set(element, callbacks)
  }
  callbacks.add(callback)
  if (isFirstForElement) {
    observer.observe(element)
  }

  let active = true
  return () => {
    if (!active) return
    active = false
    const registered = registry.get(element)
    if (!registered) return
    registered.delete(callback)
    if (registered.size === 0) {
      registry.delete(element)
      if (sharedObserver === observer) {
        try { observer.unobserve(element) } catch { /* ignore */ }
      }
    }
  }
}

/** Disconnects and resets the shared ResizeObserver singleton (for deterministic unit tests). */
export function resetSharedResizeObserverForTest(): void {
  if (sharedObserver) {
    try { sharedObserver.disconnect() } catch { /* ignore */ }
  }
  sharedObserver = null
  sharedCtor = null
  listeners = new WeakMap()
}
