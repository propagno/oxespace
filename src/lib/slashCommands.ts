import type { SlashCommandDefinition } from '../../shared/types/slash'
import { i18n } from '../i18n'

type SlashKey = 'clear' | 'new' | 'restart' | 'fork' | 'stop' | 'agent' | 'rename' | 'bg' | 'worktree' | 'mcp' | 'integration' | 'help'
const tSlash = (key: string): string => (i18n.t as unknown as (key: string, options: object) => string)(`slash.${key}`, { ns: 'code' })

/**
 * A built-in slash command. The label is the command itself; the hint, description and argument placeholder are read
 * in the interface language each time they are used. A hint that is a shortcut (Ctrl+L) stays as written.
 */
function slash(id: SlashKey, options: { shortcut?: string; requiresArgument?: boolean; argument?: 'catalog' | 'as-is'; example?: string; destructive?: boolean } = {}): SlashCommandDefinition {
  const { shortcut, requiresArgument, argument, example, destructive } = options
  // Getters, not values: spreading would read them once, in the language of the first render.
  return {
    id,
    label: `/${id}`,
    requiresArgument,
    destructive,
    get hint() { return shortcut ?? tSlash(`${id}.hint`) },
    get description() { return tSlash(`${id}.description`) },
    get argumentPlaceholder() { return argument === 'as-is' ? example : argument ? tSlash(`${id}.argument`) : undefined }
  }
}

export const SLASH_COMMANDS: SlashCommandDefinition[] = [
  slash('clear', { shortcut: 'Ctrl+L' }),
  slash('new', { destructive: true }),
  slash('restart', { shortcut: 'Ctrl+R' }),
  slash('fork'),
  slash('stop'),
  slash('agent', { requiresArgument: true, argument: 'catalog' }),
  slash('rename', { requiresArgument: true, argument: 'catalog' }),
  slash('bg', { requiresArgument: true, argument: 'as-is', example: 'npm run build' }),
  slash('worktree'),
  slash('mcp'),
  slash('integration', { requiresArgument: false, argument: 'catalog' }),
  slash('help')
]

import type { SkillDefinition } from '../../shared/types/skill'

export function findSlashCommand(query: string, skills: SkillDefinition[] = []): SlashCommandDefinition | null {
  const normalized = query.trim().replace(/^\//, '').toLowerCase()
  if (!normalized) return null
  const builtIn = SLASH_COMMANDS.find((cmd) => cmd.id === normalized)
  if (builtIn) return builtIn
  const skill = skills.find((s) => s.name.toLowerCase() === normalized)
  return skill ? skillToCommand(skill) : null
}

export function filterSlashCommands(query: string, skills: SkillDefinition[] = []): SlashCommandDefinition[] {
  const merged = [...SLASH_COMMANDS, ...skills.filter((s) => !s.hidden).map(skillToCommand)]
  const normalized = query.trim().replace(/^\//, '').toLowerCase()
  if (!normalized) return merged
  return merged.filter((cmd) =>
    String(cmd.id).startsWith(normalized) || cmd.label.toLowerCase().includes(normalized) || cmd.description.toLowerCase().includes(normalized)
  )
}

function skillToCommand(skill: SkillDefinition): SlashCommandDefinition {
  return {
    id: skill.name,
    label: `/${skill.name}`,
    hint: skill.source === 'workspace' ? tSlash('skill.workspaceHint') : tSlash('skill.hint'),
    description: skill.description || tSlash('skill.noDescription'),
    requiresArgument: skill.body.includes('{{argument}}'),
    argumentPlaceholder: tSlash('skill.argument'),
    skillName: skill.name
  }
}
