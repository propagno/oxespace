// @vitest-environment node
// Frozen acceptance test for 1.5.0 A46, BACKEND's C5 half through the gateway (OXE program, phase F10, task BE-A46-c5):
// RemotePane.conversation on the workspaces topic, the pane.conversation command, the paneConversation topic (a snapshot
// that is the newest page, then { changed: true } events only to its subscribers), and the two error codes. An unknown
// pane and a pane without a session are both no-conversation. Desktop tests 6, 7, 9 and 10 of ccr-phone-pane-conversation.md.
// Written by the planner; the executor must not edit it. Temp dirs only; a real PaneConversations over fixture JSONL.
// Runs under Electron's Node ABI: npm run test:electron -- tests/acceptance/f10/a46-pane-conversation-gateway.native.test.ts
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync, appendFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, test } from 'vitest'
import { PaneAgentSessions } from '../../../electron/main/services/agent-state/pane-sessions'
import { PaneConversations } from '../../../electron/main/services/remote/pane-conversation'
import { REMOTE_COMMANDS, REMOTE_ERROR_CODES, REMOTE_SUBSCRIPTIONS, type RemotePane, type RemotePaneConversationPage } from '../../../shared/remote/protocol'
import type { TestSocket } from '../../helpers/remote-client'
import type { Harness } from '../../helpers/remote-gateway-harness'
import { collect, ended, phoneWithDesktop, quiet, signIn, subscribeOnly, type Frame } from '../../helpers/remote-session'
import { removeTempDir } from '../../helpers/removeTempDir'

const harnesses: Harness[] = []
const temps: string[] = []
afterEach(async () => {
  await Promise.all(harnesses.splice(0).map(value => value.close()))
  for (const dir of temps.splice(0)) { try { removeTempDir(dir) } catch { /* temp */ } }
})

const ID = '11111111-1111-4111-8111-111111111111'
let counter = 0
const run = (socket: TestSocket, command: string, args: unknown): Promise<Frame> => socket.ask({ type: 'command', id: `c${++counter}`, command, args })

/** A phone and a desktop whose pane p1 runs Claude with a 70-message session; p2 is a plain shell. */
async function setup() {
  const root = realpathSync.native(mkdtempSync(join(tmpdir(), 'oxe-f10-gw-')))
  temps.push(root)
  const repo = join(root, 'repo'); mkdirSync(repo)
  const claudeHome = join(root, 'claude')
  const folder = join(claudeHome, 'projects', repo.replace(/[^a-zA-Z0-9]/g, '-')); mkdirSync(folder, { recursive: true })
  const file = join(folder, `${ID}.jsonl`)
  const line = (uuid: string, text: string) => JSON.stringify({ type: 'assistant', uuid, sessionId: ID, cwd: repo, message: { content: text } })
  writeFileSync(file, Array.from({ length: 70 }, (_, index) => line(`m${index}`, `message ${index}`)).join('\n') + '\n')
  const watchers: Array<() => void> = []
  const phone = await phoneWithDesktop(harnesses, (_desk, h) => {
    const sessions = new PaneAgentSessions(h.db)
    sessions.record('p1', 'claude', ID, 'hook')
    const paneConversations = new PaneConversations({
      sessions, paneCwd: paneId => (['p1', 'p2', 'nobody'].includes(paneId) ? repo : null), roots: () => [repo],
      claudeHome, codexHome: join(root, 'codex'),
      watch: (_path, listener) => { watchers.push(listener); return { close: () => undefined } }
    })
    Object.assign(h.overrides, { paneConversations })
  })
  const append = (uuid: string) => { appendFileSync(file, `${line(uuid, uuid)}\n`); for (const listener of watchers) listener() }
  return { phone, append }
}
const panesOf = (frame: Frame) => (frame.data as { workspaces: Array<{ panes: RemotePane[] }> }).workspaces.flatMap(workspace => workspace.panes)

describe('BE-A46 · the C5 contract (test 7)', () => {
  test('BE-A46: the command, the topic and both error codes are literal words; reason gains new-session and rewritten', () => {
    expect(REMOTE_COMMANDS).toContain('pane.conversation')
    expect(REMOTE_SUBSCRIPTIONS).toContain('paneConversation')
    expect(REMOTE_ERROR_CODES).toEqual(expect.arrayContaining(['no-conversation', 'conversation-changed']))
    const pane: RemotePane = { id: 'p1', title: 'Build', kind: 'agent', conversation: true }
    const older: RemotePane = { id: 'p2', title: 'Shell', kind: 'terminal' }
    expect([pane.conversation, older.conversation]).toEqual([true, undefined])
  })
})

