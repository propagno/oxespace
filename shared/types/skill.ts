import type { AgentProvider } from './agent'

export interface SkillMetadata {
  /** Slash command name (without leading `/`). Required, kebab-case. */
  name: string
  /** Short human-readable description shown in the slash overlay. */
  description: string
  /** Providers this skill is compatible with. Empty = all. */
  agents: AgentProvider[]
  /** Optional category for grouping in the Settings UI. */
  category?: string
  /** When true, skill is hidden from the slash overlay (still discoverable in Settings). */
  hidden?: boolean
}

export interface SkillDefinition extends SkillMetadata {
  /** Absolute path on disk where the skill file lives. */
  filePath: string
  /** Markdown body (everything after the frontmatter). Used as system prompt. */
  body: string
  /** Source — `user` = ~/.oxe/skills, `workspace` = <project>/.oxe/skills */
  source: 'user' | 'workspace'
  /** mtime of the file when loaded. Used to detect external edits. */
  mtimeMs: number
}

export interface InvokeSkillInput {
  skillName: string
  paneId: string
  /** Free-text argument captured by the slash overlay. */
  argument?: string
}

export interface CreateSkillInput {
  /** Slash-command name; must be kebab-case. */
  name: string
  /** One-line description shown in the slash overlay. */
  description: string
  /**
   * Providers this skill is compatible with. Empty array = all providers.
   * Must reference real AgentProvider values; validated by the service.
   */
  agents: AgentProvider[]
  /** Optional category for grouping in the browser. */
  category?: string
  /** Initial markdown body (system prompt). Skill template is used when empty. */
  body?: string
  /** Target file scope. `workspace` requires a workspaceRootPath. */
  scope: 'user' | 'workspace'
  /** Absolute path to the workspace root when scope === 'workspace'. */
  workspaceRootPath?: string
}
