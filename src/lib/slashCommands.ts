import type { SlashCommandDefinition } from '../../shared/types/slash'

export const SLASH_COMMANDS: SlashCommandDefinition[] = [
  {
    id: 'clear',
    label: '/clear',
    hint: 'Ctrl+L',
    description: 'Limpa a tela do terminal (preserva sessão).'
  },
  {
    id: 'new',
    label: '/new',
    hint: 'Reset',
    description: 'Reinicia o terminal com uma sessão limpa (sem resume).',
    destructive: true
  },
  {
    id: 'restart',
    label: '/restart',
    hint: 'Ctrl+R',
    description: 'Reinicia o terminal mantendo o agente atual.'
  },
  {
    id: 'fork',
    label: '/fork',
    hint: 'Duplicar',
    description: 'Cria um novo pane no workspace com o mesmo agente.'
  },
  {
    id: 'stop',
    label: '/stop',
    hint: 'Parar',
    description: 'Encerra o processo em execução neste pane.'
  },
  {
    id: 'agent',
    label: '/agent',
    hint: 'Trocar agente',
    description: 'Define o agente de IA usado neste pane.',
    requiresArgument: true,
    argumentPlaceholder: 'nome do agente'
  },
  {
    id: 'rename',
    label: '/rename',
    hint: 'Renomear',
    description: 'Renomeia o pane.',
    requiresArgument: true,
    argumentPlaceholder: 'novo nome'
  },
  {
    id: 'bg',
    label: '/bg',
    hint: 'Background',
    description: 'Executa um comando em background (build, test, watch) sem ocupar o pane.',
    requiresArgument: true,
    argumentPlaceholder: 'npm run build'
  },
  {
    id: 'worktree',
    label: '/worktree',
    hint: 'Worktrees',
    description: 'Abre o seletor de git worktrees para este pane.'
  },
  {
    id: 'mcp',
    label: '/mcp',
    hint: 'MCP servers',
    description: 'Gerencia servidores Model Context Protocol (Anthropic).'
  },
  {
    id: 'help',
    label: '/help',
    hint: 'Ajuda',
    description: 'Mostra a lista de comandos disponíveis.'
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
    description: skill.description || '(sem descrição)',
    requiresArgument: skill.body.includes('{{argument}}'),
    argumentPlaceholder: 'argumento opcional',
    skillName: skill.name
  }
}
