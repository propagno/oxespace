import { randomBytes } from 'node:crypto'
import { readFile, rename, writeFile } from 'node:fs/promises'

/** Writes JSON readable by the owner only (mode 0600), through a temporary file beside it and a rename. */
export async function writePrivateJson(path: string, value: unknown): Promise<void> {
  const temp = `${path}.${randomBytes(8).toString('hex')}.tmp`
  await writeFile(temp, JSON.stringify(value, null, 2) + '\n', { mode: 0o600 })
  await rename(temp, path)
}

/** Reads a JSON object; a missing file reads as `{}`, any other error is thrown. */
export async function readJson(path: string): Promise<Record<string, unknown>> {
  try { return JSON.parse(await readFile(path, 'utf8')) } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return {}
    throw error
  }
}
