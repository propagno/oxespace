// Settings opens from the boot bundle: the frame is eager (SettingsCenter.tsx) and its pages are one lazy chunk,
// preloaded at idle (src/lib/idlePreload.ts reads SETTINGS_CHUNK from here).
export { SettingsCenter, SETTINGS_CHUNK } from './SettingsCenter'
