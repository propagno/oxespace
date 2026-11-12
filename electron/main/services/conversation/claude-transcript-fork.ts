import { unlink } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { encodeClaudeProjectPath } from '../usage/claude-project-path'

const SESSION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function claudeTranscriptPath(rootPath: string, sessionId: string, env: NodeJS.ProcessEnv = process.env): string {
  if (!SESSION_ID.test(sessionId)) throw new Error('The Claude session id is not valid.')
  const home = env.CLAUDE_CONFIG_DIR?.trim() || join(homedir(), '.claude')
  return join(home, 'projects', encodeClaudeProjectPath(rootPath), `${sessionId}.jsonl`)
}

/** Removes the transcript of a session copy OXESpace made (a side conversation's fork), never one in `keep`. */
export async function removeClaudeSessionCopy(input: { rootPath: string; forkId: string; keep: readonly (string | null | undefined)[]; env?: NodeJS.ProcessEnv }): Promise<boolean> {
  if (!SESSION_ID.test(input.forkId) || input.keep.some(id => id && id.toLowerCase() === input.forkId.toLowerCase())) return false
  try { await unlink(claudeTranscriptPath(input.rootPath, input.forkId, input.env)); return true } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false
    throw error
  }
}
