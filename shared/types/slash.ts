export type SlashCommandId =
  | 'clear'
  | 'restart'
  | 'fork'
  | 'new'
  | 'agent'
  | 'model'
  | 'help'
  | 'stop'
  | 'rename'

export interface SlashCommandDefinition {
  id: SlashCommandId
  label: string
  hint: string
  description: string
  requiresArgument?: boolean
  argumentPlaceholder?: string
  destructive?: boolean
}
