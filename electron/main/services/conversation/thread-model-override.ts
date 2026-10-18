import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { ThreadProvider } from '../../../../shared/types/thread'

/** Settings files are small; anything bigger is not a settings file we should parse. */
const MAX_BYTES = 256 * 1024

export interface ModelOverrideEvidence {
  /** True when something other than the provider's catalog can pick the model. */
  mayOverride: boolean
}

async function read(path: string): Promise<string | null> {
  try {
    const text = await readFile(path, 'utf8')
    return text.length <= MAX_BYTES ? text : null
  } catch { return null }
}

/** A Claude settings file picks a model through `model` or through `env.ANTHROPIC_MODEL`. */
export function claudeSettingsPickModel(text: string): boolean {
  try {
    const value = JSON.parse(text) as { model?: unknown; env?: { ANTHROPIC_MODEL?: unknown } }
    return typeof value.model === 'string' && value.model.trim() !== ''
      || typeof value.env?.ANTHROPIC_MODEL === 'string' && value.env.ANTHROPIC_MODEL.trim() !== ''
  } catch { return false }
}

/** Only top-level keys count: a `model` inside `[profiles.x]` is not the default. */
export function codexConfigPicksModel(text: string): boolean {
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (trimmed.startsWith('[')) return false
    if (/^model\s*=\s*["'][^"']+["']/.test(trimmed)) return true
  }
  return false
}

/**
 * The provider's catalog names a default, but the project or the user's own
 * configuration can choose a different one. When that is possible the default
 * is unknown, and saying otherwise would label the wrong model as the default.
 */
export async function detectModelOverride(provider: ThreadProvider, rootPath: string, env: NodeJS.ProcessEnv = process.env): Promise<ModelOverrideEvidence> {
  let mayOverride = false
  const consider = async (path: string, picks: (text: string) => boolean): Promise<void> => {
    const text = await read(path)
    if (text === null) return
    const picked = picks(text)
    if (picked) mayOverride = true
  }
  if (provider === 'claude') {
    if (env.ANTHROPIC_MODEL?.trim()) { mayOverride = true }
    const home = env.CLAUDE_CONFIG_DIR?.trim() || join(homedir(), '.claude')
    await Promise.all([
      consider(join(rootPath, '.claude', 'settings.json'), claudeSettingsPickModel),
      consider(join(rootPath, '.claude', 'settings.local.json'), claudeSettingsPickModel),
      consider(join(home, 'settings.json'), claudeSettingsPickModel)
    ])
  } else {
    const home = env.CODEX_HOME?.trim() || join(homedir(), '.codex')
    await Promise.all([
      consider(join(rootPath, '.codex', 'config.toml'), codexConfigPicksModel),
      consider(join(home, 'config.toml'), codexConfigPicksModel)
    ])
  }
  return { mayOverride }
}
