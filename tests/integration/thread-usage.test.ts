import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { openInMemoryDatabase, type AppDatabase } from '../../electron/main/db'
import { ThreadUsageLedger } from '../../electron/main/services/conversation/thread-usage'
import { readCodexRequestTokens } from '../../electron/main/services/conversation/thread-cost'
import { ThreadManager } from '../../electron/main/services/conversation/thread-manager'
import type { AgentConversationAdapter, ThreadEvent } from '../../shared/types/thread'
import { removeTempDir } from '../helpers/removeTempDir'

const roots: string[] = []
const databases: AppDatabase[] = []
afterEach(() => {
  for (const db of databases.splice(0)) db.close()
  for (const root of roots.splice(0)) removeTempDir(root)
})
const database = () => { const db = openInMemoryDatabase(); databases.push(db); return db }
const DAY = 24 * 60 * 60 * 1000

describe('ThreadUsageLedger', () => {
  it('sums turns by day, model and conversation, and keeps unpriced turns apart', () => {
    const ledger = new ThreadUsageLedger(database())
    const now = new Date(2026, 9, 13, 12).getTime()
    ledger.record({ threadId: 'a', projectRoot: '/p', provider: 'claude', model: 'opus', at: now, usd: 0.5, inputTokens: 100, outputTokens: 50, cacheReadTokens: 1000 })
    ledger.record({ threadId: 'a', projectRoot: '/p', provider: 'claude', model: 'opus', at: now - DAY, usd: 0.25, inputTokens: 10, outputTokens: 5 })
    ledger.record({ threadId: 'b', projectRoot: '/p', provider: 'codex', model: 'gpt', at: now, inputTokens: 400, outputTokens: 100 })
    ledger.record({ threadId: 'c', projectRoot: '/other', provider: 'claude', at: now, usd: 1 })
    ledger.record({ threadId: 'a', projectRoot: '/p', provider: 'claude', at: now - 40 * DAY, usd: 9 })

    const project = ledger.summary({ scope: 'project', projectRoot: '/p', days: 30, now })
    expect(project.total).toMatchObject({ turns: 3, pricedTurns: 2, usd: 0.75, inputTokens: 510, outputTokens: 155, cacheReadTokens: 1000 })
    expect(project.byDay.map(day => [day.key, day.turns])).toEqual([['2026-10-13', 2], ['2026-10-12', 1]])
    expect(project.byModel.map(model => model.label)).toEqual(['claude · opus', 'codex · gpt'])
    expect(project.byThread.map(thread => [thread.key, thread.label])).toEqual([['a', 'Deleted conversation'], ['b', 'Deleted conversation']])

    expect(ledger.summary({ scope: 'thread', threadId: 'b', days: 30, now }).total).toMatchObject({ turns: 1, pricedTurns: 0, usd: 0 })
    expect(ledger.summary({ scope: 'all', days: 30, now }).total.turns).toBe(4)
    expect(ledger.summary({ scope: 'all', days: 365, now }).total.turns).toBe(5)
  })
})

describe('readCodexRequestTokens', () => {
  it('splits cached input out of the input count', () => {
    expect(readCodexRequestTokens({ inputTokens: 1000, cachedInputTokens: 800, outputTokens: 20 })).toEqual({ inputTokens: 200, outputTokens: 20, cacheReadTokens: 800 })
    expect(readCodexRequestTokens({ totalTokens: 5 })).toBeNull()
  })
})

describe('Thread turns reach the usage ledger', () => {
  it('records each reported turn with the conversation, project and model', { timeout: 30_000 }, async () => {
    const root = mkdtempSync(join(tmpdir(), 'oxe-usage-')); roots.push(root)
    const db = database()
    db.prepare("INSERT INTO workspaces (id, name, root_path, layout, default_shell_profile_id) VALUES ('A', 'A', ?, '1x1', 'builtin-claude')").run(root)
    let emit: (event: ThreadEvent) => void = () => {}
    const factory = vi.fn(async () => ({
      capabilities: { resume: true, approvals: true, attachments: false, modelSelection: false },
      start: vi.fn(async (_context, listener) => { emit = listener; listener({ type: 'session', nativeSessionId: 'n' }) }),
      send: vi.fn(async () => {}), interrupt: vi.fn(async () => {}), approve: vi.fn(async () => {}), dispose: vi.fn(async () => {}), configure: vi.fn(async () => {})
    }) as AgentConversationAdapter)
    const manager = new ThreadManager(db, factory, vi.fn())
    vi.spyOn((manager as unknown as { turns: { workingState: () => Promise<undefined> } }).turns, 'workingState').mockResolvedValue(undefined)
    const id = manager.create({ workspaceId: 'A', projectId: 'p', rootPath: root, provider: 'claude' }).thread.id
    await manager.send(id, 'Go')
    emit({ type: 'turn-cost', usd: 0.12, inputTokens: 30, outputTokens: 7 })
    emit({ type: 'completed', status: 'completed' })
    const summary = manager.usageSummary(id, { scope: 'thread' })
    expect(summary.total).toMatchObject({ turns: 1, pricedTurns: 1, usd: 0.12, inputTokens: 30, outputTokens: 7 })
    expect(summary.byThread[0]).toMatchObject({ key: id })
    expect(summary.byThread[0].label).not.toBe('Deleted conversation')
    expect(manager.read(id).thread.costReport).toMatchObject({ totalUsd: 0.12, source: 'claude-result-step' })
    await manager.stop()
  })
})
