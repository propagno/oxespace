export type AgentProvider = 'claude' | 'copilot' | 'gh-copilot' | 'codex' | 'gemini' | 'cursor' | 'oxe' | 'custom'

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
