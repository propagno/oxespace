import type { GitDiff } from '../../../../shared/types/git'
import type { ConversationThread } from '../../../../shared/types/thread'
import { execGit } from '../../utils/safe-git'

/**
 * CR-F4-3 (moved out of ThreadOrchestrator with no behaviour change): the project's changes against HEAD, read in the
 * checkout the conversation works in. `recheck` runs after the diff is read, so a conversation deleted meanwhile throws.
 */
export async function projectDiffAt(thread: ConversationThread, recheck: () => void): Promise<GitDiff> {
  // The project's changes live in the worktree the provider moved into, when it reported one.
  const rootPath = thread.observedLocation?.sameRepository && thread.observedLocation.checkoutRoot ? thread.observedLocation.checkoutRoot : thread.rootPath
  const run = async (args: string[]) => (await execGit(rootPath, args, { maxBuffer: 2 * 1024 * 1024, timeout: 15000 })).stdout
  let hasHead = true
  try { await run(['rev-parse', '--verify', 'HEAD']) } catch { hasHead = false }
  const args = ['--no-pager', 'diff', '--no-ext-diff', '--no-textconv', '--unified=3']
  let raw: string
  try { raw = await run([...args, hasHead ? 'HEAD' : (await run(['hash-object', '-t', 'tree', '--stdin'])).trim(), '--']) }
  catch { throw Error('Could not read tracked project changes. Check the repository and retry.') }
  recheck()
  const { parseDiffOutput } = await import('../git.service')
  return { files: parseDiffOutput(raw), base: hasHead ? 'HEAD' : 'Unborn branch', includeUncommitted: true, compiledAt: Date.now() }
}
