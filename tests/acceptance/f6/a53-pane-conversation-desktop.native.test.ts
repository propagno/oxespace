// Frozen acceptance test for 1.5.0 A53 / N2 (OXE program, phase F6): an OxeCode pane running an agent switches between
// Terminal and Conversation on the desktop, reading the native session with the same reader as the phone (#658, F10's
// PaneConversations), paged, live and read only. This freezes the desktop IPC adapter over that reader.
// Written by the planner; the executor must not edit it. Temp dirs only; fixture JSONL; no live provider.
// CCR: docs/roadmap-1.5/ccr-f6-conversation.md §A53; DESIGN 1.5.0-f6-design.md U6.6. Depends on F10's BE-A46-c5.
// Runs under Electron's Node ABI: npm run test:electron -- tests/acceptance/f6/a53-pane-conversation-desktop.native.test.ts
import { appendFileSync, mkdirSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { openInMemoryDatabase } from '../../../electron/main/db/index'
import { registerPaneConversationIpc } from '../../../electron/main/ipc/pane-conversation.ipc'
import { PaneAgentSessions } from '../../../electron/main/services/agent-state/pane-sessions'
import { PaneConversations } from '../../../electron/main/services/remote/pane-conversation'
import { MCP_COVERAGE } from '../../../shared/mcp-coverage'
import type { RemotePaneConversationPage } from '../../../shared/remote/protocol'
import { IPC_CHANNELS } from '../../../shared/types/ipc'
import { createOxeApi, type PreloadIpc } from '../../../electron/preload/api'
import { createFakeIpcMain } from '../../helpers/fake-ipc-main'
import { removeTempDir } from '../../helpers/removeTempDir'

const cleanup: Array<() => void> = []
afterEach(() => { vi.useRealTimers(); for (const step of cleanup.splice(0).reverse()) { try { step() } catch { /* temp */ } } })
const ID = '11111111-1111-4111-8111-111111111111'

function setup() {
  const root = realpathSync.native(mkdtempSync(join(tmpdir(), 'oxe-f6-n2-')))
  cleanup.push(() => removeTempDir(root))
  const repo = join(root, 'repo'); mkdirSync(repo)
  const db = openInMemoryDatabase(); cleanup.push(() => db.close())
  db.prepare("INSERT INTO workspaces (id, name, root_path, layout, default_shell_profile_id) VALUES ('ws1', 'proj', ?, '1x2', 'builtin-claude')").run(repo)
  db.prepare("INSERT INTO panes (id, workspace_id, type, row_index, column_index) VALUES ('p1', 'ws1', 'terminal', 0, 0), ('p2', 'ws1', 'terminal', 0, 1)").run()
  const sessions = new PaneAgentSessions(db)
  sessions.record('p1', 'claude', ID, 'hook')
  const claudeHome = join(root, 'claude')
  const folder = join(claudeHome, 'projects', repo.replace(/[^a-zA-Z0-9]/g, '-')); mkdirSync(folder, { recursive: true })
  const file = join(folder, `${ID}.jsonl`)
  const line = (uuid: string) => JSON.stringify({ type: 'assistant', uuid, sessionId: ID, cwd: repo, message: { content: `message ${uuid}` } })
  writeFileSync(file, Array.from({ length: 60 }, (_, index) => line(`m${index}`)).join('\n') + '\n')
  const watchers: Array<{ listener: () => void; closed: boolean }> = []
  const conversations = new PaneConversations({
    sessions, paneCwd: paneId => (paneId === 'p1' || paneId === 'p2' ? repo : null), roots: () => [repo], claudeHome, codexHome: join(root, 'codex'),
    watch: (_path, listener) => { const entry = { listener, closed: false }; watchers.push(entry); return { close: () => { entry.closed = true } } }
  })
  const ipc = createFakeIpcMain()
  const pushed: Array<{ senderId: number; payload: unknown }> = []
  const dispose = registerPaneConversationIpc(ipc as never, { conversations, push: (senderId, payload) => { pushed.push({ senderId, payload }) } })
  const append = (uuid: string) => { appendFileSync(file, `${line(uuid)}\n`); for (const watcher of watchers) watcher.listener() }
  return { ipc, pushed, watchers, append, dispose }
}

describe('A53 · a terminal agent\'s conversation on the desktop (N2)', () => {
  test('A53: has says which panes have a conversation, for the pane header\'s switch', async () => {
    const { ipc } = setup()
    expect(await ipc.invoke(IPC_CHANNELS.paneConversation.has, 'p1')).toBe(true)
    expect(await ipc.invoke(IPC_CHANNELS.paneConversation.has, 'p2')).toBe(false)
    expect(await ipc.invoke(IPC_CHANNELS.paneConversation.has, 'unknown')).toBe(false)
  })

  test('A53: page gives the newest page, then Load earlier with its cursor, the same shape as the phone\'s', async () => {
    const { ipc } = setup()
    const first = await ipc.invoke(IPC_CHANNELS.paneConversation.page, { paneId: 'p1' }) as RemotePaneConversationPage
    expect(first.items).toHaveLength(50)
    expect(first.cursor).toEqual(expect.any(String))
    const earlier = await ipc.invoke(IPC_CHANNELS.paneConversation.page, { paneId: 'p1', cursor: first.cursor }) as RemotePaneConversationPage
    expect(earlier.cursor).toBeNull()
    expect(new Set([...earlier.items, ...first.items].map(entry => entry.item.id)).size).toBe(60)
    expect(await ipc.invoke(IPC_CHANNELS.paneConversation.page, { paneId: 'p2' })).toEqual({ error: 'no-conversation' })
  })

  test('A53: watch pushes { paneId } to the window that asked when the session grows; unwatch and disposal close the watcher', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] })
    const { ipc, pushed, watchers, append, dispose } = setup()
    await ipc.invoke(IPC_CHANNELS.paneConversation.watch, 'p1')
    append('live-1')
    await vi.advanceTimersByTimeAsync(2500)
    expect(pushed).toEqual([{ senderId: 1, payload: { paneId: 'p1' } }])
    expect(JSON.stringify(pushed)).not.toContain('live-1')
    await ipc.invoke(IPC_CHANNELS.paneConversation.unwatch, 'p1')
    expect(watchers.every(watcher => watcher.closed)).toBe(true)
    await ipc.invoke(IPC_CHANNELS.paneConversation.watch, 'p1')
    dispose()
    expect(watchers.every(watcher => watcher.closed)).toBe(true)
  })

  test('A53: inputs are checked before the reader is asked', async () => {
    const { ipc } = setup()
    for (const bad of [null, {}, { paneId: '' }, { paneId: 'p1', cursor: 42 }, { paneId: 'x'.repeat(300) }]) await expect(ipc.invoke(IPC_CHANNELS.paneConversation.page, bad)).rejects.toThrow()
    await expect(ipc.invoke(IPC_CHANNELS.paneConversation.watch, 42)).rejects.toThrow()
  })

  test('A53: read-only channels, preloaded, excluded from MCP; there is no write channel', async () => {
    expect(IPC_CHANNELS.paneConversation).toEqual({ has: 'pane-conversation:has', page: 'pane-conversation:page', watch: 'pane-conversation:watch', unwatch: 'pane-conversation:unwatch', changed: 'pane-conversation:changed' })
    const claims = Object.values(MCP_COVERAGE).filter(capability => capability.ipc?.includes('paneConversation.*') || capability.ipc?.includes('paneConversation.page'))
    expect(claims).toHaveLength(1)
    expect(claims[0]).toHaveProperty('excluded')
    const invoke = vi.fn().mockResolvedValue(undefined)
    const on = vi.fn()
    const api = createOxeApi({ invoke, on, removeListener: vi.fn() } as PreloadIpc) as unknown as { paneConversation: Record<string, (...args: unknown[]) => unknown> }
    await api.paneConversation.has('p1')
    await api.paneConversation.page({ paneId: 'p1' })
    await api.paneConversation.watch('p1')
    await api.paneConversation.unwatch('p1')
    api.paneConversation.onChanged(() => undefined)
    expect(invoke.mock.calls).toEqual([[IPC_CHANNELS.paneConversation.has, 'p1'], [IPC_CHANNELS.paneConversation.page, { paneId: 'p1' }], [IPC_CHANNELS.paneConversation.watch, 'p1'], [IPC_CHANNELS.paneConversation.unwatch, 'p1']])
    expect(on).toHaveBeenCalledWith(IPC_CHANNELS.paneConversation.changed, expect.any(Function))
  })
})
