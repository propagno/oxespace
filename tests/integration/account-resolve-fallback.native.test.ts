// @vitest-environment node
// OXE-435: native accounts are user-global. In registerThreadIpc, resolving an account context for a hidden/missing
// OxeChat project, a deleted OxeCode workspace UUID, a missing thread root, or the first-run placeholder
// ('thread:first-run') must fall back cleanly: thread.rootPath (if existing) -> first non-hidden existing thread
// project root -> os.homedir(), without throwing 'Unknown workspace' or 'OxeChat project is unavailable'.
import { EventEmitter } from 'node:events'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, realpathSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { AgentAccountContext } from '../../shared/types/agentAuth'
import type { NativeAuthScope } from '../../electron/main/services/conversation/native-account.service'
import { removeTempDir } from '../helpers/removeTempDir'

type Resolver = (context: AgentAccountContext) => Promise<NativeAuthScope>

const hooks = vi.hoisted(() => ({
  resolvers: [] as Resolver[]
}))

vi.mock('electron', () => ({
  ipcMain: { handle: vi.fn(), handleOnce: vi.fn(), on: vi.fn(), once: vi.fn(), removeHandler: vi.fn(), removeListener: vi.fn() },
  app: { on: vi.fn(), once: vi.fn(), isPackaged: false, getPath: () => tmpdir(), getVersion: () => '1.6.1', getAppPath: () => tmpdir() },
  BrowserWindow: { getAllWindows: () => [], fromWebContents: () => null, getFocusedWindow: () => null },
  WebContentsView: class extends EventEmitter {}, clipboard: {}, ClipboardItem: class {}, dialog: {},
  shell: { openExternal: vi.fn(async () => {}) },
  safeStorage: { isEncryptionAvailable: () => false }, session: { fromPartition: () => ({}) }, net: { isOnline: () => true }
}))

vi.mock('../../electron/main/services/conversation/native-account.service', async importOriginal => {
  const actual = await importOriginal<typeof import('../../electron/main/services/conversation/native-account.service')>()
  return {
    ...actual,
    NativeAccountService: class extends actual.NativeAccountService {
      constructor(...args: ConstructorParameters<typeof actual.NativeAccountService>) {
        super(...args)
        hooks.resolvers.push(args[0].resolve)
      }
    }
  }
})

const { openInMemoryDatabase } = await import('../../electron/main/db/index')
const { registerThreadIpc } = await import('../../electron/main/ipc/thread.ipc')

const cleanups: Array<() => unknown> = []

beforeEach(() => {
  hooks.resolvers.length = 0
})

afterEach(async () => {
  for (const step of cleanups.splice(0).reverse()) await step()
})

async function setup() {
  const temp = realpathSync.native(mkdtempSync(join(tmpdir(), 'oxe-435-resolve-')))
  cleanups.push(() => removeTempDir(temp))
  const db = openInMemoryDatabase()
  cleanups.push(() => db.close())
  const runtime = registerThreadIpc(db, {
    bridge: join(temp, 'bridge.cjs'),
    prepare: async () => ({ OXESPACE_EXECUTION_ID: 'e1', OXESPACE_EXECUTION_TOKEN: 't1' }),
    end: () => {}
  })
  cleanups.push(() => runtime.stop())
  await runtime.manager
  expect(hooks.resolvers).toHaveLength(1)
  return { temp, db, runtime, resolve: hooks.resolvers[0] }
}

function initRepo(dir: string): string {
  mkdirSync(dir, { recursive: true })
  execFileSync('git', ['init', dir], { windowsHide: true, stdio: 'ignore' })
  return realpathSync.native(dir)
}

describe('OXE-435: registerThreadIpc account scope resolution fallback', () => {
  test('falls back to os.homedir() for first-run, missing projects, and deleted OxeCode workspaces when no visible project exists', async () => {
    const { resolve } = await setup()
    for (const workspaceId of ['thread:first-run', 'thread:missing-project', 'deleted-oxecode-uuid']) {
      const scope = await resolve({ provider: 'antigravity', workspaceId })
      expect(scope.provider).toBe('antigravity')
      expect(scope.command).toBe('agy')
      expect(scope.cwd).toBe(homedir())
    }
  })

  test('falls back to the first non-hidden existing thread project when given a hidden project or deleted Code workspace UUID', async () => {
    const { temp, runtime, resolve } = await setup()
    const hiddenDir = initRepo(join(temp, 'a-hidden'))
    const visibleDir = initRepo(join(temp, 'b-visible'))
    const hiddenProject = await runtime.projects.add(hiddenDir)
    await runtime.projects.add(visibleDir)
    runtime.projects.setHidden(hiddenProject.projectId, true)

    const fromHidden = await resolve({ provider: 'antigravity', workspaceId: `thread:${hiddenProject.projectId}` })
    expect(fromHidden.cwd).toBe(visibleDir)

    const fromDeletedWorkspace = await resolve({ provider: 'antigravity', workspaceId: 'deleted-oxecode-uuid' })
    expect(fromDeletedWorkspace.cwd).toBe(visibleDir)

    const fromFirstRun = await resolve({ provider: 'claude', workspaceId: 'thread:first-run' })
    expect(fromFirstRun.cwd).toBe(visibleDir)
  })

  test('accepts a legacy thread whose workspaceId was a deleted Code workspace UUID when resolved via thread:<projectId>', async () => {
    const { temp, db, runtime, resolve } = await setup()
    const projectDir = initRepo(join(temp, 'legacy-project'))
    const project = await runtime.projects.add(projectDir)
    const thread = {
      id: 'legacy-thread-1',
      workspaceId: 'deleted-code-ws-uuid',
      projectId: project.projectId,
      rootPath: projectDir,
      provider: 'antigravity',
      title: 'Legacy',
      pinned: false,
      status: 'idle',
      nativeSessionId: null,
      createdAt: 1,
      updatedAt: 1
    }
    db.prepare('INSERT INTO conversation_threads (id, workspace_id, thread_project_id, data_json) VALUES (?, ?, ?, ?)')
      .run(thread.id, thread.workspaceId, thread.projectId, JSON.stringify(thread))

    const byProject = await resolve({ provider: 'antigravity', workspaceId: `thread:${project.projectId}`, threadId: thread.id })
    expect(byProject.cwd).toBe(projectDir)

    // Still rejects a provider mismatch on an existing thread.
    await expect(resolve({ provider: 'codex', workspaceId: `thread:${project.projectId}`, threadId: thread.id })).rejects.toThrow('Invalid account context')
  })
})
