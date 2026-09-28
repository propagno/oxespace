import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export const THREAD_FONT_DEFAULT = 14
export const THREAD_FONT_MIN = 12
export const THREAD_FONT_MAX = 20

export function clampThreadFontSize(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.max(THREAD_FONT_MIN, Math.min(THREAD_FONT_MAX, Math.round(value)))
    : THREAD_FONT_DEFAULT
}

export const useThreadPrefs = create<{ fontSize: number; setFontSize: (size: number) => void }>()(persist(
  set => ({ fontSize: THREAD_FONT_DEFAULT, setFontSize: size => set({ fontSize: clampThreadFontSize(size) }) }),
  { name: 'oxe.thread-appearance', merge: (saved, current) => ({ ...current, fontSize: clampThreadFontSize((saved as { fontSize?: unknown } | null)?.fontSize) }) }
))
