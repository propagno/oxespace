import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

/** Saves a preview image only within the application's private capture root. */
export async function savePreviewCapture(root: string, ownerId: string, fileName: string, png: Buffer): Promise<{ directory: string; path: string }> {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/.test(ownerId)) throw new Error('Invalid preview capture owner')
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}\.png$/.test(fileName)) throw new Error('Invalid preview capture file name')
  const directory = join(root, ownerId)
  await mkdir(directory, { recursive: true })
  const path = join(directory, fileName)
  await writeFile(path, png, { flag: 'wx' })
  return { directory, path }
}
