import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, watch, type FSWatcher } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { AgentProvider } from '../../../shared/types/agent'
import type { SkillDefinition, SkillMetadata } from '../../../shared/types/skill'

/**
 * Loads agent skills from `~/.oxe/skills/<name>.md` (user-scoped, applies to all workspaces)
 * and `<workspace>/.oxe/skills/<name>.md` (workspace-scoped, overrides user skills with the
 * same name). Each file uses YAML frontmatter for metadata + markdown body as system prompt.
 *
 * Example skill file:
 * ```
 * ---
 * name: refactor-react
 * description: Refatora componentes React no estilo do projeto
 * agents: [claude, codex]
 * category: refactor
 * ---
 *
 * Você é um especialista em React...
 * ```
 *
 * Skill names are slash command identifiers (kebab-case). Workspace skills always win over
 * user skills with the same name.
 */
export class SkillService {
  private readonly userRoot: string
  private readonly userWatcher: FSWatcher | null = null
  private readonly skills: Map<string, SkillDefinition> = new Map()
  private readonly workspaceWatchers: Map<string, FSWatcher> = new Map()
  private readonly onChange: (() => void) | null

  constructor(options: { userRoot?: string; onChange?: () => void } = {}) {
    this.userRoot = options.userRoot ?? join(homedir(), '.oxe', 'skills')
    this.onChange = options.onChange ?? null

    // Eagerly create the user skills dir so the watcher attaches cleanly.
    if (!existsSync(this.userRoot)) {
      try { mkdirSync(this.userRoot, { recursive: true }) } catch { /* ignore */ }
    }

    this.loadFolder(this.userRoot, 'user')
    this.userWatcher = this.attachWatcher(this.userRoot, 'user')
  }

  /** Registers a workspace's `.oxe/skills` folder for live reload. */
  registerWorkspaceFolder(workspaceRootPath: string): void {
    const folder = join(workspaceRootPath, '.oxe', 'skills')
    if (this.workspaceWatchers.has(folder)) return
    if (!existsSync(folder)) return
    this.loadFolder(folder, 'workspace')
    const watcher = this.attachWatcher(folder, 'workspace')
    if (watcher) this.workspaceWatchers.set(folder, watcher)
  }

  unregisterWorkspaceFolder(workspaceRootPath: string): void {
    const folder = join(workspaceRootPath, '.oxe', 'skills')
    const watcher = this.workspaceWatchers.get(folder)
    if (watcher) { watcher.close(); this.workspaceWatchers.delete(folder) }
    // Remove skills loaded from this folder
    for (const [name, skill] of this.skills) {
      if (skill.filePath.startsWith(folder)) this.skills.delete(name)
    }
    this.emitChange()
  }

  listSkills(workspaceRootPath?: string): SkillDefinition[] {
    // Make sure workspace folder is registered & loaded.
    if (workspaceRootPath) this.registerWorkspaceFolder(workspaceRootPath)
    return Array.from(this.skills.values()).sort((a, b) => {
      // Workspace overrides first, then user, alphabetical
      if (a.source !== b.source) return a.source === 'workspace' ? -1 : 1
      return a.name.localeCompare(b.name)
    })
  }

  getSkill(name: string): SkillDefinition | null {
    return this.skills.get(name) ?? null
  }

  dispose(): void {
    this.userWatcher?.close()
    for (const watcher of this.workspaceWatchers.values()) watcher.close()
    this.workspaceWatchers.clear()
  }

  private loadFolder(folder: string, source: 'user' | 'workspace'): void {
    if (!existsSync(folder)) return
    for (const file of readdirSync(folder)) {
      if (!file.endsWith('.md')) continue
      this.loadFile(join(folder, file), source)
    }
  }

  private loadFile(filePath: string, source: 'user' | 'workspace'): void {
    try {
      const raw = readFileSync(filePath, 'utf8')
      const stat = statSync(filePath)
      const parsed = parseSkillMarkdown(raw, filePath)
      if (!parsed) return
      const skill: SkillDefinition = {
        ...parsed,
        filePath,
        source,
        mtimeMs: stat.mtimeMs
      }
      // Workspace skills win over user skills with the same name.
      const existing = this.skills.get(skill.name)
      if (existing && existing.source === 'workspace' && source === 'user') return
      this.skills.set(skill.name, skill)
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn(`[skill.service] Failed to load ${filePath}:`, err)
    }
  }

  private attachWatcher(folder: string, source: 'user' | 'workspace'): FSWatcher | null {
    try {
      return watch(folder, { persistent: false }, (_eventType, filename) => {
        if (!filename || !filename.endsWith('.md')) return
        const fullPath = join(folder, filename)
        if (existsSync(fullPath)) {
          this.loadFile(fullPath, source)
        } else {
          // Removed — drop from registry
          for (const [name, skill] of this.skills) {
            if (skill.filePath === fullPath) this.skills.delete(name)
          }
        }
        this.emitChange()
      })
    } catch {
      return null
    }
  }

  private emitChange(): void {
    if (this.onChange) this.onChange()
  }
}

/**
 * Parses a skill markdown file with YAML frontmatter. Returns null when frontmatter
 * is missing or invalid.
 *
 * The parser is intentionally minimal — only supports flat key-value pairs and arrays
 * in `[a, b, c]` format. No nested objects. This is enough for skill metadata.
 */
export function parseSkillMarkdown(raw: string, filePath: string): (SkillMetadata & { body: string }) | null {
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/)
  if (!match) return null
  const yaml = match[1]
  const body = match[2].trim()

  const data: Record<string, string | string[] | boolean> = {}
  for (const line of yaml.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const colonIdx = trimmed.indexOf(':')
    if (colonIdx <= 0) continue
    const key = trimmed.slice(0, colonIdx).trim()
    const value = trimmed.slice(colonIdx + 1).trim()
    if (!key) continue
    if (value === 'true' || value === 'false') {
      data[key] = value === 'true'
    } else if (value.startsWith('[') && value.endsWith(']')) {
      data[key] = value
        .slice(1, -1)
        .split(',')
        .map((item) => item.trim().replace(/^['"]|['"]$/g, ''))
        .filter(Boolean)
    } else {
      data[key] = value.replace(/^['"]|['"]$/g, '')
    }
  }

  const name = typeof data.name === 'string' ? data.name : null
  const description = typeof data.description === 'string' ? data.description : ''
  if (!name || !/^[a-z0-9][a-z0-9-]*$/i.test(name)) {
    // eslint-disable-next-line no-console
    console.warn(`[skill] Invalid or missing 'name' in ${filePath}; skipping.`)
    return null
  }

  const agents = Array.isArray(data.agents)
    ? data.agents.filter((a): a is AgentProvider => typeof a === 'string')
    : []

  return {
    name,
    description,
    agents,
    category: typeof data.category === 'string' ? data.category : undefined,
    hidden: data.hidden === true,
    body
  }
}
