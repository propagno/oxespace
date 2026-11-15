import { mkdir, readFile, readdir, stat, unlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

const OWNER_ID = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/
const CAPTURE_NAME = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}\.png$/

/** The capture root keeps only this many PNG files, across every owner folder (OXE-110, RT-2). */
export const PREVIEW_CAPTURE_LIMIT = 50

/** A capture file name: a short PNG basename, never a path. */
export function isPreviewCaptureName(value: unknown): value is string {
  return typeof value === 'string' && CAPTURE_NAME.test(value)
}

function checkOwner(ownerId: string): void {
  if (!OWNER_ID.test(ownerId)) throw new Error('Invalid preview capture owner')
}

/** Saves a preview image only within the application's private capture root. */
export async function savePreviewCapture(root: string, ownerId: string, fileName: string, png: Buffer): Promise<{ directory: string; path: string }> {
  checkOwner(ownerId)
  if (!isPreviewCaptureName(fileName)) throw new Error('Invalid preview capture file name')
  const directory = join(root, ownerId)
  await mkdir(directory, { recursive: true })
  const path = join(directory, fileName)
  await writeFile(path, png, { flag: 'wx' })
  await prunePreviewCaptures(root)
  return { directory, path }
}

/** Reads one owner's capture by file name; another owner's folder is never reached. */
export async function readPreviewCapture(root: string, ownerId: string, fileName: string): Promise<Buffer> {
  checkOwner(ownerId)
  if (!isPreviewCaptureName(fileName)) throw new Error('Invalid preview capture file name')
  return readFile(join(root, ownerId, fileName))
}

/** Keeps only the newest captures in the whole root, whichever owner they belong to. */
async function prunePreviewCaptures(root: string, keep = PREVIEW_CAPTURE_LIMIT): Promise<void> {
  const files: Array<{ path: string; mtime: number }> = []
  const owners = await readdir(root, { withFileTypes: true }).catch(() => [])
  for (const owner of owners) {
    if (!owner.isDirectory()) continue
    const directory = join(root, owner.name)
    const entries = await readdir(directory, { withFileTypes: true }).catch(() => [])
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.toLowerCase().endsWith('.png')) continue
      const path = join(directory, entry.name)
      try {
        files.push({ path, mtime: (await stat(path)).mtimeMs })
      } catch {
        // Removed meanwhile.
      }
    }
  }
  if (files.length <= keep) return
  files.sort((a, b) => b.mtime - a.mtime)
  for (const file of files.slice(keep)) await unlink(file.path).catch(() => undefined)
}
