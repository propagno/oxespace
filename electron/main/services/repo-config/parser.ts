/**
 * `oxe.yaml`, `.oxe/worktree.yaml`, `orca.yaml`, and `.worktreeinclude` parsing.
 * Hostile-input tolerant by construction: anything unrecognised or out of bounds
 * is dropped, and a file that cannot be parsed yields `null` rather than throwing,
 * so a bad config never blocks a worktree.
 */
import { load } from 'js-yaml'
import type { RepoConfig, RepoConfigTab } from '../../../../shared/types/repo-config'

export const OXE_YAML_FILE = 'oxe.yaml'
export const OXE_WORKTREE_YAML_FILE = '.oxe/worktree.yaml'
export const ORCA_YAML_FILE = 'orca.yaml'
export const WORKTREE_INCLUDE_FILE = '.worktreeinclude'

export const MAX_FILE_BYTES = 256 * 1024
export const MAX_FIELD_CHARS = 64 * 1024
export const MAX_ENTRIES = 256
export const MAX_SHARED_DIRECTORIES = 100

const COLOR = /^#[0-9a-fA-F]{3}(?:[0-9a-fA-F]{3})?$/
const DRIVE = /^[a-zA-Z]:/

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function asTrimmedString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  if (!trimmed || trimmed.length > MAX_FIELD_CHARS) return undefined
  return trimmed
}

function asScriptString(value: unknown): string | undefined {
  const single = asTrimmedString(value)
  if (single) return single
  if (!Array.isArray(value)) return undefined
  const parts = value
    .slice(0, MAX_ENTRIES)
    .map((entry) => asTrimmedString(entry))
    .filter((entry): entry is string => Boolean(entry))
  if (parts.length === 0) return undefined
  const joined = parts.join(' && ')
  return joined.length <= MAX_FIELD_CHARS ? joined : undefined
}

/**
 * Entries that could escape the checkout, or that Git would report under a
 * different spelling, are dropped instead of rewritten: a later comparison
 * against `git status` output would otherwise miss them.
 */
export function normalizeSharedDirectories(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  const seen = new Set<string>()
  for (const raw of value.slice(0, MAX_ENTRIES)) {
    if (typeof raw !== 'string') continue
    let entry = raw.trim().replace(/\\/g, '/')
    if (entry.startsWith('./')) entry = entry.slice(2)
    entry = entry.replace(/\/+$/, '')
    if (!entry || entry.startsWith('/') || DRIVE.test(entry)) continue
    const segments = entry.split('/')
    if (segments.some((s) => s === '' || s === '.' || s === '..' || s.toLowerCase() === '.git' || s.includes(':') || /[. ]$/.test(s) || /^git~\d+$/i.test(s))) continue
    seen.add(entry)
    if (seen.size >= MAX_SHARED_DIRECTORIES) break
  }
  return [...seen]
}

export const MAX_INCLUDE_PATTERNS = 100
const MAX_INCLUDE_CHARS = 1024

