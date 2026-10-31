/**
 * Warms up, while the window is idle after its first paint, only what the next click is most likely to need: the
 * chunks of the view the person used most recently, and Settings. Nothing else, so an idle window does not carry
 * every view's code. It is skipped altogether on battery, on a machine with little memory, or when the renderer
 * already uses most of its heap; each of those APIs may be missing, and a missing one never blocks the preload.
 *
 * Loaded on its own (src/components/Navigation/ModeViews.tsx imports it at idle, or when the person switches views),
 * so none of it is in the boot bundle.
 */
export type PreloadTarget = 'thread' | 'data' | 'pods' | 'post' | 'settings'
export type PreloadSkip = 'on-battery' | 'low-device-memory' | 'high-memory-use' | 'cancelled'

interface BatteryLike { charging?: boolean }
export interface PreloadEnvironment {
  navigator?: { deviceMemory?: number; getBattery?: () => Promise<BatteryLike> }
  performance?: { memory?: { usedJSHeapSize?: number; jsHeapSizeLimit?: number } }
}

const RECENT_VIEW = 'oxe.recent-view'
const PRELOAD = 'oxe.preload'

/** Remembers the view the person just opened, so the next start can warm its chunk up. */
export function rememberView(view: string): void {
  try { localStorage.setItem(RECENT_VIEW, view) } catch { /* storage blocked: nothing preloaded next time */ }
}

export function recentView(): string | null {
  try { return localStorage.getItem(RECENT_VIEW) } catch { return null }
}

/** `localStorage['oxe.preload'] = 'off'` turns the idle preload off (measuring its memory cost, a slow machine). */
export function preloadDisabled(): boolean {
  try { return localStorage.getItem(PRELOAD) === 'off' } catch { return false }
}

/** `navigator.deviceMemory` is rounded and capped at 8 GB; 4 or less is a machine where idle memory matters. */
export const LOW_DEVICE_MEMORY_GB = 4
/** Share of the renderer's heap limit above which the preload would only add pressure. */
export const HIGH_HEAP_USE = 0.7

const LOADERS: Record<PreloadTarget, () => Promise<unknown>> = {
  thread: () => Promise.all([import('../components/Threads/ThreadGrid'), import('../components/Threads/ThreadSidebar')]),
  data: () => Promise.all([import('../components/OxeQuery/OxeQuerySidebar'), import('../components/OxeQuery/OxeQueryView')]),
  pods: () => Promise.all([import('../components/OxePod/OxePodSidebar'), import('../components/OxePod/OxePodView')]),
  post: () => Promise.all([import('../components/OxePost/OxePostSidebar'), import('../components/OxePost/OxePostView')]),
  settings: () => import('../components/Settings/SettingsCenter')
}

/** The most recent view, when it is one that loads lazily (Code is in the boot bundle), then Settings. */
export function preloadTargets(recent: string | null): PreloadTarget[] {
  const view = recent === 'thread' || recent === 'data' || recent === 'pods' || recent === 'post' ? recent : null
  return view ? [view, 'settings'] : ['settings']
}

/** Why the preload should not run on this machine right now, or null when it may. */
export async function preloadSkipReason(env: PreloadEnvironment): Promise<PreloadSkip | null> {
  try {
    const memory = env.navigator?.deviceMemory
    if (typeof memory === 'number' && memory <= LOW_DEVICE_MEMORY_GB) return 'low-device-memory'
  } catch { /* not readable: no reason to skip */ }
  try {
    const heap = env.performance?.memory
    if (heap?.usedJSHeapSize && heap.jsHeapSizeLimit && heap.usedJSHeapSize / heap.jsHeapSizeLimit > HIGH_HEAP_USE) return 'high-memory-use'
  } catch { /* not readable */ }
  try {
    if (typeof env.navigator?.getBattery === 'function') {
      const battery = await env.navigator.getBattery()
      if (battery?.charging === false) return 'on-battery'
    }
  } catch { /* no battery API or refused */ }
  return null
}

const mark = (name: string): void => { try { performance.mark(name) } catch { /* timeline unavailable */ } }

/**
 * Unless switched off, loads the targets for the most recent view one after another, checking `cancelled` before each, and leaves a `oxe:preload:<outcome>` mark
 * on the timeline (what loaded, or why nothing did). Returns what it loaded.
 */
export async function runIdlePreload(cancelled: () => boolean, options: {
  recent?: string | null; env?: PreloadEnvironment; loaders?: Partial<Record<PreloadTarget, () => Promise<unknown>>>
} = {}): Promise<PreloadTarget[]> {
  if (preloadDisabled()) { mark('oxe:preload:off'); return [] }
  const recent = options.recent === undefined ? recentView() : options.recent
  const env = options.env ?? { navigator: navigator as PreloadEnvironment['navigator'], performance: performance as PreloadEnvironment['performance'] }
  const skip = cancelled() ? 'cancelled' : await preloadSkipReason(env)
  if (skip) { mark(`oxe:preload:skipped:${skip}`); return [] }
  const loaded: PreloadTarget[] = []
  for (const target of preloadTargets(recent)) {
    if (cancelled()) break
    await (options.loaders?.[target] ?? LOADERS[target])().catch(() => undefined)
    loaded.push(target)
  }
  mark(`oxe:preload:${loaded.join(',') || 'none'}`)
  return loaded
}
