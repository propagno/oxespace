import { readFileSync, statSync } from 'node:fs'
import { readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { load } from 'js-yaml'
import type { RepoConfig, RepoConfigSnapshot, RepoHookKind, WorktreeTemplateSource } from '../../../../shared/types/repo-config'
import {
  dedupeIncludePatternsPreserveOrder,
  MAX_FILE_BYTES,
  MAX_SHARED_DIRECTORIES,
  ORCA_YAML_FILE,
  OXE_WORKTREE_YAML_FILE,
  OXE_YAML_FILE,
  parseOrcaYaml,
  parseOxeYaml,
  parseWorktreeInclude,
  WORKTREE_INCLUDE_FILE
} from './parser'
import { hashHookScript, type RepoHookTrust } from './trust'

export interface LoadedWorktreeTemplate {
  /** Merged declarative configuration across all present sources, or null when nothing is configured. */
  config: RepoConfig | null
  /** Present source files that contributed to `config`, in precedence order. */
  sources: WorktreeTemplateSource[]
  /** Raw parsed patterns from `.worktreeinclude` alone (used by the template editor). */
  worktreeInclude: string[]
  /** Parsed `oxe.yaml` alone (used by the template editor to keep oxe.yaml and .worktreeinclude distinct). */
  oxeConfig: RepoConfig | null
}

async function readBoundedText(path: string): Promise<string | null> {
  try {
    // Only a regular file within the limit is read (a FIFO or device link would hang the read).
    const info = await stat(path)
    if (!info.isFile() || info.size > MAX_FILE_BYTES) return null
    const raw = await readFile(path)
    if (raw.length > MAX_FILE_BYTES) return null
    return raw.toString('utf8')
  } catch {
    return null
  }
}

/**
 * Loads and merges declarative worktree template sources in deterministic precedence:
 *   `oxe.yaml` > `.oxe/worktree.yaml` > `orca.yaml`, with `.worktreeinclude`
 *   appended after YAML `copyFiles` preserving `!pattern` order.
 */
export async function loadWorktreeTemplate(dir: string): Promise<LoadedWorktreeTemplate> {
  const [oxeRaw, dotOxeRaw, orcaRaw, includeRaw] = await Promise.all([
    readBoundedText(join(dir, OXE_YAML_FILE)),
    readBoundedText(join(dir, ...OXE_WORKTREE_YAML_FILE.split('/'))),
    readBoundedText(join(dir, ORCA_YAML_FILE)),
    readBoundedText(join(dir, WORKTREE_INCLUDE_FILE))
  ])

  const oxe = oxeRaw !== null ? parseOxeYaml(oxeRaw) : null
  const dotOxe = dotOxeRaw !== null ? parseOxeYaml(dotOxeRaw) : null
  const orca = orcaRaw !== null ? parseOrcaYaml(orcaRaw) : null
  const worktreeInclude = includeRaw !== null ? parseWorktreeInclude(includeRaw) : []

  const sources: WorktreeTemplateSource[] = []
  if (oxe) sources.push('oxe.yaml')
  if (dotOxe) sources.push('.oxe/worktree.yaml')
  if (orca) sources.push('orca.yaml')
  if (worktreeInclude.length > 0) sources.push('.worktreeinclude')

  if (sources.length === 0) {
    return { config: null, sources: [], worktreeInclude: [], oxeConfig: null }
  }

  const sharedSet = new Set<string>()
  for (const cfg of [oxe, dotOxe, orca]) {
    if (!cfg) continue
    for (const entry of cfg.worktree.sharedDirectories) {
      sharedSet.add(entry)
      if (sharedSet.size >= MAX_SHARED_DIRECTORIES) break
    }
    if (sharedSet.size >= MAX_SHARED_DIRECTORIES) break
  }

  const rawCopyFiles: string[] = [
    ...(oxe?.worktree.copyFiles ?? []),
    ...(dotOxe?.worktree.copyFiles ?? []),
    ...(orca?.worktree.copyFiles ?? []),
    ...worktreeInclude
  ]
  const copyFiles = dedupeIncludePatternsPreserveOrder(rawCopyFiles)

  const scripts: RepoConfig['scripts'] = {}
  const setup = oxe?.scripts.setup ?? dotOxe?.scripts.setup ?? orca?.scripts.setup
  const archive = oxe?.scripts.archive ?? dotOxe?.scripts.archive ?? orca?.scripts.archive
  if (setup) scripts.setup = setup
  if (archive) scripts.archive = archive

  const merged: RepoConfig = {
    sources,
    scripts,
    worktree: {
      sharedDirectories: [...sharedSet],
      ...(copyFiles.length > 0 ? { copyFiles } : {})
    },
    defaultTabs: oxe?.defaultTabs.length ? oxe.defaultTabs : (dotOxe?.defaultTabs ?? [])
  }
  const thread = oxe?.thread ?? dotOxe?.thread
  if (thread) merged.thread = thread

  return { config: merged, sources, worktreeInclude, oxeConfig: oxe }
}

/** Reads `<dir>` template sources (`oxe.yaml`, `.oxe/worktree.yaml`, `orca.yaml`, `.worktreeinclude`); any problem is "no config". */
export async function loadRepoConfig(dir: string): Promise<RepoConfig | null> {
  return (await loadWorktreeTemplate(dir)).config
}

/** Whether `<dir>/oxe.yaml` is there and readable as settings, with the settings when it is (Settings › Tools). */
export async function readRepoConfigState(dir: string): Promise<{ state: 'missing' | 'valid' | 'invalid'; config: RepoConfig | null }> {
  let raw: Buffer
  try {
    raw = await readFile(join(dir, OXE_YAML_FILE))
  } catch (error) {
    return { state: (error as NodeJS.ErrnoException)?.code === 'ENOENT' ? 'missing' : 'invalid', config: null }
  }
  if (raw.length > MAX_FILE_BYTES) return { state: 'invalid', config: null }
  const text = raw.toString('utf8')
  const config = parseOxeYaml(text)
  if (config) return { state: 'valid', config }
  // An empty or comments-only file is valid and sets nothing; anything else that is not settings is invalid.
  try { return load(text) == null ? { state: 'valid', config: null } : { state: 'invalid', config: null } } catch { return { state: 'invalid', config: null } }
}

/** A cheap identity of `<dir>/oxe.yaml` (size and times), or 'missing': changes whenever the file does. Hot path. */
export function repoConfigStamp(dir: string): string {
  try { const info = statSync(join(dir, OXE_YAML_FILE)); return `${info.size}:${info.mtimeMs}:${info.ctimeMs}` } catch { return 'missing' }
}

/** `loadRepoConfig` for a synchronous caller (the `.mcp.json` sync); same bounds, same "no config" on any problem. */
export function loadRepoConfigSync(dir: string): RepoConfig | null {
  try {
    // A FIFO or a link to a device (/dev/zero) would block or never end: only a regular file within the limit is read.
    const info = statSync(join(dir, OXE_YAML_FILE))
    if (!info.isFile() || info.size > MAX_FILE_BYTES) return null
    const raw = readFileSync(join(dir, OXE_YAML_FILE))
    return raw.length > MAX_FILE_BYTES ? null : parseOxeYaml(raw.toString('utf8'))
  } catch {
    return null
  }
}

export async function snapshotRepoConfig(
  rootPath: string,
  trust: RepoHookTrust,
  trustRoot: string = rootPath
): Promise<RepoConfigSnapshot> {
  const config = await loadRepoConfig(rootPath)
  const hashes: RepoConfigSnapshot['hashes'] = {}
  const trusted: RepoConfigSnapshot['trusted'] = {}
  for (const kind of ['setup', 'archive'] as RepoHookKind[]) {
    const script = config?.scripts[kind]
    if (!script) continue
    hashes[kind] = hashHookScript(script)
    trusted[kind] = trust.isTrusted(trustRoot, kind, script)
  }
  return { rootPath: trustRoot, config, hashes, trusted }
}
