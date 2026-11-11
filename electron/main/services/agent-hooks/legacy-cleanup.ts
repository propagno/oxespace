import { readFile, rm } from 'node:fs/promises'
import { writePrivateJson } from '../private-json'

const LEGACY_MEMORY_HOOK_SCRIPT = 'oxespace-memory-hook.cjs'

export interface LegacyAgentHookPaths {
  claudeSettings: string
  codexHooks: string
  memoryAdapters?: string
}

export interface LegacyAgentHookCleanupResult {
  changed: string[]
  skipped: Array<{ path: string; reason: string }>
}

type HookGroup = {
  matcher?: string
  hooks?: unknown[]
  [key: string]: unknown
}

function isLegacyMemoryHook(value: unknown): boolean {
  return JSON.stringify(value ?? null).includes(LEGACY_MEMORY_HOOK_SCRIPT)
}

/**
 * G4 (1.5.0): removes retired AI Memory hook entries from the user's Claude and
 * Codex configuration files and deletes the legacy `<userData>/memory/adapters`
 * directory. User hooks, RTK hooks, OXESpace status hooks and unrelated settings
 * are preserved in order; files without legacy entries or that cannot be parsed
 * are never rewritten.
 */
export async function removeLegacyAgentHooks(paths: LegacyAgentHookPaths): Promise<LegacyAgentHookCleanupResult> {
  const changed: string[] = []
  const skipped: Array<{ path: string; reason: string }> = []

  for (const filePath of [paths.claudeSettings, paths.codexHooks]) {
    let raw: string
    try {
      raw = await readFile(filePath, 'utf8')
    } catch (error) {
      if ((error as NodeJS.ErrnoException)?.code === 'ENOENT') continue
      skipped.push({ path: filePath, reason: error instanceof Error ? error.message : String(error) })
      continue
    }

    let doc: Record<string, unknown>
    try {
      const parsed: unknown = JSON.parse(raw)
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        skipped.push({ path: filePath, reason: 'Config root is not a JSON object' })
        continue
      }
      doc = parsed as Record<string, unknown>
    } catch (error) {
      skipped.push({ path: filePath, reason: error instanceof Error ? error.message : String(error) })
      continue
    }

    if (doc.hooks === undefined) continue
    if (!doc.hooks || typeof doc.hooks !== 'object' || Array.isArray(doc.hooks)) {
      skipped.push({ path: filePath, reason: 'hooks field is not an object' })
      continue
    }

    const hooks = doc.hooks as Record<string, unknown>
    const nextHooks: Record<string, unknown> = {}
    let removedAny = false

    for (const [eventName, groups] of Object.entries(hooks)) {
      if (!Array.isArray(groups)) {
        nextHooks[eventName] = groups
        continue
      }
      const keptGroups = groups.flatMap((group: HookGroup) => {
        if (!group || typeof group !== 'object' || Array.isArray(group) || !Array.isArray(group.hooks)) {
          if (isLegacyMemoryHook(group)) {
            removedAny = true
            return []
          }
          return [group]
        }
        const keptHooks = group.hooks.filter((hook) => !isLegacyMemoryHook(hook))
        if (keptHooks.length !== group.hooks.length) removedAny = true
        if (keptHooks.length === 0) return []
        if (keptHooks.length === group.hooks.length) return [group]
        return [{ ...group, hooks: keptHooks }]
      })
      if (keptGroups.length > 0) {
        nextHooks[eventName] = keptGroups
      } else if (groups.length > 0) {
        removedAny = true
      }
    }

    if (!removedAny) continue
    await writePrivateJson(filePath, { ...doc, hooks: nextHooks })
    changed.push(filePath)
  }

  if (paths.memoryAdapters) {
    await rm(paths.memoryAdapters, { recursive: true, force: true }).catch(() => undefined)
  }

  return { changed, skipped }
}