/** Simple glob test used only to check whether an intervening negation could oppose a positive pattern. */
function negationCouldAffect(negationBody: string, positivePattern: string): boolean {
  const neg = negationBody.replace(/^\.\//, '').replace(/\/+$/, '')
  const pos = positivePattern.replace(/^\.\//, '').replace(/\/+$/, '')
  if (!neg || !pos) return false
  if (neg === pos) return true
  const posBase = pos.split('/').pop() ?? pos
  const negHasSlash = neg.includes('/')
  const toRegex = (pat: string): RegExp => {
    const escaped = pat
      .replace(/[.+^${}()|[\]\\]/g, '\\$&')
      .replace(/\*\*/g, '.__GLOBSTAR__.')
      .replace(/\*/g, '[^/]*')
      .replace(/\?/g, '[^/]')
      .replace(/\.__GLOBSTAR__\./g, '.*')
    return new RegExp(`^${escaped}$`)
  }
  try {
    const re = toRegex(neg)
    if (re.test(pos)) return true
    if (!negHasSlash && re.test(posBase)) return true
    if (pos.startsWith(`${neg}/`) || neg.startsWith(`${pos}/`)) return true
  } catch {
    return true
  }
  return false
}

/**
 * Deduplicates include/exclude patterns while preserving order-sensitive `!negation` semantics:
 * an identical positive pattern is dropped if no intervening `!negation` could exclude it.
 */
export function dedupeIncludePatternsPreserveOrder(patterns: readonly string[]): string[] {
  const out: string[] = []
  for (const raw of patterns) {
    const entry = raw.trim().replace(/\\/g, '/')
    if (!entry || entry.length > MAX_INCLUDE_CHARS) continue
    if (entry.startsWith('!')) {
      if (out.length > 0 && out[out.length - 1] === entry) continue
      out.push(entry)
    } else {
      const prevIdx = out.lastIndexOf(entry)
      if (prevIdx >= 0) {
        const affectedLater = out
          .slice(prevIdx + 1)
          .some((later) => later.startsWith('!') && negationCouldAffect(later.slice(1).trim(), entry))
        if (!affectedLater) continue
      }
      out.push(entry)
    }
    if (out.length >= MAX_INCLUDE_PATTERNS) break
  }
  return out
}

/**
 * `worktree.copyFiles` (B19 / OXE-444). Only the shape is checked here: strings, trimmed, `\` read as `/`,
 * deduplicated while preserving `!negation` order. Patterns that would leave the repository are kept on purpose,
 * so the copy step can refuse each one by name (C3) instead of dropping it where nobody sees.
 */
export function normalizeIncludePatterns(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  const cleaned: string[] = []
  for (const raw of value.slice(0, MAX_ENTRIES)) {
    if (typeof raw !== 'string') continue
    const entry = raw.trim().replace(/\\/g, '/')
    if (!entry || entry.length > MAX_INCLUDE_CHARS) continue
    cleaned.push(entry)
  }
  return dedupeIncludePatternsPreserveOrder(cleaned)
}

/**
 * Parses a `.worktreeinclude` file (Claude Code / `.gitignore`-style lines):
 * strips UTF-8 BOM, ignores blank lines and `#` comments, preserves `!pattern` negations,
 * unescapes `\#` / `\!`, and normalizes `\` to `/`.
 */
export function parseWorktreeInclude(content: string): string[] {
  if (Buffer.byteLength(content, 'utf8') > MAX_FILE_BYTES) return []
  const source = content.startsWith('\uFEFF') ? content.slice(1) : content
  const patterns: string[] = []
  for (const rawLine of source.split(/\r?\n/)) {
    let line = rawLine.trim()
    if (!line || line.startsWith('#')) continue
    if (line.startsWith('\\#') || line.startsWith('\\!')) line = line.slice(1)
    line = line.replace(/\\/g, '/')
    if (!line || line.length > MAX_INCLUDE_CHARS) continue
    patterns.push(line)
    if (patterns.length >= MAX_ENTRIES) break
  }
  return dedupeIncludePatternsPreserveOrder(patterns)
}

export function normalizeDefaultTabs(value: unknown): RepoConfigTab[] {
  if (!Array.isArray(value)) return []
  const tabs: RepoConfigTab[] = []
  for (const raw of value.slice(0, MAX_ENTRIES)) {
    const record = asRecord(raw)
    if (!record) continue
    const title = asTrimmedString(record.title)
    const command = asTrimmedString(record.command)
    if (!title || !command) continue
    const tab: RepoConfigTab = { title, command }
    if (typeof record.color === 'string' && COLOR.test(record.color.trim())) tab.color = record.color.trim()
    tabs.push(tab)
  }
  return tabs
}

export function parseOxeYaml(content: string): RepoConfig | null {
  if (Buffer.byteLength(content, 'utf8') > MAX_FILE_BYTES) return null
  let parsed: unknown
  try {
    parsed = load(content)
  } catch {
    return null
  }
  const root = asRecord(parsed)
  if (!root) return null

  const scripts = asRecord(root.scripts) ?? {}
  const worktree = asRecord(root.worktree) ?? {}
  const config: RepoConfig = {
    scripts: {},
    worktree: { sharedDirectories: normalizeSharedDirectories(worktree.sharedDirectories) },
    defaultTabs: normalizeDefaultTabs(root.defaultTabs)
  }
  const include = normalizeIncludePatterns(worktree.copyFiles)
  if (include.length) config.worktree.copyFiles = include
  const thread = asRecord(root.thread)
  if (thread && typeof thread.brief === 'boolean') config.thread = { brief: thread.brief }
  if (thread && Array.isArray(thread.tools)) {
    const tools = [...new Set(thread.tools.filter((group): group is string => typeof group === 'string').map(group => group.trim()).filter(Boolean))]
    if (tools.length) config.thread = { ...config.thread, tools }
  } else if (thread && asRecord(thread.tools)) {
    const toolModes = Object.fromEntries(Object.entries(asRecord(thread.tools)!).filter((entry): entry is [string, string] => typeof entry[1] === 'string')
      .map(([group, mode]) => [group.trim(), mode.trim()]).filter(([group, mode]) => group && mode).slice(0, 20))
    if (Object.keys(toolModes).length) config.thread = { ...config.thread, toolModes }
  }
  const setup = asTrimmedString(scripts.setup)
  const archive = asTrimmedString(scripts.archive)
  if (setup) config.scripts.setup = setup
  if (archive) config.scripts.archive = archive

  const empty =
    !config.scripts.setup &&
    !config.scripts.archive &&
    config.worktree.sharedDirectories.length === 0 &&
    !config.worktree.copyFiles &&
    config.defaultTabs.length === 0 &&
    !config.thread
  return empty ? null : config
}

/**
 * Parses `orca.yaml` compatibility files into OXESpace's declarative `RepoConfig`.
 * Accepts both top-level (`sharedDirectories`, `setup`, `setupCommand`, `copyFiles`)
 * and nested (`worktree.*`, `scripts.*`, `hooks.*`) Orca conventions.
 */
export function parseOrcaYaml(content: string): RepoConfig | null {
  if (Buffer.byteLength(content, 'utf8') > MAX_FILE_BYTES) return null
  let parsed: unknown
  try {
    parsed = load(content)
  } catch {
    return null
  }
  const root = asRecord(parsed)
  if (!root) return null

  const worktree = asRecord(root.worktree) ?? {}
  const scripts = asRecord(root.scripts) ?? asRecord(root.hooks) ?? {}
  const sharedDirectories = normalizeSharedDirectories(
    root.sharedDirectories ?? root.shared_directories ?? worktree.sharedDirectories ?? worktree.shared_directories
  )
  const copyFiles = normalizeIncludePatterns(
    root.copyFiles ?? root.copy_files ?? root.include ?? worktree.copyFiles ?? worktree.copy_files
  )
  const setup = asScriptString(scripts.setup ?? root.setup ?? root.setupCommand ?? root.setup_command)
  const archive = asScriptString(scripts.archive ?? root.archive ?? root.archiveCommand ?? root.archive_command)

  const config: RepoConfig = {
    scripts: {},
    worktree: { sharedDirectories },
    defaultTabs: []
  }
  if (copyFiles.length) config.worktree.copyFiles = copyFiles
  if (setup) config.scripts.setup = setup
  if (archive) config.scripts.archive = archive

  const empty =
    !config.scripts.setup &&
    !config.scripts.archive &&
    config.worktree.sharedDirectories.length === 0 &&
    !config.worktree.copyFiles
  return empty ? null : config
}
