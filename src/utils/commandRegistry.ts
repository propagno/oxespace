import { useSyncExternalStore } from 'react'
import type { LucideIcon } from 'lucide-react'

/** One command the palette (CommandMenu) lists. */
export interface CommandPaletteAction {
  id: string
  title: string
  subtitle?: string
  disabled?: boolean
  /** Lucide icon component (optional — falls back to a category-derived dot). */
  icon?: LucideIcon
  /** Group label shown as a sticky header. Defaults to "General". */
  category?: string
  /** Extra search terms (synonyms) that should match this command. */
  keywords?: string[]
  /** A keybinding id from src/keyboard/keybindings.ts (follows the user's overrides) or a literal chord; shown as key caps. */
  shortcut?: string
  run: () => void
}

/** What a feature module contributes to the command palette without App knowing about it. */
export interface ContributedCommand {
  id: string
  label: string
  detail?: string
  icon?: LucideIcon
  keywords?: string[]
  /** Palette group heading. */
  category: string
  disabled?: boolean
  /** Same as CommandPaletteAction.shortcut. */
  shortcut?: string
  run: () => void
}

const sources = new Map<string, ContributedCommand[]>()
const listeners = new Set<() => void>()
let snapshot: CommandPaletteAction[] = []

const rebuild = (): void => {
  snapshot = [...sources.values()].flat().map(command => ({
    id: command.id, title: command.label, subtitle: command.detail, icon: command.icon, category: command.category,
    keywords: command.keywords, disabled: command.disabled, shortcut: command.shortcut, run: command.run
  }))
  listeners.forEach(listener => listener())
}

/** Replaces everything a source contributed earlier. Returns a function that removes it. */
export function registerCommands(source: string, commands: ContributedCommand[]): () => void {
  sources.set(source, commands)
  rebuild()
  return () => { sources.delete(source); rebuild() }
}

/** Runs a contributed command by id, as the palette would. False when it is not registered or is disabled now. */
export function runCommand(id: string): boolean {
  const command = snapshot.find(item => item.id === id)
  if (!command || command.disabled) return false
  command.run()
  return true
}

/** Palette actions contributed by feature modules, stable between changes. */
export function useContributedCommands(): CommandPaletteAction[] {
  return useSyncExternalStore(
    listener => { listeners.add(listener); return () => { listeners.delete(listener) } },
    () => snapshot
  )
}
