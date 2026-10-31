import { readFileSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { load } from 'js-yaml'
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

/** `loadRepoConfig` for a synchronous caller (the `.mcp.json` sync); same bounds, same "no config" on any problem. */
export function loadRepoConfigSync(dir: string): RepoConfig | null {
  try {
    const raw = readFileSync(join(dir, OXE_YAML_FILE))
    return raw.length > MAX_FILE_BYTES ? null : parseOxeYaml(raw.toString('utf8'))
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
