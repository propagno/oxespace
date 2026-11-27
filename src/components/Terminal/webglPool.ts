import type { Terminal } from '@xterm/xterm'
import type { WebglAddon } from '@xterm/addon-webgl'
import { loadWebglAddon, loadedWebglAddon, supportsWebgl2 } from './webglAddonLoader'
import { MAX_WEBGL_CONTEXTS } from './webglBudget'

/**
 * OXE-451 · Maximum number of recently used terminal panes kept warm with live
 * WebGL2 contexts and unparked IPC sessions across workspace switches.
 * Strictly below MAX_WEBGL_CONTEXTS (14) so Chromium never drops active contexts.
 */
export const WARM_WEBGL_POOL_SIZE = 8

/**
 * OXE-451 · Idle TTL before a hidden warm pane releases its WebGL2 context and
 * parks its IPC subscription to reclaim GPU memory.
 */
export const WARM_HIDDEN_IDLE_MS = 60_000

// Browsers cap WebGL contexts per tab (Chrome: 16). Track active contexts across
// all mounted TerminalViews so we never exceed MAX_WEBGL_CONTEXTS (14).
let activeWebglContexts = 0

export function getActiveWebglContextCount(): number {
  return activeWebglContexts
}

export interface WarmWebglPoolOptions {
  maxWarm?: number
  idleMs?: number
  setTimer?: (fn: () => void, ms: number) => ReturnType<typeof setTimeout>
  clearTimer?: (id: ReturnType<typeof setTimeout>) => void
}

export interface WarmWebglPool {
  touchVisible(paneId: string, onEvict: () => void): void
  markHidden(paneId: string, onEvict: () => void): boolean
  evictOldestHidden(): boolean
  remove(paneId: string): void
  has(paneId: string): boolean
  size(): number
  dispose(): void
}

interface PoolEntry {
  paneId: string
  visible: boolean
  onEvict: () => void
  idleTimer: ReturnType<typeof setTimeout> | null
}

export function createWarmWebglPool(options: WarmWebglPoolOptions = {}): WarmWebglPool {
  const maxWarm = Math.max(0, options.maxWarm ?? WARM_WEBGL_POOL_SIZE)
  const idleMs = options.idleMs ?? WARM_HIDDEN_IDLE_MS
  const setTimer = options.setTimer ?? ((fn: () => void, ms: number) => setTimeout(fn, ms))
  const clearTimer = options.clearTimer ?? ((id: ReturnType<typeof setTimeout>) => clearTimeout(id))

  // Map preserves insertion order: LRU at the front, MRU at the back.
  const entries = new Map<string, PoolEntry>()

  const clearIdle = (entry: PoolEntry): void => {
    if (entry.idleTimer !== null) {
      clearTimer(entry.idleTimer)
      entry.idleTimer = null
    }
  }

  const evictEntry = (paneId: string): boolean => {
    const entry = entries.get(paneId)
    if (!entry) return false
    clearIdle(entry)
    entries.delete(paneId)
    entry.onEvict()
    return true
  }

  const evictOldestHidden = (): boolean => {
    for (const entry of entries.values()) {
      if (!entry.visible) {
        return evictEntry(entry.paneId)
      }
    }
    return false
  }

  const evictToBudget = (): void => {
    while (entries.size > maxWarm) {
      if (!evictOldestHidden()) break
    }
  }

  const touchVisible = (paneId: string, onEvict: () => void): void => {
    const existing = entries.get(paneId)
    if (existing) {
      clearIdle(existing)
      entries.delete(paneId)
    }
    entries.set(paneId, { paneId, visible: true, onEvict, idleTimer: null })
    evictToBudget()
  }

  const markHidden = (paneId: string, onEvict: () => void): boolean => {
    if (maxWarm <= 0) {
      remove(paneId)
      return false
    }
    let entry = entries.get(paneId)
    if (entry) {
      clearIdle(entry)
      entry.visible = false
      entry.onEvict = onEvict
    } else {
      entry = { paneId, visible: false, onEvict, idleTimer: null }
      entries.set(paneId, entry)
    }
    evictToBudget()
    // If evicting to budget already evicted this entry, its onEvict() callback ran.
    if (!entries.has(paneId)) return true
    if (idleMs > 0 && Number.isFinite(idleMs)) {
      entry.idleTimer = setTimer(() => {
        if (entry) entry.idleTimer = null
        evictEntry(paneId)
      }, idleMs)
    }
    return true
  }

  const remove = (paneId: string): void => {
    const entry = entries.get(paneId)
    if (!entry) return
    clearIdle(entry)
    entries.delete(paneId)
  }

  const dispose = (): void => {
    for (const entry of entries.values()) clearIdle(entry)
    entries.clear()
  }

  return {
    touchVisible,
    markHidden,
    evictOldestHidden,
    remove,
    has: (paneId: string) => entries.has(paneId),
    size: () => entries.size,
    dispose
  }
}

