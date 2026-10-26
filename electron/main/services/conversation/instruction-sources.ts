/**
 * Which instruction files the provider CLI will load for a conversation.
 *
 * Claude Code and Codex read these files themselves; OXESpace only lists them
 * so a person can see why the agent behaves as it does. The lookup mirrors the
 * documented order (user scope, then each directory from the repository root
 * down to the working directory). It reads nothing but the first few KiB of a rule file, to
 * learn which files the rule is limited to (`paths:` in its header).
 */
import { closeSync, existsSync, openSync, readdirSync, readSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { load as loadYaml } from 'js-yaml'

export interface InstructionSource {
  path: string
  scope: 'user' | 'project' | 'directory' | 'local' | 'rules'
  bytes: number
  /** A rule that applies only when the agent works with files matching these globs. */
  paths?: string[]
}

const MAX_RULES = 50
const RULE_DEPTH = 3
const HEADER_BYTES = 4096

/** The `paths:` globs of a rule file's YAML header; empty for a rule that always applies. */
function ruleScope(path: string): string[] {
  let text: string
  try {
    const fd = openSync(path, 'r')
    try {
      const buffer = Buffer.alloc(HEADER_BYTES)
      text = buffer.subarray(0, readSync(fd, buffer, 0, HEADER_BYTES, 0)).toString('utf8')
    } finally { closeSync(fd) }
  } catch { return [] }
  const header = text.match(/^---\r?\n([\s\S]*?)\r?\n---/)
  if (!header) return []
  try {
    const value = (loadYaml(header[1]) as { paths?: unknown } | null)?.paths
    const list = typeof value === 'string' ? value.split(',') : Array.isArray(value) ? value : []
    return list.filter((item): item is string => typeof item === 'string').map(item => item.trim()).filter(Boolean).slice(0, 20)
  } catch { return [] }
}

/** Markdown files under a rules folder, folders included, in a stable order. */
function ruleFiles(dir: string, depth = 0): string[] {
  let names: import('node:fs').Dirent[]
  try { names = readdirSync(dir, { withFileTypes: true }) } catch { return [] }
  names.sort((a, b) => a.name.localeCompare(b.name))
  const out: string[] = []
  for (const entry of names) {
    if (entry.isFile() && entry.name.endsWith('.md')) out.push(join(dir, entry.name))
    else if (entry.isDirectory() && depth < RULE_DEPTH) out.push(...ruleFiles(join(dir, entry.name), depth + 1))
  }
  return out
}

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
    if (bytes === null || found.some(item => item.path === path)) return
    const paths = scope === 'rules' ? ruleScope(path) : []
    found.push({ path, scope, bytes, ...(paths.length ? { paths } : {}) })
  }
  const chain = chainFromRepoRoot(cwd)
  const root = chain[0]
  if (provider === 'claude') {
    const claudeHome = process.env.CLAUDE_CONFIG_DIR || join(home, '.claude')
    add(join(claudeHome, 'CLAUDE.md'), 'user')
    for (const file of ruleFiles(join(claudeHome, 'rules')).slice(0, MAX_RULES)) add(file, 'rules')
    for (const dir of chain) {
      const scope = dir === root ? 'project' : 'directory'
      add(join(dir, 'CLAUDE.md'), scope)
      add(join(dir, '.claude', 'CLAUDE.md'), scope)
    }
    add(join(resolve(cwd), 'CLAUDE.local.md'), 'local')
    for (const file of ruleFiles(join(root, '.claude', 'rules')).slice(0, MAX_RULES)) add(file, 'rules')
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
