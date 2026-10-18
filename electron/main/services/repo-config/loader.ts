import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { RepoConfig, RepoConfigSnapshot, RepoHookKind } from '../../../../shared/types/repo-config'
import { MAX_FILE_BYTES, OXE_YAML_FILE, parseOxeYaml } from './parser'
import { hashHookScript, type RepoHookTrust } from './trust'

/** Reads `<dir>/oxe.yaml`; any I/O or parse problem is "no config", never an error. */
export async function loadRepoConfig(dir: string): Promise<RepoConfig | null> {
  try {
    const raw = await readFile(join(dir, OXE_YAML_FILE))
    if (raw.length > MAX_FILE_BYTES) return null
    return parseOxeYaml(raw.toString('utf8'))
  } catch {
    return null
  }
}

export async function snapshotRepoConfig(rootPath: string, trust: RepoHookTrust): Promise<RepoConfigSnapshot> {
  const config = await loadRepoConfig(rootPath)
  const hashes: RepoConfigSnapshot['hashes'] = {}
  const trusted: RepoConfigSnapshot['trusted'] = {}
  for (const kind of ['setup', 'archive'] as RepoHookKind[]) {
    const script = config?.scripts[kind]
    if (!script) continue
    hashes[kind] = hashHookScript(script)
    trusted[kind] = trust.isTrusted(rootPath, kind, script)
  }
  return { rootPath, config, hashes, trusted }
}
