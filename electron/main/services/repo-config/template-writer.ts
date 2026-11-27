/**
 * Safe reader and atomic writer for `<primaryRoot>/oxe.yaml` and `<primaryRoot>/.worktreeinclude` (OXE-444).
 *
 * Security invariants:
 * - Only touches the two fixed filenames (`oxe.yaml` and `.worktreeinclude`) directly under `primaryRoot`.
 * - Refuses to write through a symlink (`lstat` check on target and on `primaryRoot` parent containment).
 * - Preserves unrelated sections of `oxe.yaml` (`defaultTabs`, `thread`, etc.) intact.
 * - Uses temp file + atomic rename in `primaryRoot` so a partial write can never corrupt config.
 */
import { randomUUID } from 'node:crypto'
import { lstat, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { load } from 'js-yaml'
import type { WorktreeTemplateConfig, WorktreeTemplateSaveInput } from '../../../../shared/types/repo-config'
import { loadWorktreeTemplate } from './loader'
import {
  MAX_FIELD_CHARS,
  MAX_FILE_BYTES,
  normalizeIncludePatterns,
  normalizeSharedDirectories,
  OXE_YAML_FILE,
  WORKTREE_INCLUDE_FILE
} from './parser'
import { hashHookScript, hashSensitivePatterns, type RepoHookTrust } from './trust'
import { extractSensitivePatterns } from './worktree-include'

const SAFE_PLAIN_SCALAR = /^[A-Za-z0-9._/][A-Za-z0-9._/@ -]*$/
const YAML_RESERVED = /^(?:true|false|yes|no|on|off|null|~|\.inf|-\.inf|\+\.inf|\.nan|[-+]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][-+]?\d+)?|0x[0-9a-fA-F]+|0o[0-7]+)$/i

function formatYamlScalar(value: unknown): string {
  if (value === null || value === undefined) return 'null'
  if (typeof value === 'boolean' || typeof value === 'number') return String(value)
  const str = String(value)
  if (
    str.length > 0 &&
    str === str.trim() &&
    SAFE_PLAIN_SCALAR.test(str) &&
    !YAML_RESERVED.test(str) &&
    !str.includes(': ') &&
    !str.includes(' #') &&
    !str.endsWith(':')
  ) {
    return str
  }
  return JSON.stringify(str)
}

function formatYamlKey(key: string): string {
  return /^[A-Za-z_][A-Za-z0-9_-]*$/.test(key) ? key : JSON.stringify(key)
}

function formatYamlEntry(key: string, value: unknown, indent: number): string {
  const k = formatYamlKey(key)
  if (Array.isArray(value)) {
    return value.length === 0 ? `${k}: []` : `${k}:\n${serializeYamlValue(value, indent + 2)}`
  }
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>).filter(([, v]) => v !== undefined)
    return entries.length === 0 ? `${k}: {}` : `${k}:\n${serializeYamlValue(value, indent + 2)}`
  }
  return `${k}: ${formatYamlScalar(value)}`
}

function serializeYamlValue(value: unknown, indent: number): string {
  const pad = ' '.repeat(indent)
  if (Array.isArray(value)) {
    if (value.length === 0) return '[]'
    return value
      .map((item) => {
        if (item !== null && typeof item === 'object') {
          if (Array.isArray(item)) {
            return item.length === 0 ? `${pad}- []` : `${pad}-\n${serializeYamlValue(item, indent + 2)}`
          }
          const entries = Object.entries(item as Record<string, unknown>).filter(([, v]) => v !== undefined)
          if (entries.length === 0) return `${pad}- {}`
          const [firstKey, firstVal] = entries[0]
          const firstLine = formatYamlEntry(firstKey, firstVal, indent + 2)
          const restLines = entries
            .slice(1)
            .map(([k, v]) => `${' '.repeat(indent + 2)}${formatYamlEntry(k, v, indent + 2)}`)
          return [`${pad}- ${firstLine}`, ...restLines].join('\n')
        }
        return `${pad}- ${formatYamlScalar(item)}`
      })
      .join('\n')
  }
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>).filter(([, v]) => v !== undefined)
    if (entries.length === 0) return '{}'
    return entries.map(([k, v]) => `${pad}${formatYamlEntry(k, v, indent)}`).join('\n')
  }
  return `${pad}${formatYamlScalar(value)}`
}

function dumpYamlDocument(doc: Record<string, unknown>): string {
  const body = serializeYamlValue(doc, 0)
  return body && body !== '{}' ? `${body}\n` : ''
}

async function tryLstat(path: string) {
  try { return await lstat(path) } catch { return null }
}

async function assertNotSymlink(path: string): Promise<void> {
  const info = await tryLstat(path)
  if (info?.isSymbolicLink()) {
    throw new Error(`Refused to write worktree template through a symlink: ${path}`)
  }
  if (info && !info.isFile()) {
    throw new Error(`Refused to overwrite non-file worktree template path: ${path}`)
  }
}

async function writeAtomic(targetPath: string, content: string): Promise<void> {
  await assertNotSymlink(targetPath)
  const tmpPath = `${targetPath}.oxe-tmp-${randomUUID()}`
  try {
    await writeFile(tmpPath, content, { encoding: 'utf8', flag: 'wx' })
    await rename(tmpPath, targetPath)
  } catch (error) {
    await rm(tmpPath, { force: true }).catch(() => undefined)
    throw error
  }
}

