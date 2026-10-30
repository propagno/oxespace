import { Activity, ArrowUpCircle, Bell, Bot, Bug, Keyboard, Mic, Palette, Settings2, ShieldCheck, SquareTerminal, type LucideIcon } from 'lucide-react'
import { OPEN_REPORT_PROBLEM_EVENT } from '../components/Diagnostics/ReportProblemHost'
import { OPEN_SHORTCUT_GUIDE_EVENT } from '../components/Keyboard/ShortcutGuideHost'
import { useUIStore, type SettingsPageId } from '../store/ui.store'
import { registerCommands } from '../utils/commandRegistry'

const PAGES: Array<{ page: SettingsPageId; label: string; icon: LucideIcon; keywords?: string[] }> = [
  { page: 'general', label: 'General', icon: Settings2, keywords: ['preferences', 'workspaces'] },
  { page: 'providers', label: 'Agents', icon: Bot, keywords: ['claude', 'codex', 'copilot', 'cli', 'providers'] },
  { page: 'appearance', label: 'Appearance', icon: Palette, keywords: ['theme', 'light', 'dark'] },
  { page: 'terminal', label: 'Terminal', icon: SquareTerminal, keywords: ['font', 'cursor', 'scrollback'] },
  { page: 'keyboard', label: 'Keyboard', icon: Keyboard, keywords: ['shortcuts', 'keybindings', 'hotkeys'] },
  { page: 'voice', label: 'Voice', icon: Mic, keywords: ['microphone', 'dictation', 'push to talk'] },
  { page: 'notifications', label: 'Notifications', icon: Bell, keywords: ['alerts', 'sounds'] },
  { page: 'updates', label: 'Updates', icon: ArrowUpCircle, keywords: ['version', 'download'] },
  { page: 'policy', label: 'Policy', icon: ShieldCheck, keywords: ['rules', 'block', 'deny'] },
  { page: 'diagnostics', label: 'Diagnostics', icon: Activity, keywords: ['health', 'logs', 'troubleshooting'] }
]

/** Every Settings page and the shortcut guide, in the palette. Loaded at boot; Settings itself stays lazy. */
registerCommands('settings', [
  ...PAGES.map(({ page, label, icon, keywords }) => ({
    id: `settings.${page}`, label: `Settings: ${label}`, icon, category: 'Settings', keywords: ['settings', 'preferences', ...(keywords ?? [])],
    run: () => useUIStore.getState().openSettingsPage(page)
  })),
  { id: 'help.shortcuts', label: 'Show keyboard shortcuts', icon: Keyboard, category: 'Help', keywords: ['keys', 'hotkeys', 'cheatsheet'], shortcut: 'help.shortcuts',
    // After the palette closes, so the guide gets focus.
    run: () => { requestAnimationFrame(() => window.dispatchEvent(new CustomEvent(OPEN_SHORTCUT_GUIDE_EVENT))) } },
  // Builds a GitHub issue to read and edit; nothing is sent unless the person opens or copies it.
  { id: 'help.report-problem', label: 'Report a problem', icon: Bug, category: 'Help', keywords: ['bug', 'issue', 'feedback', 'github', 'diagnostics', 'support'],
    run: () => { requestAnimationFrame(() => window.dispatchEvent(new CustomEvent(OPEN_REPORT_PROBLEM_EVENT))) } }
])
