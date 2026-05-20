import type { AgentProfile } from '../../../shared/types/agent'

export type AgentCount = { agentProfileId: string; command: string; count: number }

export function getCopilotCommand(profiles: AgentProfile[]): string {
  const copilot = profiles.find((p) => p.provider === 'gh-copilot' || p.provider === 'copilot')
  return copilot?.command ?? ''
}

export function buildAgentSlots(counts: AgentCount[], totalSlots: number, defaultCommand: string): string[] {
  const slots: string[] = []
  for (const { command, count } of counts) {
    for (let i = 0; i < count; i++) {
      slots.push(command)
    }
  }
  while (slots.length < totalSlots) {
    slots.push(defaultCommand)
  }
  return slots.slice(0, totalSlots)
}

export function distributeEvenly(profiles: AgentProfile[], totalSlots: number): AgentCount[] {
  if (!profiles.length) return []
  const base = Math.floor(totalSlots / profiles.length)
  const remainder = totalSlots % profiles.length
  return profiles.map((p, i) => ({
    agentProfileId: p.agentProfileId,
    command: p.command,
    count: base + (i < remainder ? 1 : 0)
  }))
}

export function distributeOneEach(profiles: AgentProfile[], totalSlots: number): AgentCount[] {
  return profiles.map((p, i) => ({
    agentProfileId: p.agentProfileId,
    command: p.command,
    count: i < totalSlots ? 1 : 0
  }))
}

export function fillFirst(profiles: AgentProfile[], totalSlots: number): AgentCount[] {
  return profiles.map((p, i) => ({
    agentProfileId: p.agentProfileId,
    command: p.command,
    count: i === 0 ? totalSlots : 0
  }))
}
