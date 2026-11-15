import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { isSendKeyMode, type SendKeyMode } from '../components/Threads/sendKey'

export const THREAD_FONT_DEFAULT = 14
export const THREAD_FONT_MIN = 12
export const THREAD_FONT_MAX = 20
export const SEND_KEY_DEFAULT: SendKeyMode = 'enter'

export function clampThreadFontSize(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.max(THREAD_FONT_MIN, Math.min(THREAD_FONT_MAX, Math.round(value)))
    : THREAD_FONT_DEFAULT
}

interface ThreadPrefs {
  fontSize: number
  setFontSize: (size: number) => void
  /** Which key sends a message and answers a question (OXE-131); kept across restarts. */
  sendKey: SendKeyMode
  setSendKey: (mode: SendKeyMode) => void
}

export const useThreadPrefs = create<ThreadPrefs>()(persist(
  set => ({
    fontSize: THREAD_FONT_DEFAULT, setFontSize: size => set({ fontSize: clampThreadFontSize(size) }),
    sendKey: SEND_KEY_DEFAULT, setSendKey: mode => set({ sendKey: isSendKeyMode(mode) ? mode : SEND_KEY_DEFAULT })
  }),
  {
    name: 'oxe.thread-appearance',
    partialize: state => ({ fontSize: state.fontSize, sendKey: state.sendKey }),
    merge: (saved, current) => {
      const value = saved as { fontSize?: unknown; sendKey?: unknown } | null
      return { ...current, fontSize: clampThreadFontSize(value?.fontSize), sendKey: isSendKeyMode(value?.sendKey) ? value.sendKey : SEND_KEY_DEFAULT }
    }
  }
))
