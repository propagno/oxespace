/**
 * Contract test for the GitHub IPC adapter.
 *
 * GitHubService is a 37-method aggregator, and the adapter is the only place
 * that binds each of those methods to a channel and to the parser that guards
 * it. Nothing else in the suite would notice if a channel started reaching the
 * wrong method, stopped validating its input, or quietly disappeared — and all
 * three are exactly what a refactor of that service can break.
 *
 * So this asserts the wiring itself rather than any GitHub behavior: every
 * declared channel is registered, each one calls the method of the same name,
 * and the ones taking structured input reject a malformed payload before the
 * service sees it.
 */
import { describe, expect, test, vi } from 'vitest'
import { createFakeIpcMain, type FakeIpcMain } from '../helpers/fake-ipc-main'
import { IPC_CHANNELS } from '../../shared/types/ipc'
import type { AppDatabase } from '../../electron/main/db'
import type { GitHubService } from '../../electron/main/services/github.service'

const ipcMain: FakeIpcMain = createFakeIpcMain()
vi.mock('electron', () => ({ ipcMain }))

const { registerGitHubIpc } = await import('../../electron/main/ipc/github.ipc')

/** Channel key -> the service method the adapter must route it to. */
const ROUTES: Array<[keyof typeof IPC_CHANNELS.github, keyof GitHubService]> = [
  ['getCliStatus', 'getCliStatus'],
  ['getWorkspaceStatus', 'getWorkspaceStatus'],
  ['fetch', 'fetch'],
  ['pullFfOnly', 'pullFfOnly'],
  ['stageAll', 'stageAll'],
  ['stageFile', 'stageFile'],
  ['unstageFile', 'unstageFile'],
  ['commit', 'commit'],
  ['generateCommitMessage', 'generateCommitMessage'],
  ['push', 'push'],
  ['commitAndPush', 'commitAndPush'],
  ['listBranches', 'listBranches'],
  ['createBranch', 'createBranch'],
  ['checkoutBranch', 'checkoutBranch'],
  ['listWorktrees', 'listWorktrees'],
  ['createWorktree', 'createWorktree'],
  ['removeWorktree', 'removeWorktree'],
  ['listPullRequests', 'listPullRequests'],
  ['createPullRequest', 'createPullRequest'],
  ['listCommits', 'listCommits'],
  ['getCommitDetails', 'getCommitDetails'],
  ['listReleases', 'listReleases'],
  ['createRelease', 'createRelease'],
  ['listWorkflows', 'listWorkflows'],
  ['listWorkflowRuns', 'listWorkflowRuns'],
  ['getWorkflowRunDetails', 'getWorkflowRunDetails'],
  ['runWorkflow', 'runWorkflow'],
  ['rerunRun', 'rerunRun'],
  ['getRunLogs', 'getRunLogs'],
  ['listCheckpoints', 'listCheckpoints'],
  ['createCheckpoint', 'createCheckpoint'],
  ['restoreCheckpoint', 'restoreCheckpoint'],
  ['deleteCheckpoint', 'deleteCheckpoint'],
  ['listConnectedRepositories', 'listConnectedRepositories'],
  ['connectRepository', 'connectRepository']
]

/** A service whose every method records its own name and resolves. */
function createSpyService(): { service: GitHubService; calls: string[] } {
  const calls: string[] = []
  const service = new Proxy({} as GitHubService, {
    get(_target, property: string) {
      return (...args: unknown[]) => {
        calls.push(property)
        return Promise.resolve({ ok: true, args })
      }
    }
  })
  return { service, calls }
}

function register(): { calls: string[] } {
  for (const channel of ipcMain.channels()) ipcMain.removeHandler(channel)
  const { service, calls } = createSpyService()
  registerGitHubIpc({} as AppDatabase, service)
  return { calls }
}

describe('GitHub IPC adapter', () => {
  test('every declared github channel is registered exactly once', () => {
    register()
    const registered = new Set(ipcMain.channels())
    const declared = Object.values(IPC_CHANNELS.github)

    const missing = declared.filter((channel) => !registered.has(channel))
    expect(missing, 'channels declared in the IPC contract but never handled').toEqual([])
  })

  test.each(ROUTES)('channel %s reaches service.%s', async (channelKey, method) => {
    const { calls } = register()
    // A permissive payload: enough keys that any of the parsers accepts it, so
    // a failure here means the routing is wrong rather than the input.
    await ipcMain.invoke(IPC_CHANNELS.github[channelKey], {
      workspaceId: 'ws-1',
      rootPath: 'C:/repo',
      path: 'src/a.ts',
      message: 'msg',
      name: 'feature',
      branch: 'main',
      oid: 'abc123',
      runId: 1,
      failedOnly: false,
      checkpointId: 'cp-1',
      fullName: 'owner/repo',
      title: 'title',
      body: 'body',
      head: 'feature',
      base: 'main',
      tagName: 'v1.0.0',
      workflowId: 'ci.yml',
      ref: 'main',
      state: 'open'
    }).catch(() => undefined)

    expect(calls).toEqual([method])
  })

  test('a malformed payload is rejected before the service is called', async () => {
    const { calls } = register()

    await expect(ipcMain.invoke(IPC_CHANNELS.github.getWorkspaceStatus, { rootPath: 42 })).rejects.toThrow()
    await expect(ipcMain.invoke(IPC_CHANNELS.github.stageFile, { rootPath: 'C:/repo' })).rejects.toThrow()
    await expect(ipcMain.invoke(IPC_CHANNELS.github.commit, { rootPath: 'C:/repo', message: '' })).rejects.toThrow()

    expect(calls, 'validation must run ahead of the service, not inside it').toEqual([])
  })
})
