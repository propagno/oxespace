import { rmSync } from 'node:fs'

/**
 * Removes a test's temp directory. On Windows a just-exited git or watcher
 * process can keep a directory handle for a while (EPERM/EBUSY); a leftover
 * temp folder is reclaimed by the OS and must not fail a test whose assertions
 * already passed. Elsewhere the error is real and is thrown.
 */
export function removeTempDir(path: string): void {
  try {
    rmSync(path, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 })
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (process.platform === 'win32' && (code === 'EPERM' || code === 'EBUSY' || code === 'ENOTEMPTY')) return
    throw error
  }
}
