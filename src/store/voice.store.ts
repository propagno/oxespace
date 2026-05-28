import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { VoiceModelSize, VoicePreferences } from '../../shared/types/voice'

/**
 * OXEVoice user preferences. Persisted to localStorage because OXESpace has no
 * global settings backend yet — when one lands, migrate these keys into it.
 */

// OXEVoice is Brazilian-Portuguese only — the language is fixed, not a user
// choice (auto-detect mixed pt/en on accented speech). Kept as a constant
// here so the rest of the app can read a single source of truth.
export const VOICE_LANGUAGE = 'pt'

const DEFAULT_PREFS: VoicePreferences = {
  language: VOICE_LANGUAGE,
  modelSize: 'base',
  pttHotkey: 'Ctrl+Shift+Space',
  insertMode: 'terminal'
}

interface VoiceStoreState extends VoicePreferences {
  setModelSize: (size: VoiceModelSize) => void
  setPttHotkey: (hotkey: string) => void
}

export const useVoiceStore = create<VoiceStoreState>()(
  persist(
    (set) => ({
      ...DEFAULT_PREFS,
      setModelSize: (modelSize) => set({ modelSize }),
      setPttHotkey: (pttHotkey) => set({ pttHotkey })
    }),
    {
      name: 'oxe-voice-prefs',
      version: 1,
      // Existing installs persisted language:'auto' — force pt-BR on upgrade.
      migrate: (state) => ({ ...(state as VoicePreferences), language: VOICE_LANGUAGE })
    }
  )
)
