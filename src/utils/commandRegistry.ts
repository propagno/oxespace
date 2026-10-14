import { useSyncExternalStore } from 'react'
import type { LucideIcon } from 'lucide-react'
import type { CommandPaletteAction } from '../components/CommandPalette/CommandPalette'

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
  run: () => void
}

const sources = new Map<string, ContributedCommand[]>()
const listeners = new Set<() => void>()
let snapshot: CommandPaletteAction[] = []

const rebuild = (): void => {
  snapshot = [...sources.values()].flat().map(command => ({
    id: command.id, title: command.label, subtitle: command.detail, icon: command.icon, category: command.category,
    keywords: command.keywords, disabled: command.disabled, run: command.run
  }))
  listeners.forEach(listener => listener())
}

/** Replaces everything a source contributed earlier. Returns a function that removes it. */
export function registerCommands(source: string, commands: ContributedCommand[]): () => void {
  sources.set(source, commands)
  rebuild()
  return () => { sources.delete(source); rebuild() }
}

/** Palette actions contributed by feature modules, stable between changes. */
export function useContributedCommands(): CommandPaletteAction[] {
  return useSyncExternalStore(
    listener => { listeners.add(listener); return () => { listeners.delete(listener) } },
    () => snapshot
  )
}
