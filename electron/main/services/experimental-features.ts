import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Features that ship off by default. The persisted setting lives in
 * `<userData>/experimental.json` and `OXESPACE_EXPERIMENTAL_MEMORY` overrides it
 * ("1" on, "0" off). The value is read once per process: changing it needs a restart,
 * which keeps every gate (settings page, MCP tools, hooks, service start) consistent.
 */
let directory: string | undefined
let cached: boolean | undefined

export function configureExperimentalFeatures(userDataDirectory: string): void {
  directory = userDataDirectory
  cached = undefined
}

/** Shared Project Memory: off unless the setting or the environment override turns it on. */
export function sharedProjectMemoryEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  if (env.OXESPACE_EXPERIMENTAL_MEMORY === '1') return true
  if (env.OXESPACE_EXPERIMENTAL_MEMORY === '0') return false
  if (cached !== undefined) return cached
  let value = false
  if (directory) {
    try { value = JSON.parse(readFileSync(join(directory, 'experimental.json'), 'utf8'))?.sharedProjectMemory === true } catch { /* Missing or unreadable file means off. */ }
  }
  cached = value
  return value
}
