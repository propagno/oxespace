/**
 * B7.4 · The project's tool group modes as they apply: the accepted version of `oxe.yaml`'s `thread.tools`. Every
 * security reader of those modes goes through here (thread launch, side chats, Code agents, `.mcp.json`, Settings ›
 * Tools); the guard test in tests/unit/policy-change-guard.test.ts keeps it so. Other `oxe.yaml` keys (scripts, brief,
 * tabs, shared folders) are not power and are read as before.
 */
import { readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { load } from 'js-yaml'
import type { PolicyChangeStatus } from '../../../../shared/policy'
import { projectToolModes, type ProjectToolModes } from '../conversation/tool-groups'
import { MAX_FILE_BYTES, OXE_YAML_FILE, parseOxeYaml } from '../repo-config/parser'
import type { ModesProjection, Subject } from './accepted-config'
import { acceptedConfig } from './index'

export interface EffectiveToolConfig {
  /** The accepted modes, which apply. */
  modes: ProjectToolModes
  /** The file on disk now. */
  file: 'missing' | 'valid' | 'invalid'
  /** The file's modes are not the accepted ones. */
  change: PolicyChangeStatus | null
}

/** `oxe.yaml`'s text as its projection: the normalized mode of each group (list and map forms alike), or `invalid`. No file is the defaults. */
export function parseModesProjection(text: string | null): ModesProjection {
  if (text === null) return { state: 'value', value: projectToolModes(undefined) }
  if (Buffer.byteLength(text, 'utf8') > MAX_FILE_BYTES) return { state: 'invalid', tooLarge: true }
  const config = parseOxeYaml(text)
  if (config) return { state: 'value', value: projectToolModes(config.thread) }
  // An empty or comments-only file is valid and sets nothing; anything else that is not settings is invalid.
  try { return load(text) == null ? { state: 'value', value: projectToolModes(undefined) } : { state: 'invalid' } } catch { return { state: 'invalid' } }
}

export function toolConfigSubject(root: string): Subject | null {
  return acceptedConfig()?.subject('oxe.yaml', 'project', root, join(root, OXE_YAML_FILE)) ?? null
}

const cache = new Map<string, { key: string; version: number; modes: ProjectToolModes; file: EffectiveToolConfig['file'] }>()

/** The accepted tool modes of a project; a `stat` and a map lookup when nothing changed. */
export function effectiveToolConfig(root: string): EffectiveToolConfig {
  const path = join(root, OXE_YAML_FILE)
  const gate = acceptedConfig()
  const subject = gate?.subject('oxe.yaml', 'project', root, path)
  let size = 0
  let statKey = 'missing'
  try {
    const stat = statSync(path)
    if (stat.isFile()) { statKey = `${stat.mtimeMs}:${stat.size}:${stat.ctimeMs}`; size = stat.size }
  } catch { /* no file: the defaults */ }
  const status = () => (gate && subject ? gate.status([subject])[0] ?? null : null)
  const cached = cache.get(path)
  if (cached && cached.key === statKey && cached.version === (gate?.version ?? 0)) return { modes: cached.modes, file: cached.file, change: status() }
  let current: ModesProjection
  let file: EffectiveToolConfig['file'] = 'missing'
  if (statKey === 'missing') current = parseModesProjection(null)
  else if (size > MAX_FILE_BYTES) current = { state: 'invalid', tooLarge: true }
  else {
    let text: string | null = null
    try { text = readFileSync(path, 'utf8') } catch { /* unreadable: invalid */ }
    current = text === null ? { state: 'invalid' } : parseModesProjection(text)
  }
  if (statKey !== 'missing') file = current.state === 'invalid' ? 'invalid' : 'valid'
  const effective = gate && subject ? gate.resolve(subject, current) : current
  const modes = effective.state === 'value' ? effective.value : projectToolModes(undefined)
  cache.set(path, { key: statKey, version: gate?.version ?? 0, modes, file })
  return { modes, file, change: status() }
}

/** `effectiveToolConfig(root).modes`, or the defaults without a project. */
export function effectiveToolModes(root: string | null | undefined): ProjectToolModes {
  return root ? effectiveToolConfig(root).modes : projectToolModes(undefined)
}
