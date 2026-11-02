import { readdir, realpath, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join, relative, isAbsolute } from 'node:path'
import { defaultClaudeProjectsRoot, encodeClaudeProjectPath } from '../usage/claude-project-path'

/** Claude Code and Codex name a session with a UUID (Codex uses v7). Nothing else is ever resumed. */
export const NATIVE_SESSION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export interface NativeSessionRoots {
  claudeProjects?: string
  codexSessions?: string
}

/** Seams for tests: the platform decides case folding, `realpath` the canonical form (native: 8.3 names expanded, case fixed, links resolved). */
export interface NativeSessionFs {
  platform?: NodeJS.Platform
  realpath?: (path: string) => Promise<string>
}

/** Bounds of the fallback: how many project folders are probed for the id, and how many folders one name may be decoded through. */
const MAX_PROJECT_FOLDERS = 4_000
const MAX_DECODE_LISTINGS = 64

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
export async function nativeSessionExists(agent: 'claude' | 'codex', sessionId: string, cwd: string, roots: NativeSessionRoots = {}, fs: NativeSessionFs = {}): Promise<boolean> {
  if (!NATIVE_SESSION_ID.test(sessionId)) return false
  if (agent === 'claude') return claudeSessionExists(sessionId, cwd, roots.claudeProjects ?? defaultClaudeProjectsRoot(), fs)
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

/**
 * Claude Code names the folder after the cwd it sees, which need not be the root as OXESpace stored it: an 8.3 short
 * form from `os.tmpdir()` (`RUNNER~1`), another letter case, a junction or a symlink. So, in order:
 * 1. the folder for the stored root and for its canonical form, matched case-insensitively on Windows;
 * 2. any project folder holding `<id>.jsonl` whose name decodes, through the real folders on disk, to a path with the
 *    same canonical form as the root. An id under another project's folder is never accepted.
 * Every hit must resolve inside the projects folder.
 */
async function claudeSessionExists(sessionId: string, cwd: string, projects: string, fs: NativeSessionFs): Promise<boolean> {
  const windows = (fs.platform ?? process.platform) === 'win32'
  const canonicalOf = async (path: string): Promise<string | null> => {
    try { return await (fs.realpath ?? realpath)(path) } catch { return null }
  }
  const fold = (name: string): string => windows ? name.toLowerCase() : name
  const projectsReal = await canonicalOf(projects)
  if (!projectsReal) return false
  const file = `${sessionId}.jsonl`
  const contained = async (folder: string): Promise<boolean> => {
    const real = await canonicalOf(join(projects, folder, file))
    if (!real) return false
    const rel = relative(projectsReal, real)
    return rel !== '' && !rel.startsWith('..') && !isAbsolute(rel)
  }
  const hit = async (folder: string): Promise<boolean> => await isFile(join(projects, folder, file)) && await contained(folder)

  const canonical = await canonicalOf(cwd)
  const wanted = new Set([cwd, canonical].filter((p): p is string => !!p).map(p => fold(encodeClaudeProjectPath(p))))
  const folders = await list(projects)
  for (const folder of folders) if (wanted.has(fold(folder)) && await hit(folder)) return true
  if (!canonical) return false

  for (const folder of folders.slice(0, MAX_PROJECT_FOLDERS)) {
    if (wanted.has(fold(folder)) || !await hit(folder)) continue
    for (const path of await decodeProjectFolder(folder, windows, fold)) {
      const real = await canonicalOf(path)
      if (real && fold(real) === fold(canonical)) return true
    }
  }
  return false
}

/**
 * The paths on disk whose encoding is `folder`. The encoding is lossy (every non-alphanumeric character is `-`), so
 * the name is matched one real folder entry at a time from the drive or `/` down; bounded by MAX_DECODE_LISTINGS.
 */
async function decodeProjectFolder(folder: string, windows: boolean, fold: (name: string) => string): Promise<string[]> {
  let start: string
  let rest: string
  const drive = /^([A-Za-z])--(.*)$/.exec(folder)
  if (windows && drive) { start = `${drive[1]}:\\`; rest = drive[2] } else if (!windows && folder.startsWith('-')) { start = '/'; rest = folder.slice(1) } else return []
  const found: string[] = []
  let listings = 0
  const walk = async (dir: string, remaining: string): Promise<void> => {
    if (listings++ >= MAX_DECODE_LISTINGS) return
    for (const entry of await list(dir)) {
      const encoded = fold(encodeClaudeProjectPath(entry))
      const left = fold(remaining)
      if (left === encoded) found.push(join(dir, entry))
      else if (left.startsWith(`${encoded}-`)) await walk(join(dir, entry), remaining.slice(encoded.length + 1))
    }
  }
  if (rest === '') return [start]
  await walk(start, rest)
  return found
}
