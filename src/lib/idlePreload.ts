/**
 * Warms up, while the window is idle after its first paint, only what the next click is most likely to need:
 * Settings and the status bar's usage chip (small, always) and the chunks of the view the person used most recently. The view is preloaded only on a
 * machine that reports at least 8 GB (`navigator.deviceMemory`; when it is missing, the view is not preloaded), is not
 * on battery, and whose renderer heap is at most 70% used; each of those APIs may be missing or throw.
 *
 * Loaded on its own (src/components/Navigation/ModeViews.tsx imports it at idle, or when the person switches views),
 * so none of it is in the boot bundle. The chunks it loads are the ones the views render from (src/lib/chunk.ts), so
 * a preloaded view opens without suspending.
 */
export type PreloadTarget = 'thread' | 'data' | 'pods' | 'post' | 'settings'
export type ViewSkip = 'no-recent-view' | 'device-memory-unknown' | 'low-device-memory' | 'high-memory-use' | 'on-battery'

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

/** `navigator.deviceMemory` is rounded and capped at 8 GB: only its top value preloads a view. */
export const VIEW_PRELOAD_MIN_MEMORY_GB = 8
/** Share of the renderer's heap limit above which the preload would only add pressure. */
export const HIGH_HEAP_USE = 0.7

const LOADERS: Record<PreloadTarget, () => Promise<unknown>> = {
  thread: () => import('../components/Navigation/ModeViews').then(m => m.VIEW_CHUNKS.thread.load()),
  data: () => import('../components/Navigation/ModeViews').then(m => m.VIEW_CHUNKS.data.load()),
  pods: () => import('../components/Navigation/ModeViews').then(m => m.VIEW_CHUNKS.pods.load()),
  post: () => import('../components/Navigation/ModeViews').then(m => m.VIEW_CHUNKS.post.load()),
  // With Settings, the usage chip OxeChat's status bar shows: loaded at its first switch it cost the cold first
  // content ~40 ms (F7.3); loaded here it renders at once (lazyFrom).
  settings: () => Promise.all([import('../components/Settings/SettingsHost').then(m => m.preloadSettings()), import('../components/Workspace/usageChunk').then(m => m.USAGE_CHUNK.load())])
}

/** The most recent view, when it is one that loads lazily (Code is in the boot bundle). */
export function lazyView(recent: string | null): Exclude<PreloadTarget, 'settings'> | null {
  return recent === 'thread' || recent === 'data' || recent === 'pods' || recent === 'post' ? recent : null
}

/** Why the most recent view's chunks should not be preloaded on this machine right now, or null when they may. */
export async function viewSkipReason(env: PreloadEnvironment): Promise<Exclude<ViewSkip, 'no-recent-view'> | null> {
  try {
    const memory = env.navigator?.deviceMemory
    if (typeof memory !== 'number') return 'device-memory-unknown'
    if (memory < VIEW_PRELOAD_MIN_MEMORY_GB) return 'low-device-memory'
  } catch { return 'device-memory-unknown' }
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

/** What to preload: Settings, and the most recent view first when this machine allows it. */
export async function preloadTargets(recent: string | null, env: PreloadEnvironment): Promise<{ targets: PreloadTarget[]; viewSkipped: ViewSkip | null }> {
  const view = lazyView(recent)
  const viewSkipped = view ? await viewSkipReason(env) : 'no-recent-view'
  return { targets: view && !viewSkipped ? [view, 'settings'] : ['settings'], viewSkipped }
}

const mark = (name: string): void => { try { performance.mark(name) } catch { /* timeline unavailable */ } }

/**
 * Unless switched off, loads the targets one after another, checking `cancelled` before each, and leaves marks on the
 * timeline: `oxe:preload:<what loaded>`, and `oxe:preload:view-skipped:<why>` when the view was left out.
 */
export async function runIdlePreload(cancelled: () => boolean, options: {
  recent?: string | null; env?: PreloadEnvironment; loaders?: Partial<Record<PreloadTarget, () => Promise<unknown>>>
} = {}): Promise<PreloadTarget[]> {
  if (preloadDisabled()) { mark('oxe:preload:off'); return [] }
  const recent = options.recent === undefined ? recentView() : options.recent
  const env = options.env ?? { navigator: navigator as PreloadEnvironment['navigator'], performance: performance as PreloadEnvironment['performance'] }
  const { targets, viewSkipped } = await preloadTargets(recent, env)
  if (viewSkipped) mark(`oxe:preload:view-skipped:${viewSkipped}`)
  const loaded: PreloadTarget[] = []
  for (const target of targets) {
    if (cancelled()) break
    await (options.loaders?.[target] ?? LOADERS[target])().catch(() => undefined)
    loaded.push(target)
  }
  mark(`oxe:preload:${loaded.join(',') || 'none'}`)
  return loaded
}
