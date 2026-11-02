/**
 * `oxe.yaml` parsing. Hostile-input tolerant by construction: anything
 * unrecognised or out of bounds is dropped, and a file that cannot be parsed
 * yields `null` rather than throwing, so a bad config never blocks a worktree.
 */
import { load } from 'js-yaml'
import type { RepoConfig, RepoConfigTab } from '../../../../shared/types/repo-config'

export const OXE_YAML_FILE = 'oxe.yaml'
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
    if (segments.some((s) => s === '' || s === '.' || s === '..' || s.toLowerCase() === '.git')) continue
    seen.add(entry)
    if (seen.size >= MAX_SHARED_DIRECTORIES) break
  }
  return [...seen]
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
    config.defaultTabs.length === 0 &&
    !config.thread
  return empty ? null : config
}
