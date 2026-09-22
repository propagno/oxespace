import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export const SIDEBAR_WIDTH = 248
export const SIDEBAR_RAIL_WIDTH = 56
export const SIDEBAR_MIN_WIDTH = 240
export const SIDEBAR_MAX_WIDTH = 360
export const SIDEBAR_RESIZE_STEP = 8

export function navigationWidth(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(SIDEBAR_MIN_WIDTH, Math.min(SIDEBAR_MAX_WIDTH, value)) : SIDEBAR_WIDTH
}

function legacyThreadWidth(): number {
  try {
    const value = JSON.parse(localStorage.getItem('oxe.thread-navigation') ?? 'null')?.state?.width
    const width = navigationWidth(value)
    if (typeof value === 'number' && Number.isFinite(value) && localStorage.getItem('oxe.navigation') === null) {
      localStorage.setItem('oxe.navigation', JSON.stringify({ state: { width, expanded: {} }, version: 0 }))
    }
    return width
  } catch { return SIDEBAR_WIDTH }
}

export const useNavigationPrefs = create<{
  width: number; expanded: Record<string, boolean>
  setWidth: (width: number) => void; setExpanded: (id: string, expanded: boolean) => void
}>()(persist((set) => ({
  width: legacyThreadWidth(), expanded: {},
  setWidth: width => set({ width: navigationWidth(width) }),
  setExpanded: (id, expanded) => set(state => ({ expanded: { ...state.expanded, [id]: expanded } }))
}), { name: 'oxe.navigation', merge: (saved, current) => {
  const value = saved as { width?: unknown; expanded?: Record<string, unknown> } | null
  return { ...current, width: navigationWidth(value?.width ?? current.width),
    expanded: Object.fromEntries(Object.entries(value?.expanded ?? {}).filter(([, v]) => typeof v === 'boolean')) as Record<string, boolean> }
} }))
