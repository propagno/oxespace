/**
 * Which instruction files the provider CLI will load for a conversation.
 *
 * Claude Code and Codex read these files themselves; OXESpace only lists them
 * so a person can see why the agent behaves as it does. The lookup mirrors the
 * documented order (user scope, then each directory from the repository root
 * down to the working directory) and never reads file contents.
 */
import { existsSync, readdirSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, relative, resolve, sep } from 'node:path'

export interface InstructionSource {
  path: string
  scope: 'user' | 'project' | 'directory' | 'local' | 'rules'
  bytes: number
}

const MAX_RULES = 50

function fileSize(path: string): number | null {
  try {
    const stat = statSync(path)
    return stat.isFile() ? stat.size : null
  } catch { return null }
}

/** Directories from the repository root (nearest `.git`) down to `cwd`, root first. */
function chainFromRepoRoot(cwd: string): string[] {
  const dirs: string[] = []
  let current = resolve(cwd)
  for (let depth = 0; depth < 64; depth += 1) {
    dirs.unshift(current)
    if (existsSync(join(current, '.git'))) return dirs
    const parent = dirname(current)
    if (parent === current) break
    current = parent
  }
  // No repository: only the working directory itself counts.
  return [resolve(cwd)]
}

export function instructionSources(provider: 'claude' | 'codex', cwd: string, home: string = homedir()): InstructionSource[] {
  const found: InstructionSource[] = []
  const add = (path: string, scope: InstructionSource['scope']): void => {
    const bytes = fileSize(path)
    if (bytes !== null && !found.some(item => item.path === path)) found.push({ path, scope, bytes })
  }
  const chain = chainFromRepoRoot(cwd)
  const root = chain[0]
  if (provider === 'claude') {
    add(join(process.env.CLAUDE_CONFIG_DIR || join(home, '.claude'), 'CLAUDE.md'), 'user')
    for (const dir of chain) {
      const scope = dir === root ? 'project' : 'directory'
      add(join(dir, 'CLAUDE.md'), scope)
      add(join(dir, '.claude', 'CLAUDE.md'), scope)
    }
    add(join(resolve(cwd), 'CLAUDE.local.md'), 'local')
    const rulesDir = join(root, '.claude', 'rules')
    try {
      for (const name of readdirSync(rulesDir).filter(name => name.endsWith('.md')).sort().slice(0, MAX_RULES)) add(join(rulesDir, name), 'rules')
    } catch { /* no rules directory */ }
  } else {
    const codexHome = process.env.CODEX_HOME || join(home, '.codex')
    add(join(codexHome, 'AGENTS.override.md'), 'user')
    add(join(codexHome, 'AGENTS.md'), 'user')
    for (const dir of chain) {
      const scope = dir === root ? 'project' : 'directory'
      add(join(dir, 'AGENTS.override.md'), scope)
      add(join(dir, 'AGENTS.md'), scope)
    }
  }
  return found
}

/** A short label for a source relative to the project, or the home-relative user path. */
export function instructionLabel(source: InstructionSource, cwd: string, home: string = homedir()): string {
  const fromProject = relative(resolve(cwd), source.path)
  if (!fromProject.startsWith('..') && !fromProject.includes(`..${sep}`)) return fromProject.split(sep).join('/')
  const fromHome = relative(home, source.path)
  return fromHome.startsWith('..') ? source.path : `~/${fromHome.split(sep).join('/')}`
}