describe('BE-A46 · through the gateway', () => {
  test('BE-A46: the workspaces topic marks the pane that has a conversation, and only that one', async () => {
    const { phone } = await setup()
    const socket = await signIn(phone)
    await subscribeOnly(socket, 'workspaces')
    const [snapshot] = await collect(socket, ended)
    const panes = panesOf(snapshot)
    expect(panes.find(pane => pane.id === 'p1')?.conversation).toBe(true)
    expect(panes.find(pane => pane.id === 'p2')?.conversation).not.toBe(true)
  })

  test('BE-A46: pane.conversation gives the newest page, then Load earlier with its cursor; ids never repeat', async () => {
    const { phone } = await setup()
    const socket = await signIn(phone)
    const newest = await run(socket, 'pane.conversation', { paneId: 'p1' })
    expect(newest).toMatchObject({ type: 'ack' })
    const first = newest.result as RemotePaneConversationPage
    expect(first.items).toHaveLength(50)
    expect(first.cursor).toEqual(expect.any(String))
    const earlier = (await run(socket, 'pane.conversation', { paneId: 'p1', cursor: first.cursor })).result as RemotePaneConversationPage
    expect(earlier.items).toHaveLength(20)
    expect(earlier.cursor).toBeNull()
    const ids = [...earlier.items, ...first.items].map(entry => entry.item.id)
    expect(new Set(ids).size).toBe(70)
  })

  test('BE-A46 (test 6): an unknown pane (even one main could read a cwd for) and a pane without a session are no-conversation, never not-found', async () => {
    const { phone } = await setup()
    const socket = await signIn(phone)
    for (const paneId of ['nobody', 'p2']) {
      expect(await run(socket, 'pane.conversation', { paneId }), paneId).toMatchObject({ type: 'error', code: 'no-conversation' })
      expect(await socket.ask({ type: 'subscribe', id: `s-${paneId}`, topic: 'paneConversation', target: paneId }), paneId).toMatchObject({ type: 'error', code: 'no-conversation' })
    }
    // The path is live: the visible pane reads.
    expect(await run(socket, 'pane.conversation', { paneId: 'p1' })).toMatchObject({ type: 'ack' })
  })

  test('BE-A46: a cursor from another device is conversation-changed', async () => {
    const { phone } = await setup()
    const socket = await signIn(phone)
    const first = (await run(socket, 'pane.conversation', { paneId: 'p1' })).result as RemotePaneConversationPage
    const { res } = await phone.h.pair()
    const other = { ...phone, accessToken: (res.body as { accessToken: string }).accessToken }
    const otherSocket = await signIn(other)
    expect(await run(otherSocket, 'pane.conversation', { paneId: 'p1', cursor: first.cursor })).toMatchObject({ type: 'error', code: 'conversation-changed' })
  })

  test('BE-A46 (tests 9, 10): the topic\'s snapshot is the newest page; an append gives one event whose data is exactly { changed: true }, only to its subscribers', async () => {
    const { phone, append } = await setup()
    const subscriber = await signIn(phone)
    const terminalOnly = await signIn(phone)
    const stream = await subscribeOnly(subscriber, 'paneConversation', { target: 'p1' })
    const [snapshot] = await collect(subscriber, ended)
    expect(snapshot).toMatchObject({ type: 'snapshot', subscription: stream })
    expect((snapshot.data as RemotePaneConversationPage).items).toHaveLength(50)
    phone.desk.terminals.start('p1')
    await subscribeOnly(terminalOnly, 'terminal', { target: 'p1' })
    await collect(terminalOnly, ended)
    append('live-1')
    const [event] = await collect(subscriber, frame => frame.type === 'event', 4000)
    expect(event).toMatchObject({ type: 'event', subscription: stream })
    expect(event.data).toEqual({ changed: true })
    expect(JSON.stringify(event)).not.toContain('live-1')
    await quiet(terminalOnly, 2500)
  })

  test('BE-A46: a resubscribe ignores sinceSeq and cursor and gets a fresh snapshot', async () => {
    const { phone } = await setup()
    const socket = await signIn(phone)
    await subscribeOnly(socket, 'paneConversation', { target: 'p1', sinceSeq: 999, cursor: 'stale' })
    const [snapshot] = await collect(socket, ended)
    expect(snapshot.type).toBe('snapshot')
    expect((snapshot.data as RemotePaneConversationPage).items.length).toBeGreaterThan(0)
  })
})
