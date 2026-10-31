/**
 * Live validation against the real `claude` and `codex` CLIs and the real
 * account. Skipped unless OXE_LIVE=1, because it spends a few cents of quota.
 *
 *   OXE_LIVE=1 npm run test:electron -- tests/live/thread-live.test.ts
 *
 * Drives the real ThreadManager, the real provider adapters and the real process
 * transport; only the renderer and Electron IPC are absent.
 */
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { openInMemoryDatabase } from '../../electron/main/db'
import { ThreadManager } from '../../electron/main/services/conversation/thread-manager'
import { AgentProcessTransport } from '../../electron/main/services/conversation/process-transport'
import { ClaudeConversationAdapter } from '../../electron/main/services/conversation/claude-conversation'
import { CodexConversationAdapter } from '../../electron/main/services/conversation/codex-conversation'
import type { ThreadProvider } from '../../shared/types/thread'

const live = process.env.OXE_LIVE === '1'
const directories: string[] = []
afterAll(() => { for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true }) })

function harness(provider: ThreadProvider) {
  const root = mkdtempSync(join(tmpdir(), `oxe-live-${provider}-`)); directories.push(root)
  execFileSync('git', ['init', '-q'], { cwd: root })
  writeFileSync(join(root, 'README.md'), '# live fixture\n')
  const db = openInMemoryDatabase()
  db.prepare("INSERT INTO workspaces (id, name, root_path, layout, default_shell_profile_id) VALUES ('W', 'W', ?, '1x1', 'builtin-claude')").run(root)
  const factory = async (thread: { id: string; rootPath: string; generation?: number }) => provider === 'claude'
    ? new ClaudeConversationAdapter((args, cwd) => new AgentProcessTransport('claude', args, cwd, {}, { thread: thread.id }))
    : new CodexConversationAdapter(new AgentProcessTransport('codex', ['app-server', '--listen', 'stdio://'], thread.rootPath, {}, { thread: thread.id }))
  // The account's own default model may not be usable here; pin one the account supports.
  const pinned = provider === 'claude' ? 'haiku' : process.env.OXE_LIVE_CODEX_MODEL ?? 'gpt-5.5'
  const models = { list: async () => ({ models: [{ id: pinned, label: pinned, description: '', efforts: ['low', 'medium'], defaultEffort: 'low' }], defaultModel: pinned, defaultKnown: true }), stop: async () => {} }
  const manager = new ThreadManager(db, factory as never, () => {}, undefined, undefined, undefined, models as never)
  const id = manager.create({ workspaceId: 'W', projectId: 'P', rootPath: root, provider }).thread.id
  const ready = manager.configure(id, { model: pinned }, 0)
  const until = async (label: string, predicate: () => boolean, timeoutMs = 120_000): Promise<void> => {
    const deadline = Date.now() + timeoutMs
    while (Date.now() < deadline) { if (predicate()) return; await new Promise(resolve => setTimeout(resolve, 250)) }
    throw Error(`Timed out waiting for: ${label}. Status=${manager.read(id).thread.status}`)
  }
  const idle = (label: string, minTurns: number) => until(label, () => {
    const snapshot = manager.read(id)
    return snapshot.thread.status !== 'running' && snapshot.thread.status !== 'approval' && (snapshot.turns?.length ?? 0) >= minTurns && snapshot.turns!.at(-1)!.status !== 'running'
  })
  const assistantText = (): string => manager.read(id).events.filter(event => event.type === 'message' && event.role === 'assistant').map(event => event.type === 'message' ? event.text : '').join('\n')
  return { manager, id, until, idle, assistantText, db, ready }
}

