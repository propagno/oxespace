import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export const useNavigationPrefs = create<{
  width: number; expanded: Record<string, boolean>
  setWidth: (width: number) => void; setExpanded: (id: string, expanded: boolean) => void
}>()(persist((set) => ({
  width: 280, expanded: {},
  setWidth: width => set({ width: Number.isFinite(width) ? Math.max(240, Math.min(360, width)) : 280 }),
  setExpanded: (id, expanded) => set(state => ({ expanded: { ...state.expanded, [id]: expanded } }))
}), { name: 'oxe.navigation', merge: (saved, current) => {
  const value = saved as { width?: unknown; expanded?: Record<string, unknown> } | null
  return { ...current, width: typeof value?.width === 'number' && Number.isFinite(value.width) ? Math.max(240, Math.min(360, value.width)) : 280,
    expanded: Object.fromEntries(Object.entries(value?.expanded ?? {}).filter(([, v]) => typeof v === 'boolean')) as Record<string, boolean> }
} }))
