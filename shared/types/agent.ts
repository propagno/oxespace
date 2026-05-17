export type AgentProvider = 'claude' | 'copilot' | 'gh-copilot' | 'codex' | 'gemini' | 'cursor' | 'oxe' | 'custom'

export const BUILTIN_PROVIDERS = ['claude', 'copilot', 'codex', 'gemini', 'cursor'] as const

export type BuiltinProvider = (typeof BUILTIN_PROVIDERS)[number]

export const ALL_PROVIDERS: readonly AgentProvider[] = [...BUILTIN_PROVIDERS, 'gh-copilot', 'oxe', 'custom']

export interface AgentProfile {
  agentProfileId: string
  name: string
  provider: AgentProvider
  command: string
  commandTemplate: string
  model?: string
  role?: string
  isBuiltin: boolean
  systemPrompt?: string
  parentProvider?: AgentProvider
}

export interface AgentReadiness {
  provider: AgentProvider
  command: string
  status: 'ready' | 'partial' | 'missing' | 'unknown'
  version?: string
  details?: string
}

export interface CreateAgentProfileInput {
  name: string
  provider: AgentProvider
  command: string
  commandTemplate: string
  model?: string
  role?: string
  systemPrompt?: string
  parentProvider?: AgentProvider
}

export type UpdateAgentProfileInput = Partial<Omit<CreateAgentProfileInput, 'provider'>>
