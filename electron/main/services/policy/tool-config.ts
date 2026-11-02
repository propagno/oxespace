/**
 * B7.4 · The project's tool group modes as they apply: the accepted version of `oxe.yaml`'s `thread.tools`. Every
 * security reader of those modes goes through here (thread launch, side chats, Code agents, `.mcp.json`, Settings ›
 * Tools); the guard test in tests/unit/policy-change-guard.test.ts keeps it so. Other `oxe.yaml` keys (scripts, brief,
 * tabs, shared folders) are not power and are read as before.
 */
import { readFileSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { load } from 'js-yaml'
import type { PolicyChangeStatus } from '../../../../shared/policy'
import { projectToolModes, type ProjectToolModes } from '../conversation/tool-groups'
import type { ConfigurableMcpToolGroup } from '../../../../shared/types/mcp-tools'
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
  /** The modes are the app's defaults because neither the file nor an accepted version gave any (an invalid file, first read). */
  defaulted?: boolean
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

const cache = new Map<string, { key: string; version: number; modes: ProjectToolModes; file: EffectiveToolConfig['file']; defaulted: boolean }>()

/** The accepted tool modes of a project; a `stat` and a map lookup when nothing changed. */
/** `defer`: a sweep of every project (the boot sync): the floor applies, and a change found waits for that project's review point. */
export function effectiveToolConfig(root: string, options: { defer?: boolean } = {}): EffectiveToolConfig {
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
  if (cached && cached.key === statKey && cached.version === (gate?.version ?? 0)) return { modes: cached.modes, file: cached.file, change: status(), defaulted: cached.defaulted }
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
  const effective = gate && subject ? gate.resolve(subject, current, options) : current
  const defaulted = effective.state !== 'value'
  const modes = defaulted ? projectToolModes(undefined) : effective.value
  cache.set(path, { key: statKey, version: gate?.version ?? 0, modes, file, defaulted })
  return { modes, file, change: status(), defaulted }
}

/** `effectiveToolConfig(root).modes`, or the defaults without a project. */
export function effectiveToolModes(root: string | null | undefined, options: { defer?: boolean } = {}): ProjectToolModes {
  return root ? effectiveToolConfig(root, options).modes : projectToolModes(undefined)
}

export interface EnforcedToolModes {
  modes: ProjectToolModes
  file: EffectiveToolConfig['file']
  /** 'file' unless the file is invalid; then 'last-valid' (the last valid or accepted modes) or 'defaults' (none ever). */
  effectiveFrom: 'file' | 'last-valid' | 'defaults'
}

/**
 * The tool modes enforcement uses (tools/call, mcp-internal/tool-policy.ts) and Settings › Tools reports, so the two
 * never disagree. On top of the accepted version (effectiveToolConfig), it fails closed for this run: deleting the
 * file, or making it unreadable, invalid or too large, is one command for the same agent, so it never lifts an `off`
 * read earlier; the root keeps the last modes read from a valid file, and only a root never read uses what the gate
 * resolves (the accepted version, or the defaults if there never was one). effectiveToolConfig caches by file stat
 * and gate version, so an accepted widening applies at the next call.
 */
const enforced = new Map<string, ProjectToolModes>()
/** One entry per folder however it is spelled (`C:\x`, `c:/x/`), so a second spelling has no fail-closed memory of its own. */
const rootKey = (root: string): string => { const full = resolve(root); return process.platform === 'win32' ? full.toLowerCase() : full }
export function enforcedToolModes(root: string, options: { defer?: boolean } = {}): EnforcedToolModes {
  const key = rootKey(root)
  const cached = enforced.get(key)
  const effective = effectiveToolConfig(root, options)
  // Missing, unreadable, invalid or too large: the last valid read stands.
  let modes = effective.file === 'valid' ? effective.modes : cached ?? effective.modes
  // A valid rewrite that just drops a group's value (or misspells it, `offf`) does not lift an `off` read earlier; a
  // value the project states (`on-demand`, `always`), once accepted, does.
  if (effective.file === 'valid' && cached) {
    modes = Object.fromEntries(Object.entries(modes).map(([group, entry]) =>
      [group, entry.source === 'default' && cached[group as ConfigurableMcpToolGroup].mode === 'off' ? cached[group as ConfigurableMcpToolGroup] : entry])) as ProjectToolModes
  }
  enforced.set(key, modes)
  const effectiveFrom = effective.file !== 'invalid' ? 'file' : cached || !effective.defaulted ? 'last-valid' : 'defaults'
  return { modes, file: effective.file, effectiveFrom }
}
