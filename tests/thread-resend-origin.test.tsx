// Only text the person just typed has the window's authority. End to end: the real components, the real preload
// bridge, the real IPC handler and ThreadManager on a temporary database. Every button here refuses or dispatches
// before any agent would start, and the account and catalog reads are doubles, so no agent is ever launched.
import { EventEmitter } from 'node:events'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { removeTempDir } from './helpers/removeTempDir'
import type { ThreadEvent } from '../shared/types/thread'
import type { Workspace } from '../shared/types/workspace'

type Handler = (event: unknown, ...args: unknown[]) => unknown
const hooks = vi.hoisted(() => ({ ipcMain: null as unknown as object }))
class FakeIpcMain extends EventEmitter {
  readonly handlers = new Map<string, Handler>()
  handle(channel: string, handler: Handler): void { this.handlers.set(channel, handler) }
  removeHandler(channel: string): void { this.handlers.delete(channel) }
}
vi.mock('electron', () => ({
  ipcMain: hooks.ipcMain,
  app: { on: vi.fn(), once: vi.fn(), isPackaged: false, getPath: () => tmpdir(), getVersion: () => '1.5.2', getAppPath: () => tmpdir() },
  BrowserWindow: { getAllWindows: () => [], fromWebContents: () => null, getFocusedWindow: () => null },
  WebContentsView: class {}, clipboard: {}, ClipboardItem: class {}, dialog: {}, shell: {}, safeStorage: { isEncryptionAvailable: () => false },
  session: { fromPartition: () => ({}) }, net: { isOnline: () => true }
}))
vi.mock('../src/hooks/useGitBranch', () => ({ useGitBranch: () => ({ branch: 'main', detached: false, shortSha: null, error: null }) }))
hooks.ipcMain = new FakeIpcMain()
const ipc = hooks.ipcMain as FakeIpcMain

const { openInMemoryDatabase } = await import('../electron/main/db/index')
const { registerThreadIpc } = await import('../electron/main/ipc/thread.ipc')
const { createOxeApi } = await import('../electron/preload/api')
const { ThreadView } = await import('../src/components/Threads/ThreadView')
const { ThreadMessageRow } = await import('../src/components/Threads/ThreadMessageRow')
const { CommandBar } = await import('../src/components/CommandBar/CommandBar')
const { useAccountStore } = await import('../src/store/account.store')
const { useThreadStore } = await import('../src/store/thread.store')
const { useWorkspaceStore } = await import('../src/store/workspace.store')
const { useSkillStore } = await import('../src/store/skill.store')

// A fixture inside someone's repository never reads that repository.
vi.stubEnv('GIT_CEILING_DIRECTORIES', realpathSync.native(tmpdir()))
vi.setConfig({ testTimeout: 40_000, hookTimeout: 40_000 })

const STORED = '/permissions full-access'

const cleanups: Array<() => Promise<void> | void> = []
afterEach(async () => {
  cleanup()
  for (const fn of cleanups.splice(0).reverse()) await fn()
  ipc.handlers.clear()
})

/** A conversation whose last prompt is `events`' user message, read-only, with the bridge the window really has. */
async function windowWith(events: ThreadEvent[], status: 'idle' | 'failed' = 'failed') {
  const dir = mkdtempSync(join(tmpdir(), 'oxe-typed-'))
  cleanups.push(() => removeTempDir(dir))
  execFileSync('git', ['init', '-q'], { cwd: dir, windowsHide: true, stdio: 'ignore' })
  const db = openInMemoryDatabase()
  cleanups.push(() => db.close())
  const runtime = registerThreadIpc(db, { bridge: join(dir, 'bridge.cjs'), prepare: async () => ({ OXESPACE_EXECUTION_ID: 'e1', OXESPACE_EXECUTION_TOKEN: 't1' }), end: () => {} })
  cleanups.push(() => runtime.stop())
  const manager = await runtime.manager
  const id = manager.create({ workspaceId: 'thread:project', projectId: 'project', rootPath: dir, provider: 'claude', access: 'read-only' }).thread.id
  const snapshot = manager.read(id)
  snapshot.thread.status = status
  snapshot.events = events
  ;(manager as unknown as { save(value: unknown, options: { eventsFrom: number }): void }).save(snapshot, { eventsFrom: 0 })

  const settled: Array<{ channel: string; error?: string }> = []
  const invoke = async (channel: string, ...args: unknown[]): Promise<unknown> => {
    try {
      const value = await ipc.handlers.get(channel)!({ sender: {}, senderFrame: {} }, ...args)
      settled.push({ channel })
      return value
    } catch (error) {
      settled.push({ channel, error: (error as Error).message })
      throw error
    }
  }
  const real = createOxeApi({ invoke, on: () => {}, removeListener: () => {} }).thread as unknown as Record<string, unknown>
  // Only the send and steer functions of the bridge reach main: nothing here may probe an account or a CLI.
  const thread: Record<string, unknown> = {
    commands: async () => ({ commands: [] }), models: async () => ({ defaultModel: 'native-model', models: [] }),
    read: async () => manager.read(id), list: async () => [manager.read(id).thread], onChanged: () => () => {},
    interrupt: async () => {}, approve: async () => {}, pin: async () => {}
  }
  for (const name of ['send', 'steer', 'sendTyped', 'steerTyped']) if (typeof real[name] === 'function') thread[name] = real[name]
  const account = { provider: 'claude', scopeId: 'test', state: 'connected', method: 'subscription', checkedAt: Date.now() }
  Object.defineProperty(window, 'oxe', {
    configurable: true,
    value: { thread, clipboard: { writeText: async () => true }, agentAccount: { read: async () => account, onChanged: () => () => {} } }
  })
  const workspace = { id: 'ws', name: 'Repo', rootPath: dir, panes: [] } as unknown as Workspace
  useAccountStore.setState({ scopes: {}, snapshots: {} })
  useWorkspaceStore.setState({ workspaces: [workspace] })
  const shown = structuredClone(manager.read(id))
  useThreadStore.setState({
    threads: [shown.thread], projects: [{ projectId: 'project', displayName: 'Repo', identityLabel: dir, hidden: false, contexts: [{ rootPath: dir, label: 'Repo' }] }],
    snapshot: shown, selectedId: id, secondaryId: null, drafts: {}, loading: false, listLoaded: true
  } as never)
  return { id, shown, workspace, settled, access: () => manager.read(id).thread.access }
}

