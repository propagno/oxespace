import { realpath } from 'node:fs/promises'
import { resolve } from 'node:path'
import { execGit } from '../utils/safe-git'

/** Runs the identity probe again once when it timed out; any other failure is thrown as is. */
export async function retryIdentityProbe<T>(probe: () => Promise<T>): Promise<T> {
  try { return await probe() }
  catch (error) {
    const failure = error as { killed?: boolean; code?: string }
    if (failure?.killed || failure?.code === 'ETIMEDOUT') return probe()
    throw error
  }
}

/**
 * A project's identity: the real path of its Git common dir (so every worktree of a repository shares one), or the
 * real path of the folder when it is not a repository. Lower-cased with forward slashes on Windows.
 */
export async function projectIdentity(cwd: string): Promise<string> {
  const root = await realpath(cwd)
  let identity = root
  try {
    const probe = () => execGit(root, ['rev-parse', '--path-format=absolute', '--git-common-dir'], { timeout: 2000 })
    // A heavily loaded Windows host can delay process startup beyond the
    // bounded probe. Retry one timeout only; never convert it into a new identity.
    const result = await retryIdentityProbe(probe)
    identity = await realpath(resolve(root, result.stdout.trim()))
  } catch (error) {
    // Timeouts, missing Git and permission errors must not mint a second identity.
    if (!String((error as { stderr?: string }).stderr).includes('not a git repository')) throw error
  }
  return process.platform === 'win32' ? identity.replace(/\\/g, '/').toLowerCase() : identity
}
