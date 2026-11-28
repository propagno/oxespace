/**
 * Custom agent definitions discovered from project/user Markdown files with YAML frontmatter
 * (`.oxe/agents/*.md`, `.github/agents/*.agent.md`, `.claude/agents/*.md`, `~/.oxe/agents/*.md`)
 * and declarative post-turn handoffs (OXE-481).
 */

export type CustomAgentMode = 'agent' | 'plan' | 'ask'
export type CustomAgentSource = 'oxe' | 'github' | 'claude' | 'user'

export interface CustomAgentHandoff {
  label: string
  /** Target custom agent slug/name or built-in mode (`agent`, `plan`, `ask`). */
  agent?: string
  mode?: CustomAgentMode
  prompt?: string
  send?: boolean
}

export interface CustomAgentDefinition {
  /** Normalized slug identifier derived from the filename stem. */
  id: string
  /** Display name from YAML frontmatter `name`, falling back to `id`. */
  name: string
  description: string
  /** Optional preferred model identifier. */
  model?: string
  /** Base execution mode (`agent`, `plan`, or `ask`). Defaults to `agent`. */
  mode: CustomAgentMode
  /** Optional read-only restriction; never escalates above the conversation's access. */
  access?: 'read-only'
  argumentHint?: string
  handoffs: CustomAgentHandoff[]
  /** Bounded Markdown instructions body following YAML frontmatter. */
  instructions: string
  /** Precedence tier: project `.oxe` > `.github` > `.claude` > user `~/.oxe`. */
  source: CustomAgentSource
  /** Display path relative to project root or home directory. */
  sourcePath: string
}

export const MAX_CUSTOM_AGENT_BYTES = 64 * 1024
export const MAX_CUSTOM_AGENTS = 50
export const MAX_CUSTOM_AGENT_HANDOFFS = 8
export const MAX_CUSTOM_AGENT_INSTRUCTIONS_CHARS = 16_000

/** True when the effective conversation mode or active custom agent restricts turns to read-only. */
export function isReadOnlyModeOrAgent(
  mode?: 'default' | 'plan' | 'acceptEdits' | 'ask',
  agent?: Pick<CustomAgentDefinition, 'mode' | 'access'> | null
): boolean {
  return mode === 'ask' || agent?.mode === 'ask' || agent?.access === 'read-only'
}
