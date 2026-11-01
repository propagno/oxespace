import { readdir, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { defaultClaudeProjectsRoot, encodeClaudeProjectPath } from '../usage/claude-project-path'

/** Claude Code and Codex name a session with a UUID (Codex uses v7). Nothing else is ever resumed. */
export const NATIVE_SESSION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export interface NativeSessionRoots {
  claudeProjects?: string
  codexSessions?: string
}

async function isFile(path: string): Promise<boolean> {
  try { return (await stat(path)).isFile() } catch { return false }
}

async function list(dir: string): Promise<string[]> {
  try { return await readdir(dir) } catch { return [] }
}

/**
 * Whether the provider still has the session, so `--resume` can find it: Claude Code keeps it at
 * `<claude>/projects/<encoded cwd>/<id>.jsonl` (a resume only looks under the folder it starts in), Codex at
 * `<codex>/sessions/YYYY/MM/DD/rollout-…-<id>.jsonl`. Existence only: nothing is read from these files.
 */
export async function nativeSessionExists(agent: 'claude' | 'codex', sessionId: string, cwd: string, roots: NativeSessionRoots = {}): Promise<boolean> {
  if (!NATIVE_SESSION_ID.test(sessionId)) return false
  if (agent === 'claude') return isFile(join(roots.claudeProjects ?? defaultClaudeProjectsRoot(), encodeClaudeProjectPath(cwd), `${sessionId}.jsonl`))
  const root = roots.codexSessions ?? join(process.env.CODEX_HOME ?? join(homedir(), '.codex'), 'sessions')
  const suffix = `${sessionId.toLowerCase()}.jsonl`
  const dated = (names: string[]): string[] => names.filter(name => /^\d+$/.test(name)).sort().reverse()
  for (const year of dated(await list(root))) {
    for (const month of dated(await list(join(root, year)))) {
      for (const day of dated(await list(join(root, year, month)))) {
        if ((await list(join(root, year, month, day))).some(file => file.toLowerCase().endsWith(suffix))) return true
      }
    }
  }
  return false
}