/** Shared application-wide warm WebGL2 LRU pool used by production TerminalPane hosts. */
export const sharedWarmWebglPool = createWarmWebglPool()

export interface TerminalWebglControllerOptions {
  terminal: Terminal
  isDisposed: () => boolean
  isHidden: () => boolean
  warmPool?: WarmWebglPool
  onContextLost?: () => void
}

export interface TerminalWebglController {
  load(): void
  release(): void
  hasAddon(): boolean
}

/**
 * Manages the per-pane @xterm/addon-webgl lifecycle, preflighting WebGL2,
 * tracking global activeWebglContexts <= MAX_WEBGL_CONTEXTS, reclaiming slots
 * from hidden warm panes before falling back to DOM, and recovering from async
 * WebGL context loss.
 */
export function createTerminalWebglController(options: TerminalWebglControllerOptions): TerminalWebglController {
  let webglAddon: WebglAddon | null = null
  let webglContextCounted = false

  const release = (): void => {
    const addon = webglAddon
    webglAddon = null
    try { addon?.dispose() } catch { /* already torn down */ }
    if (webglContextCounted) {
      activeWebglContexts--
      webglContextCounted = false
    }
  }

  const load = (): void => {
    if (webglAddon) return
    while (activeWebglContexts >= MAX_WEBGL_CONTEXTS && options.warmPool?.evictOldestHidden()) {
      // Reclaim a GPU context slot from the oldest hidden warm pane before degrading to DOM.
    }
    if (activeWebglContexts >= MAX_WEBGL_CONTEXTS) {
      console.warn(`[OXESpace] WebGL context limit reached (${MAX_WEBGL_CONTEXTS}), using DOM renderer`)
      return
    }
    if (supportsWebgl2() && !loadedWebglAddon()) {
      loadWebglAddon()
        .then(() => {
          if (options.isDisposed() || options.isHidden() || webglAddon) return
          load()
          try { options.terminal.refresh(0, options.terminal.rows - 1) } catch { /* disposed */ }
        })
        .catch((err: unknown) => {
          console.warn('[OXESpace] WebGL renderer did not load, using DOM renderer', err)
        })
      return
    }
    if (!supportsWebgl2()) {
      console.warn('[OXESpace] WebGL2 not available, using DOM renderer')
      return
    }
    try {
      const WebglAddonClass = loadedWebglAddon()!
      const addon = new WebglAddonClass()
      addon.onContextLoss(() => {
        try { addon.dispose() } catch { /* already torn down */ }
        if (webglAddon === addon) {
          webglAddon = null
          if (webglContextCounted) {
            activeWebglContexts--
            webglContextCounted = false
          }
          options.onContextLost?.()
          setTimeout(() => {
            try {
              if (!options.isDisposed()) {
                options.terminal.options.theme = { ...(options.terminal.options.theme ?? {}) }
                options.terminal.refresh(0, options.terminal.rows - 1)
              }
            } catch { /* ignore if already unmounted */ }
          }, 50)
        }
      })
      options.terminal.loadAddon(addon)
      webglAddon = addon
      activeWebglContexts++
      webglContextCounted = true
    } catch (err) {
      console.warn('[OXESpace] WebGL renderer unavailable, using DOM renderer', err)
      webglAddon = null
    }
  }

  return {
    load,
    release,
    hasAddon: () => webglAddon !== null
  }
}
