import type { SlashCommandDefinition } from '../../shared/types/slash'

export const SLASH_COMMANDS: SlashCommandDefinition[] = [
  {
    id: 'clear',
    label: '/clear',
    hint: 'Ctrl+L',
    description: 'Clear the terminal screen (keeps the session).'
  },
  {
    id: 'new',
    label: '/new',
    hint: 'Reset',
    description: 'Restart the terminal with a clean session (no resume).',
    destructive: true
  },
  {
    id: 'restart',
    label: '/restart',
    hint: 'Ctrl+R',
    description: 'Restart the terminal keeping the current agent.'
  },
  {
    id: 'fork',
    label: '/fork',
    hint: 'Duplicate',
    description: 'Create a new pane in the workspace with the same agent.'
  },
  {
    id: 'stop',
    label: '/stop',
    hint: 'Stop',
    description: 'Stop the process running in this pane.'
  },
  {
    id: 'agent',
    label: '/agent',
    hint: 'Switch agent',
    description: 'Set the AI agent used in this pane.',
    requiresArgument: true,
    argumentPlaceholder: 'agent name'
  },
  {
    id: 'rename',
    label: '/rename',
    hint: 'Rename',
    description: 'Rename the pane.',
    requiresArgument: true,
    argumentPlaceholder: 'new name'
  },
  {
    id: 'bg',
    label: '/bg',
    hint: 'Background',
    description: 'Run a command in the background (build, test, watch) without holding the pane.',
    requiresArgument: true,
    argumentPlaceholder: 'npm run build'
  },
  {
    id: 'worktree',
    label: '/worktree',
    hint: 'Worktrees',
    description: 'Open the git worktree picker for this pane.'
  },
  {
    id: 'mcp',
    label: '/mcp',
    hint: 'MCP servers',
    description: 'Manage Model Context Protocol servers (Anthropic).'
  },
  {
    id: 'help',
    label: '/help',
    hint: 'Help',
    description: 'Show the list of available commands.'
  }
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
    hint: skill.source === 'workspace' ? 'Skill (workspace)' : 'Skill',
    description: skill.description || '(no description)',
    requiresArgument: skill.body.includes('{{argument}}'),
    argumentPlaceholder: 'optional argument',
    skillName: skill.name
  }
}
