export type SlashCommandId =
  | 'clear'
  | 'restart'
  | 'fork'
  | 'new'
  | 'agent'
  | 'help'
  | 'stop'
  | 'rename'
  | 'bg'
  | 'worktree'
  | 'mcp'
  | 'integration'

export interface SlashCommandDefinition {
  id: SlashCommandId | string  // built-in id OR custom skill name
  label: string
  hint: string
  description: string
  requiresArgument?: boolean
  argumentPlaceholder?: string
  destructive?: boolean
  /** When set, this is a user-defined skill (markdown), not a built-in command. */
  skillName?: string
}
