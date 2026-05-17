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
    id: 'model',
    label: '/model',
    hint: 'Trocar modelo',
    description: 'Abre o seletor de modelo de IA para este pane.',
    requiresArgument: false
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
    id: 'help',
    label: '/help',
    hint: 'Ajuda',
    description: 'Mostra a lista de comandos disponíveis.'
  }
]

export function findSlashCommand(query: string): SlashCommandDefinition | null {
  const normalized = query.trim().replace(/^\//, '').toLowerCase()
  if (!normalized) return null
  return SLASH_COMMANDS.find((cmd) => cmd.id === normalized) ?? null
}

export function filterSlashCommands(query: string): SlashCommandDefinition[] {
  const normalized = query.trim().replace(/^\//, '').toLowerCase()
  if (!normalized) return SLASH_COMMANDS
  return SLASH_COMMANDS.filter((cmd) =>
    cmd.id.startsWith(normalized) || cmd.label.toLowerCase().includes(normalized) || cmd.description.toLowerCase().includes(normalized)
  )
}
