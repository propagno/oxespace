import { homedir } from 'node:os'
import { join } from 'node:path'

/** Claude Code replaces every non-ASCII-alphanumeric character in a project path. */
export function encodeClaudeProjectPath(rootPath: string): string {
  return rootPath.replace(/[^a-zA-Z0-9]/g, '-')
}

export function defaultClaudeProjectsRoot(): string {
  return join(process.env.CLAUDE_CONFIG_DIR ?? join(homedir(), '.claude'), 'projects')
}
