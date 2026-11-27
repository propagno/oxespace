/**
 * B7.4 / OXE-444 · Gated atomic writer for `<primaryRoot>/oxe.yaml` worktree template fields.
 *
 * Lives under `services/policy/` so every write to the B7.4 gated `oxe.yaml` file honors pending
 * policy changes (`assertAccepted` / `markIntent` / `commitIntent`), refuses symlinks via `lstat`,
 * preserves unrelated sections (`defaultTabs`, `thread`, etc.), and replaces atomically.
 */
import { randomUUID } from 'node:crypto'
import { lstat, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { load } from 'js-yaml'
import { MAX_FILE_BYTES, OXE_YAML_FILE } from '../repo-config/parser'
import { acceptedConfig } from './index'
import { parseModesProjection, toolConfigSubject } from './tool-config'

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

export async function writeGatedOxeYaml(
  primaryRoot: string,
  updateDoc: (existingDoc: Record<string, unknown>) => Record<string, unknown>,
  serializeDoc: (doc: Record<string, unknown>) => string
): Promise<void> {
  const oxePath = join(primaryRoot, OXE_YAML_FILE)
  await assertNotSymlink(oxePath)

  let existingRaw: string | null = null
  let existingDoc: Record<string, unknown> = {}
  const existingInfo = await tryLstat(oxePath)
  if (existingInfo) {
    if (existingInfo.size > MAX_FILE_BYTES) {
      throw new Error('Existing oxe.yaml exceeds maximum allowed size.')
    }
    existingRaw = await readFile(oxePath, 'utf8')
    const parsed = existingRaw.trim() ? load(existingRaw) : {}
    if (parsed !== null && parsed !== undefined) {
      if (typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new Error('Existing oxe.yaml is not a YAML mapping.')
      }
      existingDoc = { ...(parsed as Record<string, unknown>) }
    }
  }

  // B7.4: never silently overwrite or accept an unreviewed policy change in oxe.yaml.
  const gate = acceptedConfig()
  const subject = toolConfigSubject(primaryRoot)
  if (gate && subject) {
    await gate.assertAccepted(subject, parseModesProjection(existingRaw))
  }

  const nextDoc = updateDoc(existingDoc)
  const shouldWriteOxe = existingInfo !== null || Object.keys(nextDoc).length > 0
  if (!shouldWriteOxe) return

  const serialized = Object.keys(nextDoc).length > 0 ? serializeDoc(nextDoc) : ''
  const written = parseModesProjection(serialized)
  const intent = gate && subject ? gate.markIntent(subject, written) : null
  try {
    await writeAtomic(oxePath, serialized)
  } catch (error) {
    if (gate && subject && intent) gate.clearIntent(subject, intent)
    throw error
  }
  if (gate && subject && intent) gate.commitIntent(subject, intent, written)
}
