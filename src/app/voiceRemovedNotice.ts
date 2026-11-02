// F34: OXEVoice is gone from 1.4. Someone who used it would otherwise just find the mic missing, so the first start
// after the update says so once, and points to the operating system's own dictation. Nobody who never used voice
// sees anything: the notice keys off the preferences OXEVoice left in this window's storage.
import { i18n } from '../i18n'
import { openExternalLink } from '../lib/externalLinks'
import { toast } from '../ui/Toast'

/** What OXEVoice stored in the renderer (model size, push-to-talk hotkey). Deleted once the notice shows. */
export const VOICE_PREFS_KEY = 'oxe-voice-prefs'

export const DICTATION_HELP = {
  windows: 'https://support.microsoft.com/windows/use-voice-typing-to-talk-instead-of-type-on-your-pc-fec94565-c4bd-329d-e59a-af033fa5689f',
  mac: 'https://support.apple.com/guide/mac-help/use-dictation-mh40584/mac',
  linux: 'https://help.gnome.org/users/gnome-help/stable/a11y-dictation.html.en'
} as const

/** The system dictation help page for this platform. */
export function dictationHelpUrl(nav: Pick<Navigator, 'platform' | 'userAgent'> | undefined = typeof navigator === 'undefined' ? undefined : navigator): string {
  const platform = `${nav?.platform ?? ''} ${nav?.userAgent ?? ''}`
  if (/Mac|iPhone|iPad/i.test(platform)) return DICTATION_HELP.mac
  if (/Win/i.test(platform)) return DICTATION_HELP.windows
  return DICTATION_HELP.linux
}

/** Shows the notice once when OXEVoice's preferences are still stored, then deletes them. Never throws. */
export function showVoiceRemovedNotice(): boolean {
  let stored: boolean
  try { stored = localStorage.getItem(VOICE_PREFS_KEY) !== null } catch { return false }
  if (!stored) return false
  try { localStorage.removeItem(VOICE_PREFS_KEY) } catch { /* Storage went away: the notice still shows this once. */ }
  const t = (key: string): string => i18n.t(`voiceRemoved.${key}`, { ns: 'common' })
  toast({
    title: t('title'),
    description: t('body'),
    intent: 'info',
    duration: 0,
    action: { label: t('action'), run: () => { void openExternalLink(dictationHelpUrl(), { source: 'app' }) } }
  })
  return true
}