export async function readWorktreeTemplate(
  primaryRoot: string,
  trust?: RepoHookTrust | null
): Promise<WorktreeTemplateConfig> {
  const loaded = await loadWorktreeTemplate(primaryRoot)
  const merged = loaded.config
  const oxe = loaded.oxeConfig
  const allCopyPatterns = merged?.worktree.copyFiles ?? []
  const sensitivePatterns = extractSensitivePatterns(allCopyPatterns)
  const sensitiveHash = sensitivePatterns.length > 0 ? hashSensitivePatterns(sensitivePatterns) : null
  const sensitiveApproved = sensitivePatterns.length === 0
    ? true
    : Boolean(trust?.isSensitiveCopyTrusted(primaryRoot, sensitivePatterns))
  const setupScript = merged?.scripts.setup ?? ''
  const archiveScript = merged?.scripts.archive ?? ''
  const setupHash = setupScript ? hashHookScript(setupScript) : null
  const setupTrusted = setupScript ? Boolean(trust?.isTrusted(primaryRoot, 'setup', setupScript)) : false

  return {
    rootPath: primaryRoot,
    sources: loaded.sources,
    sharedDirectories: merged?.worktree.sharedDirectories ?? [],
    copyFiles: oxe?.worktree.copyFiles ?? [],
    worktreeInclude: loaded.worktreeInclude,
    setupScript,
    archiveScript,
    sensitivePatterns,
    sensitiveApproved,
    sensitiveHash,
    setupHash,
    setupTrusted
  }
}

export async function saveWorktreeTemplate(
  primaryRoot: string,
  input: WorktreeTemplateSaveInput,
  trust?: RepoHookTrust | null
): Promise<WorktreeTemplateConfig> {
  const oxePath = join(primaryRoot, OXE_YAML_FILE)
  const includePath = join(primaryRoot, WORKTREE_INCLUDE_FILE)

  await assertNotSymlink(oxePath)
  await assertNotSymlink(includePath)

  const sharedDirectories = normalizeSharedDirectories(input.sharedDirectories)
  const copyFiles = normalizeIncludePatterns(input.copyFiles)
  const worktreeInclude = normalizeIncludePatterns(input.worktreeInclude)
  const setupScript = typeof input.setupScript === 'string' ? input.setupScript.trim().slice(0, MAX_FIELD_CHARS) : undefined
  const archiveScript = typeof input.archiveScript === 'string' ? input.archiveScript.trim().slice(0, MAX_FIELD_CHARS) : undefined

  // Read existing oxe.yaml to preserve unrelated top-level fields (`defaultTabs`, `thread`, etc.).
  let existingDoc: Record<string, unknown> = {}
  const existingInfo = await tryLstat(oxePath)
  if (existingInfo) {
    if (existingInfo.size > MAX_FILE_BYTES) {
      throw new Error('Existing oxe.yaml exceeds maximum allowed size.')
    }
    const raw = await readFile(oxePath, 'utf8')
    const parsed = raw.trim() ? load(raw) : {}
    if (parsed !== null && parsed !== undefined) {
      if (typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new Error('Existing oxe.yaml is not a YAML mapping.')
      }
      existingDoc = { ...(parsed as Record<string, unknown>) }
    }
  }

  const nextWorktree: Record<string, unknown> =
    existingDoc.worktree && typeof existingDoc.worktree === 'object' && !Array.isArray(existingDoc.worktree)
      ? { ...(existingDoc.worktree as Record<string, unknown>) }
      : {}

  if (sharedDirectories.length > 0) nextWorktree.sharedDirectories = sharedDirectories
  else delete nextWorktree.sharedDirectories

  if (copyFiles.length > 0) nextWorktree.copyFiles = copyFiles
  else delete nextWorktree.copyFiles

  if (Object.keys(nextWorktree).length > 0) existingDoc.worktree = nextWorktree
  else delete existingDoc.worktree

  if (setupScript !== undefined || archiveScript !== undefined) {
    const nextScripts: Record<string, unknown> =
      existingDoc.scripts && typeof existingDoc.scripts === 'object' && !Array.isArray(existingDoc.scripts)
        ? { ...(existingDoc.scripts as Record<string, unknown>) }
        : {}
    if (setupScript !== undefined) {
      if (setupScript) nextScripts.setup = setupScript
      else delete nextScripts.setup
    }
    if (archiveScript !== undefined) {
      if (archiveScript) nextScripts.archive = archiveScript
      else delete nextScripts.archive
    }
    if (Object.keys(nextScripts).length > 0) existingDoc.scripts = nextScripts
    else delete existingDoc.scripts
  }

  const shouldWriteOxe = existingInfo !== null || Object.keys(existingDoc).length > 0
  if (shouldWriteOxe) {
    const serialized = Object.keys(existingDoc).length > 0 ? dumpYamlDocument(existingDoc) : ''
    await writeAtomic(oxePath, serialized)
  }

  const includeExists = (await tryLstat(includePath)) !== null
  if (worktreeInclude.length > 0 || includeExists) {
    const includeContent = worktreeInclude.length > 0 ? `${worktreeInclude.join('\n')}\n` : ''
    await writeAtomic(includePath, includeContent)
  }

  return readWorktreeTemplate(primaryRoot, trust)
}
