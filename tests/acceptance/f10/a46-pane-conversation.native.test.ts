// @vitest-environment node
// Frozen acceptance test for 1.5.0 A46, BACKEND's C5 half (OXE program, phase F10, task BE-A46-c5): a terminal agent's
// own conversation, read for the phone. Which panes have one, newest-first pages of 50 with an opaque per-device handle,
// redaction, the two refusals (no-conversation, conversation-changed with its reason), the epoch, no spawn, and the
// throttled live signal with one watcher per pane. Desktop tests 1–5, 8 and 11 of ccr-phone-pane-conversation.md (#658).
// Written by the planner; the executor must not edit it. Temp dirs only: a fake claudeHome / codexHome with fixture JSONL.
// Runs under Electron's Node ABI: npm run test:electron -- tests/acceptance/f10/a46-pane-conversation.native.test.ts
import { appendFileSync, mkdirSync, mkdtempSync, realpathSync, truncateSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { openInMemoryDatabase, type AppDatabase } from '../../../electron/main/db/index'
import { PaneAgentSessions } from '../../../electron/main/services/agent-state/pane-sessions'
import { PANE_CONVERSATION_LIMITS, PaneConversations } from '../../../electron/main/services/remote/pane-conversation'
import { REMOTE_TEXT_LIMITS, type RemotePaneConversationPage } from '../../../shared/remote/protocol'
import { removeTempDir } from '../../helpers/removeTempDir'

const cleanup: Array<() => void> = []
afterEach(() => { vi.useRealTimers(); for (const step of cleanup.splice(0).reverse()) { try { step() } catch { /* temp */ } } })

const ID_A = '11111111-1111-4111-8111-111111111111'
const ID_B = '22222222-2222-4222-8222-222222222222'
const ID_CODEX = '33333333-3333-4333-8333-333333333333'
const SECRET = `sk-ant-${'k'.repeat(40)}`

interface Fixture {
  root: string; repo: string; claudeHome: string; codexHome: string; db: AppDatabase; sessions: PaneAgentSessions
  conversations: PaneConversations; clock: { now: number }; spawned: string[]
  watchers: Array<{ file: string; listener: () => void; closed: boolean }>
  file(id: string): string
  write(id: string, messages: Array<[string, 'user' | 'assistant', string]>): void
  append(id: string, messages: Array<[string, 'user' | 'assistant', string]>): void
}

function fixture(): Fixture {
  const root = realpathSync.native(mkdtempSync(join(tmpdir(), 'oxe-f10-conv-')))
  cleanup.push(() => removeTempDir(root))
  const repo = join(root, 'repo'); mkdirSync(repo)
  const claudeHome = join(root, 'claude'), codexHome = join(root, 'codex')
  const db = openInMemoryDatabase(); cleanup.push(() => db.close())
  // pane_agent_sessions references panes: the two panes are real rows of one workspace.
  db.prepare("INSERT INTO workspaces (id, name, root_path, layout, default_shell_profile_id) VALUES ('ws1', 'proj', ?, '1x2', 'builtin-claude')").run(repo)
  db.prepare("INSERT INTO panes (id, workspace_id, type, row_index, column_index) VALUES ('p1', 'ws1', 'terminal', 0, 0), ('p2', 'ws1', 'terminal', 0, 1)").run()
  const sessions = new PaneAgentSessions(db)
  const clock = { now: 1_000_000 }
  const spawned: string[] = []
  const watchers: Fixture['watchers'] = []
  const folder = join(claudeHome, 'projects', repo.replace(/[^a-zA-Z0-9]/g, '-'))
  const file = (id: string) => join(folder, `${id}.jsonl`)
  const line = ([uuid, role, text]: [string, 'user' | 'assistant', string]) => JSON.stringify({ type: role, uuid, sessionId: '', cwd: repo, message: { content: text } })
  const conversations = new PaneConversations({
    sessions, paneCwd: paneId => (paneId === 'p1' || paneId === 'p2' ? repo : null), roots: () => [repo],
    claudeHome, codexHome, now: () => clock.now,
    transport: command => { spawned.push(command); throw new Error('a phone read must never start a process') },
    watch: (path, listener) => { const entry = { file: path, listener, closed: false }; watchers.push(entry); return { close: () => { entry.closed = true } } }
  })
  return {
    root, repo, claudeHome, codexHome, db, sessions, conversations, clock, spawned, watchers, file,
    write: (id, messages) => { mkdirSync(folder, { recursive: true }); writeFileSync(file(id), messages.map(line).join('\n') + '\n') },
    append: (id, messages) => appendFileSync(file(id), messages.map(line).join('\n') + '\n')
  }
}
const many = (count: number, prefix = 'm'): Array<[string, 'user' | 'assistant', string]> =>
  Array.from({ length: count }, (_, index) => [`${prefix}${index}`, index % 2 ? 'assistant' : 'user', `message ${prefix}${index}`])
const isPage = (value: unknown): value is RemotePaneConversationPage => !!value && typeof value === 'object' && 'items' in value
async function page(f: Fixture, device: string, input: { paneId: string; cursor?: string }): Promise<RemotePaneConversationPage> {
  const result = await f.conversations.page(device, input)
  if (!isPage(result)) throw new Error(`expected a page, got ${JSON.stringify(result)}`)
  return result
}
const ids = (value: RemotePaneConversationPage) => value.items.map(entry => entry.item.id)

describe('BE-A46 · which panes have a conversation (test 1)', () => {
  test('BE-A46: true only for a recorded Claude or Codex session whose file exists for the pane\'s cwd', async () => {
    const f = fixture()
    expect(await f.conversations.has('p1')).toBe(false) // nothing recorded: a plain shell
    f.sessions.record('p1', 'claude', ID_A, 'hook')
    expect(await f.conversations.has('p1')).toBe(false) // recorded, but no file
    f.write(ID_A, many(2))
    expect(await f.conversations.has('p1')).toBe(true)
    expect(await f.conversations.has('unknown-pane')).toBe(false)
    // Codex: only with its rollout file; never by asking codex itself.
    f.sessions.record('p2', 'codex', ID_CODEX, 'hook')
    expect(await f.conversations.has('p2')).toBe(false)
    const day = join(f.codexHome, 'sessions', '2026', '11', '08'); mkdirSync(day, { recursive: true })
    writeFileSync(join(day, `rollout-2026-11-08T10-00-00-${ID_CODEX}.jsonl`), `${JSON.stringify({ type: 'session_meta', payload: { id: ID_CODEX, cwd: f.repo } })}\n`)
    expect(await f.conversations.has('p2')).toBe(true)
    expect(f.spawned).toEqual([])
  })
})

describe('BE-A46 · pages (tests 2, 3)', () => {
  test('BE-A46: the newest page first, oldest to newest within it, then Load earlier to cursor null: every message once', async () => {
    const f = fixture()
    f.sessions.record('p1', 'claude', ID_A, 'hook'); f.write(ID_A, many(120))
    const first = await page(f, 'dev-1', { paneId: 'p1' })
    expect(first.agent).toBe('claude')
    expect(first.items).toHaveLength(REMOTE_TEXT_LIMITS.threadPage)
    expect(ids(first).at(-1)).toBe('native:m119')
    expect(ids(first)[0]).toBe('native:m70')
    const seen = [...ids(first)]
    let cursor = first.cursor
    for (let guard = 0; cursor && guard < 10; guard++) {
      const earlier = await page(f, 'dev-1', { paneId: 'p1', cursor })
      expect(earlier.items.length).toBeLessThanOrEqual(REMOTE_TEXT_LIMITS.threadPage)
      seen.unshift(...ids(earlier))
      cursor = earlier.cursor
    }
    expect(cursor).toBeNull()
    expect(seen).toEqual(many(120).map(([uuid]) => `native:${uuid}`))
  })

  test('BE-A46: a long message is cut with truncated; a key is redacted and a path outside the roots scrubbed, as threadItems does', async () => {
    const f = fixture()
    const outside = process.platform === 'win32' ? 'C:\\Users\\someone-else\\private\\notes.txt' : '/home/someone-else/private/notes.txt'
    f.sessions.record('p1', 'claude', ID_A, 'hook')
    f.write(ID_A, [['long', 'assistant', 'x'.repeat(REMOTE_TEXT_LIMITS.itemText + 500)], ['key', 'user', `use ${SECRET} please`], ['path', 'assistant', `I read ${outside} and ${join(f.repo, 'a.ts')}`]])
    const result = await page(f, 'dev-1', { paneId: 'p1' })
    const text = JSON.stringify(result)
    const long = result.items.find(entry => entry.item.id === 'native:long')?.item as { text: string; truncated?: boolean }
    expect(long.truncated).toBe(true)
    expect(long.text.length).toBeLessThanOrEqual(REMOTE_TEXT_LIMITS.itemText)
    expect(text).not.toContain(SECRET)
    expect(text).not.toContain('someone-else')
  })
})

describe('BE-A46 · the handle stays on the desktop (test 4)', () => {
  test('BE-A46: the handle is opaque: 32 base64url characters, carrying no path, session id or size', async () => {
    const f = fixture()
    f.sessions.record('p1', 'claude', ID_A, 'hook'); f.write(ID_A, many(80))
    const first = await page(f, 'dev-1', { paneId: 'p1' })
    expect(first.cursor).toMatch(/^[A-Za-z0-9_-]{32}$/)
    expect(JSON.stringify(first)).not.toContain(ID_A)
    expect(JSON.stringify(first)).not.toContain(f.claudeHome)
  })

  test('BE-A46: a handle used by another device or for another pane gives conversation-changed', async () => {
    const f = fixture()
    f.sessions.record('p1', 'claude', ID_A, 'hook'); f.sessions.record('p2', 'claude', ID_A, 'hook'); f.write(ID_A, many(80))
    const first = await page(f, 'dev-1', { paneId: 'p1' })
    expect(await f.conversations.page('dev-2', { paneId: 'p1', cursor: first.cursor! })).toMatchObject({ error: 'conversation-changed' })
    expect(await f.conversations.page('dev-1', { paneId: 'p2', cursor: first.cursor! })).toMatchObject({ error: 'conversation-changed' })
    // The rightful owner still pages on.
    expect(isPage(await f.conversations.page('dev-1', { paneId: 'p1', cursor: first.cursor! }))).toBe(true)
  })

  test('BE-A46 (4b): an append keeps the handle valid: every original message comes back once, with no change', async () => {
    const f = fixture()
    f.sessions.record('p1', 'claude', ID_A, 'hook'); f.write(ID_A, many(120))
    const first = await page(f, 'dev-1', { paneId: 'p1' })
    f.append(ID_A, many(20, 'new'))
    const seen = [...ids(first)]
    let cursor = first.cursor
    while (cursor) {
      const earlier = await page(f, 'dev-1', { paneId: 'p1', cursor })
      seen.unshift(...ids(earlier))
      cursor = earlier.cursor
    }
    expect(seen).toEqual(many(120).map(([uuid]) => `native:${uuid}`))
  })

  test('BE-A46 (4c): a rewrite or a truncate under the handle gives conversation-changed with reason rewritten', async () => {
    const f = fixture()
    f.sessions.record('p1', 'claude', ID_A, 'hook'); f.write(ID_A, many(120))
    const first = await page(f, 'dev-1', { paneId: 'p1' })
    truncateSync(f.file(ID_A), 200)
    expect(await f.conversations.page('dev-1', { paneId: 'p1', cursor: first.cursor! })).toEqual({ error: 'conversation-changed', reason: 'rewritten' })
    f.write(ID_A, many(120, 'other'))
    const second = await page(f, 'dev-1', { paneId: 'p1' })
    f.write(ID_A, many(130, 'third'))
    expect(await f.conversations.page('dev-1', { paneId: 'p1', cursor: second.cursor! })).toEqual({ error: 'conversation-changed', reason: 'rewritten' })
  })

  test('BE-A46 (4d): after the pane\'s session changes, an old handle gives reason new-session, and the newest page has a higher epoch', async () => {
    const f = fixture()
    f.sessions.record('p1', 'claude', ID_A, 'hook'); f.write(ID_A, many(80))
    const first = await page(f, 'dev-1', { paneId: 'p1' })
    f.sessions.record('p1', 'claude', ID_B, 'hook'); f.write(ID_B, many(3, 'fresh'))
    expect(await f.conversations.page('dev-1', { paneId: 'p1', cursor: first.cursor! })).toEqual({ error: 'conversation-changed', reason: 'new-session' })
    const next = await page(f, 'dev-1', { paneId: 'p1' })
    expect(next.epoch).toBeGreaterThan(first.epoch)
    expect(ids(next)).toEqual(['native:fresh0', 'native:fresh1', 'native:fresh2'])
  })

  test('BE-A46: a handle expires after 10 minutes, and a device holds at most 8, the oldest dropped first', async () => {
    const f = fixture()
    f.sessions.record('p1', 'claude', ID_A, 'hook'); f.write(ID_A, many(120))
    expect(PANE_CONVERSATION_LIMITS).toMatchObject({ handlesPerDevice: 8, handleTtlMs: 10 * 60 * 1000 })
    const old = await page(f, 'dev-1', { paneId: 'p1' })
    f.clock.now += 10 * 60 * 1000 + 1
    expect(await f.conversations.page('dev-1', { paneId: 'p1', cursor: old.cursor! })).toMatchObject({ error: 'conversation-changed' })
    const handles: string[] = []
    for (let index = 0; index < 9; index++) handles.push((await page(f, 'dev-1', { paneId: 'p1' })).cursor!)
    expect(await f.conversations.page('dev-1', { paneId: 'p1', cursor: handles[0] })).toMatchObject({ error: 'conversation-changed' })
    expect(isPage(await f.conversations.page('dev-1', { paneId: 'p1', cursor: handles[8] }))).toBe(true)
    // A device that disconnects loses its handles.
    const kept = (await page(f, 'dev-1', { paneId: 'p1' })).cursor!
    f.conversations.forgetDevice('dev-1')
    expect(await f.conversations.page('dev-1', { paneId: 'p1', cursor: kept })).toMatchObject({ error: 'conversation-changed' })
  })
})

describe('BE-A46 · no conversation, and no spawn (test 5)', () => {
  test('BE-A46: Codex without a rollout starts no process and is no-conversation; so are an unknown pane and a missing file', async () => {
    const f = fixture()
    f.sessions.record('p2', 'codex', ID_CODEX, 'hook')
    expect(await f.conversations.page('dev-1', { paneId: 'p2' })).toEqual({ error: 'no-conversation' })
    expect(f.spawned).toEqual([])
    expect(await f.conversations.page('dev-1', { paneId: 'nobody' })).toEqual({ error: 'no-conversation' })
    f.sessions.record('p1', 'claude', ID_A, 'hook')
    expect(await f.conversations.page('dev-1', { paneId: 'p1' })).toEqual({ error: 'no-conversation' })
    // The path is live: with the file, the same pane reads.
    f.write(ID_A, many(1))
    expect(isPage(await f.conversations.page('dev-1', { paneId: 'p1' }))).toBe(true)
  })
})

describe('BE-A46 · the live signal (tests 8, 11)', () => {
  async function live() {
    const f = fixture()
    f.sessions.record('p1', 'claude', ID_A, 'hook'); f.write(ID_A, many(3))
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] })
    const events: unknown[][] = []
    const off = await f.conversations.subscribe('p1', (...args: unknown[]) => { events.push(args) })
    const watcher = f.watchers.at(-1)!
    const grow = (tag: string) => { f.append(ID_A, [[tag, 'assistant', tag]]); watcher.listener() }
    return { f, events, off, watcher, grow }
  }

  test('BE-A46: one append gives exactly one signal within 2 s, with no argument; a burst gives one per window', async () => {
    const { events, grow } = await live()
    expect(PANE_CONVERSATION_LIMITS.eventWindowMs).toBe(2000)
    grow('a1')
    await vi.advanceTimersByTimeAsync(2000)
    expect(events).toEqual([[]])
    for (let index = 0; index < 10; index++) { grow(`b${index}`); await vi.advanceTimersByTimeAsync(40) }
    await vi.advanceTimersByTimeAsync(2000)
    expect(events).toHaveLength(2)
  })

  test('BE-A46: a watcher firing with no change in size or time sends nothing', async () => {
    const { events, watcher } = await live()
    watcher.listener(); watcher.listener()
    await vi.advanceTimersByTimeAsync(5000)
    expect(events).toEqual([])
  })

  test('BE-A46: no starvation: an append every 200 ms for 30 s gives 14 to 16 signals, never 0', async () => {
    const { events, grow } = await live()
    for (let elapsed = 0; elapsed < 30_000; elapsed += 200) { grow(`s${elapsed}`); await vi.advanceTimersByTimeAsync(200) }
    await vi.advanceTimersByTimeAsync(2000)
    expect(events.length).toBeGreaterThanOrEqual(14)
    expect(events.length).toBeLessThanOrEqual(16)
  })

  test('BE-A46: one watcher per pane for two subscribers, closed with the last; a new session gives one signal and a higher epoch', async () => {
    const f = fixture()
    f.sessions.record('p1', 'claude', ID_A, 'hook'); f.write(ID_A, many(3))
    const before = await page(f, 'dev-1', { paneId: 'p1' })
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] })
    const first: unknown[] = [], second: unknown[] = []
    const offFirst = await f.conversations.subscribe('p1', () => { first.push(1) })
    const offSecond = await f.conversations.subscribe('p1', () => { second.push(1) })
    expect(f.watchers.filter(entry => entry.file === f.file(ID_A))).toHaveLength(1)
    // The agent starts a new conversation: main records it and tells the reader.
    f.sessions.record('p1', 'claude', ID_B, 'hook'); f.write(ID_B, many(2, 'new'))
    f.conversations.sessionChanged('p1')
    await vi.advanceTimersByTimeAsync(2000)
    expect([first.length, second.length]).toEqual([1, 1])
    vi.useRealTimers()
    expect((await page(f, 'dev-1', { paneId: 'p1' })).epoch).toBeGreaterThan(before.epoch)
    offFirst()
    expect(f.watchers.filter(entry => !entry.closed)).toHaveLength(1)
    offSecond()
    expect(f.watchers.every(entry => entry.closed)).toBe(true)
  })
})
