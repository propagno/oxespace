import { Activity, ArrowUpCircle, Bell, Bot, Bug, Info, Keyboard, Mic, Palette, Settings2, ShieldCheck, Smartphone, SquareTerminal, type LucideIcon } from 'lucide-react'
import { OPEN_ABOUT_EVENT } from '../components/About/AboutHost'
import { OPEN_REPORT_PROBLEM_EVENT } from '../components/Diagnostics/ReportProblemHost'
import { OPEN_SHORTCUT_GUIDE_EVENT } from '../components/Keyboard/ShortcutGuideHost'
import { i18n } from '../i18n'
import { useUIStore, type SettingsPageId } from '../store/ui.store'
import { registerCommands } from '../utils/commandRegistry'
import { commandText, registerTranslated, tCommand } from './commandText'

/** Search words in English, so they match in any language; the label, detail and group match in the language on screen. */
const PAGES: Array<{ page: SettingsPageId; icon: LucideIcon; keywords?: string[] }> = [
  { page: 'general', icon: Settings2, keywords: ['preferences', 'workspaces'] },
  { page: 'providers', icon: Bot, keywords: ['claude', 'codex', 'copilot', 'cli', 'providers'] },
  { page: 'appearance', icon: Palette, keywords: ['theme', 'light', 'dark'] },
  { page: 'terminal', icon: SquareTerminal, keywords: ['font', 'cursor', 'scrollback'] },
  { page: 'keyboard', icon: Keyboard, keywords: ['shortcuts', 'keybindings', 'hotkeys'] },
  { page: 'voice', icon: Mic, keywords: ['microphone', 'dictation', 'push to talk'] },
  { page: 'notifications', icon: Bell, keywords: ['alerts', 'sounds'] },
  { page: 'updates', icon: ArrowUpCircle, keywords: ['version', 'download'] },
  { page: 'policy', icon: ShieldCheck, keywords: ['rules', 'block', 'deny'] },
  { page: 'devices', icon: Smartphone, keywords: ['phone', 'mobile', 'android', 'pair', 'remote'] },
  { page: 'diagnostics', icon: Activity, keywords: ['health', 'logs', 'troubleshooting'] }
]

/** Every Settings page and the shortcut guide, in the palette. Loaded at boot; Settings itself stays lazy. */
registerTranslated(() => registerCommands('settings', [
  ...PAGES.map(({ page, icon, keywords }) => ({
    id: `settings.${page}`, icon,
    ...commandText('Settings', `settings.${page}`, { keywords: ['settings', 'preferences', i18n.t(`center.pages.${page}.label`, { ns: 'settings' }), ...(keywords ?? [])] }),
    run: () => useUIStore.getState().openSettingsPage(page)
  })),
  { id: 'help.shortcuts', ...commandText('Help', 'help.shortcuts', { keywords: ['keys', 'hotkeys', 'cheatsheet'] }), icon: Keyboard, shortcut: 'help.shortcuts',
    // After the palette closes, so the guide gets focus.
    run: () => { requestAnimationFrame(() => window.dispatchEvent(new CustomEvent(OPEN_SHORTCUT_GUIDE_EVENT))) } },
  // Builds a GitHub issue to read and edit; nothing is sent unless the person opens or copies it.
  { id: 'help.report-problem', ...commandText('Help', 'help.report-problem', { keywords: ['bug', 'issue', 'feedback', 'github', 'diagnostics', 'support'] }), icon: Bug,
    run: () => { requestAnimationFrame(() => window.dispatchEvent(new CustomEvent(OPEN_REPORT_PROBLEM_EVENT))) } },
  // The version, channel and build of this copy, its license and links; the details copy into a support message.
  // The English words match in any language; the translated ones ("sobre", "versão"…) in the language on screen.
  { id: 'help.about', icon: Info,
    ...commandText('Help', 'help.about', { keywords: ['about', 'version', 'build', 'license', 'electron', 'release', ...tCommand('aboutKeywords').split(/\s+/).filter(Boolean)] }),
    run: () => { requestAnimationFrame(() => window.dispatchEvent(new CustomEvent(OPEN_ABOUT_EVENT))) } }
]))
