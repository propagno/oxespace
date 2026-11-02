import { chunk, lazyFrom } from '../../lib/chunk'

// Settings stays out of the boot bundle: its frame (SettingsCenter.tsx) and its pages are two lazy chunks, both
// warmed at idle (src/lib/idlePreload.ts calls preloadSettings), so a click on Settings still opens without waiting.
export const SETTINGS_FRAME = chunk(() => import('./SettingsCenter'))
export const SettingsCenter = lazyFrom(SETTINGS_FRAME, module => module.SettingsCenter)

/** Loads the frame, then its pages. */
export async function preloadSettings(): Promise<void> {
  const frame = await SETTINGS_FRAME.load()
  await frame.SETTINGS_CHUNK.load()
}
