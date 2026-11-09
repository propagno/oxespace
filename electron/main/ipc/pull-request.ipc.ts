import { ipcMain } from 'electron'
import { isAbsolute } from 'node:path'
import { IPC_CHANNELS } from '../../../shared/types/ipc'
import type { PullRequestStateInput } from '../../../shared/types/pull-request'
import { GhExec } from '../services/github/gh-exec'
import { createPrCliRunner } from '../services/pull-request/pr-cli-runner'
import { PullRequestProvider } from '../services/pull-request/pr-provider'

/** `pull-request:state` input: an absolute project root and a branch (its safety is the provider's S3 check). */
export function parsePullRequestStateInput(value: unknown): PullRequestStateInput {
  if (!value || typeof value !== 'object') throw new Error('Invalid pull request input.')
  const { rootPath, branch } = value as Record<string, unknown>
  if (typeof rootPath !== 'string' || !rootPath.trim() || rootPath.length > 4096 || !isAbsolute(rootPath)) throw new Error('Invalid project root.')
  if (typeof branch !== 'string' || !branch || branch.length > 255) throw new Error('Invalid branch.')
  return { rootPath, branch }
}

/** The app's provider: remote and merge-base through safe git, gh and az through the PR CLI runner. */
export function createPullRequestProvider(exec = new GhExec()): PullRequestProvider {
  return new PullRequestProvider({
    run: createPrCliRunner(exec),
    remoteUrl: async (rootPath) => {
      const names = (await exec.tryGit(['remote'], rootPath)).split(/\r?\n/).map(name => name.trim()).filter(name => name && !name.startsWith('-'))
      const name = names.includes('origin') ? 'origin' : names[0]
      if (!name) return null
      return (await exec.tryGit(['remote', 'get-url', name], rootPath)).trim() || null
    },
    gitMerged: async ({ rootPath, branch, base }) => (await exec.git(['merge-base', '--is-ancestor', branch, base], rootPath)).status === 0
  })
}

/** A60: the window's Pull request tab. Excluded from MCP; agents read pull requests with oxespace_github. */
export function registerPullRequestIpc(provider = createPullRequestProvider()): PullRequestProvider {
  ipcMain.handle(IPC_CHANNELS.pullRequest.state, (_event, input: unknown) => provider.state(parsePullRequestStateInput(input)))
  return provider
}