const prompt = (): ThreadEvent => ({ type: 'message', id: 'turn-1', role: 'user', text: STORED })

describe('a stored message resent from the window never runs as a command', () => {
  // The header has no status line since #1025: a failed step's Retry is the failure card's, in the timeline.
  it('the failure card\'s Retry', async () => {
    const w = await windowWith([prompt(), { type: 'completed', status: 'failed', error: 'The connection dropped' }])
    const { container } = render(<ThreadView workspace={w.workspace} />)
    const card = await waitFor(() => {
      const found = container.querySelector<HTMLElement>('.thread-failure-card')
      expect(found).not.toBeNull()
      return found!
    })
    fireEvent.click(within(card).getByRole('button', { name: 'Retry turn' }))
    await waitFor(() => expect(w.settled).toHaveLength(1), { timeout: 10_000 })
    expect(w.access()).toBe('read-only')
    expect(w.settled[0].error).toBe('thread.command.windowOnly')
  })

  it('the sign-in strip\'s Retry', async () => {
    const w = await windowWith([prompt(),
      { type: 'message', id: 'bad', role: 'assistant', text: 'Failed to authenticate: OAuth session expired and could not be refreshed' },
      { type: 'completed', status: 'failed' }])
    render(<ThreadView workspace={w.workspace} />)
    await screen.findByText('Sign in to Claude Code')
    const retry = screen.getByRole('button', { name: 'Retry' })
    await waitFor(() => expect(retry).toBeEnabled(), { timeout: 10_000 })
    fireEvent.click(retry)
    await waitFor(() => expect(w.settled).toHaveLength(1), { timeout: 10_000 })
    expect(w.access()).toBe('read-only')
    expect(w.settled[0].error).toBe('thread.command.windowOnly')
  })

  it.each([['unconfirmed', 'Send again'], ['rejected', 'Try again']] as const)('the delivery note (%s)', async (state, label) => {
    const w = await windowWith([prompt()], 'idle')
    const event = w.shown.events[0] as Extract<ThreadEvent, { type: 'message' }>
    render(<ThreadMessageRow event={event} turnEvents={[event]} snapshot={{ ...w.shown, deliveries: { 'turn-1': { state, updatedAt: 1 } } }} running={false} pending={false} copied={false} quickReplies={[]}
      action={async run => { await run().catch(() => undefined) }} onCopy={() => {}} onQuickReply={() => {}} onQuote={() => {}} />)
    fireEvent.click(screen.getByRole('button', { name: label }))
    await waitFor(() => expect(w.settled).toHaveLength(1), { timeout: 10_000 })
    expect(w.access()).toBe('read-only')
    expect(w.settled[0].error).toBe('thread.command.windowOnly')
  })
})

describe('what the person types keeps its authority', () => {
  it('the composer\'s send', async () => {
    const w = await windowWith([], 'idle')
    render(<ThreadView workspace={w.workspace} />)
    const input = screen.getByRole('textbox', { name: 'Message' })
    fireEvent.change(input, { target: { value: '/permissions workspace-write' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    await waitFor(() => expect(w.settled).toHaveLength(1), { timeout: 10_000 })
    expect(w.settled[0].error).toBeUndefined()
    expect(w.access()).toBe('workspace-write')
  })

  it('the command bar\'s /steer says its text was typed', async () => {
    const steer = vi.fn(async () => {}), steerTyped = vi.fn(async () => {})
    Object.defineProperty(window, 'oxe', { configurable: true, value: {
      skill: { list: async () => [], invoke: async () => {} }, thread: { steer, steerTyped, pendingRequestsAll: async () => [], respond: async () => {} }
    } })
    useSkillStore.setState({ skills: [] as never })
    useWorkspaceStore.setState({ workspaces: [] as never })
    render(<CommandBar open onOpenChange={() => {}} onRun={() => {}} context={{ workspaceId: 'A', threadId: 't-A', pane: { id: 'p-A', agent: true }, enabledSkills: [], requests: [] }} />)
    await userEvent.type(await screen.findByRole('combobox'), '/steer also update the README{Enter}')
    await waitFor(() => expect(steerTyped).toHaveBeenCalledWith('t-A', 'also update the README'))
    expect(steer).not.toHaveBeenCalled()
  })
})