async function scenario(provider: ThreadProvider): Promise<void> {
  const h = harness(provider)
  const { manager, id } = h
  try {
    // 1. A first turn is delivered and its native identity is captured.
    await h.ready
    await manager.send(id, 'Remember the code word ALPHA. Reply with only: ok')
    await h.idle('first turn', 1)
    const first = manager.readForRenderer(id)
    if (first.deliveries?.[first.turns![0].id]?.state !== 'delivered') console.error('LIVE-DEBUG', JSON.stringify({ deliveries: first.deliveries, events: first.events.slice(-6), ops: h.db.prepare('SELECT kind,state,error FROM conversation_operations').all() }, null, 1).slice(0, 3000))
    expect(first.deliveries?.[first.turns![0].id]?.state).toBe('delivered')
    expect(first.sync?.epoch).toBeTruthy()
    if (provider === 'codex') expect(first.turns![0].nativeId).toBeTruthy()

    // 2. The context report comes from the provider itself.
    const context = await manager.contextUsage(id)
    expect(context, 'provider context report').not.toBeNull()
    expect(context!.windowTokens).toBeGreaterThan(1000)
    expect(context!.usedTokens).toBeGreaterThan(0)
    expect(context!.percentage).toBeGreaterThanOrEqual(0)
    if (provider === 'claude') expect(context!.categories.length).toBeGreaterThan(0)
    expect(manager.read(id).thread.contextReport?.source).toBe(provider === 'claude' ? 'claude-control' : 'codex-token-usage')

    // 3. A second turn is visible as a delta from the first cursor.
    const cursor = first.sync!
    await manager.send(id, 'Now remember the code word BRAVO. Reply with only: ok')
    await h.idle('second turn', 2)
    const delta = manager.readSinceForRenderer(id, cursor)
    expect(delta.ok).toBe(true)
    if (delta.ok) {
      expect(delta.events.length).toBeGreaterThan(0)
      expect(delta.live).toBe(manager.read(id).events.length)
      expect(delta.turns).toHaveLength(2)
    }

    // 4. Stopping a turn pauses the queue instead of sending the follow-up.
    await manager.send(id, 'Write the integers from 1 to 400, one per line, with no other text.')
    await h.until('third turn running', () => manager.read(id).thread.status === 'running')
    await manager.send(id, 'Reply with only: queued-ran')
    expect(manager.read(id).thread.queue).toHaveLength(1)
    await manager.interrupt(id)
    await h.until('interrupted', () => manager.read(id).thread.status === 'interrupted')
    await new Promise(resolve => setTimeout(resolve, 1500))
    const paused = manager.read(id)
    expect(paused.thread.queuePause?.reason).toBe('interrupted')
    expect(paused.thread.queue).toMatchObject([{ state: 'queued' }])
    expect(paused.turns).toHaveLength(3)
    await manager.resumeQueue(id)
    await h.idle('queued turn after resume', 4)
    expect(manager.read(id).thread.queue ?? []).toHaveLength(0)
    expect(manager.read(id).thread.queuePause).toBeUndefined()

    // 5. Rewind removes BRAVO from the provider's own memory, not just the screen.
    const before = manager.readSinceForRenderer(id, manager.readForRenderer(id).sync!)
    expect(before.ok).toBe(true)
    const staleCursor = manager.readForRenderer(id).sync!
    const second = manager.read(id).turns![1]
    const result = await manager.rewind(id, second.id)
    expect(result.removedTurns).toBe(3)
    const rewound = manager.read(id)
    expect(rewound.turns).toHaveLength(1)
    expect(rewound.events.filter(event => event.type === 'message' && event.role === 'user')).toHaveLength(1)
    expect(manager.readSinceForRenderer(id, staleCursor)).toEqual({ ok: false, reset: 'epoch' })

    const countBefore = h.assistantText().length
    await manager.send(id, 'List every code word I asked you to remember in this conversation, comma separated, nothing else.')
    await h.idle('post-rewind turn', 2)
    const answer = h.assistantText().slice(countBefore).toUpperCase()
    expect(answer).toContain('ALPHA')
    expect(answer).not.toContain('BRAVO')
  } finally {
    await manager.stop()
    h.db.close()
  }
}

describe.skipIf(!live)('live providers', () => {
  it('Claude: delivery, context, delta, queue pause and fork rewind', async () => { await scenario('claude') }, 600_000)
  it('Codex: delivery, context, delta, queue pause and revert rewind', async () => { await scenario('codex') }, 600_000)
})
