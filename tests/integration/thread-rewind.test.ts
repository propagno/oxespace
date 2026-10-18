import { afterEach, describe, expect, it, vi } from 'vitest'
import { openInMemoryDatabase, type AppDatabase } from '../../electron/main/db'
import { ThreadManager } from '../../electron/main/services/conversation/thread-manager'
import { ThreadHistory } from '../../electron/main/services/conversation/thread-history'
import { ThreadRewindError } from '../../electron/main/services/conversation/thread-rewind'
import type { AgentConversationAdapter, ThreadEvent } from '../../shared/types/thread'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { claudeTranscriptPath } from '../../electron/main/services/conversation/claude-transcript-fork'

const databases: AppDatabase[] = []
afterEach(() => { for (const db of databases.splice(0)) db.close() })

function fixture(rewind: AgentConversationAdapter['rewind'], provider: 'codex' | 'claude' = 'codex') {
  const db = openInMemoryDatabase(); databases.push(db)
  db.prepare("INSERT INTO workspaces (id, name, root_path, layout, default_shell_profile_id) VALUES ('A', 'A', '/project-A', '1x1', 'builtin-claude')").run()
  const callbacks: ((event: ThreadEvent) => void)[] = []
  const factory = vi.fn(async () => {
    const adapter: AgentConversationAdapter = { capabilities: { resume: true, approvals: true, attachments: false, modelSelection: false, rewind: true }, evidence: { transport: 'fixture', verified: 'fixture' },
      start: vi.fn(async (_context, emit) => { callbacks.push(emit) }),
      send: vi.fn(async () => {}), interrupt: vi.fn(async () => {}), approve: vi.fn(async () => {}), dispose: vi.fn(async () => {}), rewind }
    return adapter
  })
  const models = { list: vi.fn(async () => ({ defaultModel: 'm', models: [{ id: 'm', label: 'M', description: '', efforts: ['low'], defaultEffort: 'low' }] })), stop: vi.fn(async () => {}) }
  const manager = new ThreadManager(db, factory, vi.fn(), undefined, undefined, undefined, models)
  const id = manager.create({ workspaceId: 'A', projectId: 'project-A', rootPath: '/project-A', provider }).thread.id
  const turn = async (text: string, native: string) => {
    await manager.send(id, text)
    callbacks[0]({ type: 'turn-accepted', nativeTurnId: native, at: Date.now() })
    callbacks[0]({ type: 'completed', status: 'completed' })
    await new Promise(resolve => setTimeout(resolve, 15))
  }
  return { db, manager, id, turn, callbacks }
}

describe('verified conversation rewind', () => {
  it('rewinds the provider first, then truncates local history and cancels nothing that completed', async () => {
    const rewind = vi.fn(async () => {})
    const f = fixture(rewind)
    await f.turn('One', 'n1'); await f.turn('Two', 'n2'); await f.turn('Three', 'n3')
    const second = f.manager.read(f.id).turns![1]
    const operation = second.operationId!
    const result = await f.manager.rewind(f.id, second.id)
    expect(rewind).toHaveBeenCalledWith('n2')
    expect(result.removedTurns).toBe(2)
    const after = f.manager.read(f.id)
    expect(after.turns!.map(turn => turn.nativeId)).toEqual(['n1'])
    expect(after.events.filter(event => event.type === 'message' && event.role === 'user').map(event => event.type === 'message' && event.text)).toEqual(['One'])
    expect(new ThreadHistory(f.db).operations(f.id).find(value => value.id === operation)?.state).toBe('completed')
    await f.manager.stop()
  })

  it('leaves local history untouched when the provider refuses or cannot prove it', async () => {
    const f = fixture(vi.fn(async () => { throw new ThreadRewindError('proof-mismatch', 'history differs') }))
    await f.turn('One', 'n1'); await f.turn('Two', 'n2')
    const before = JSON.stringify(f.manager.read(f.id).events)
    const second = f.manager.read(f.id).turns![1]
    await expect(f.manager.rewind(f.id, second.id)).rejects.toMatchObject({ code: 'proof-mismatch' })
    expect(JSON.stringify(f.manager.read(f.id).events)).toBe(before)
    expect(f.manager.read(f.id).turns).toHaveLength(2)
    await f.manager.stop()
  })

  it('refuses a turn without provider identity and a busy conversation', async () => {
    const rewind = vi.fn(async () => {})
    const f = fixture(rewind)
    await f.manager.send(f.id, 'Unconfirmed')
    const only = f.manager.read(f.id).turns![0]
    await expect(f.manager.rewind(f.id, only.id)).rejects.toMatchObject({ code: 'unavailable' })
    expect(rewind).not.toHaveBeenCalled()
    await f.manager.stop()
  })

  it('rewinds Claude by resuming a fork and keeps the original transcript', async () => {
    const home = mkdtempSync(join(tmpdir(), 'oxe-rewind-')), previous = process.env.CLAUDE_CONFIG_DIR
    process.env.CLAUDE_CONFIG_DIR = home
    try {
      const f = fixture(undefined, 'claude')
      const session = '33333333-3333-4333-8333-333333333333'
      await f.turn('One', 'unused')
      f.callbacks[0]({ type: 'session', nativeSessionId: session })
      await f.turn('Two', 'unused')
      const path = claudeTranscriptPath('/project-A', session)
      mkdirSync(join(path, '..'), { recursive: true })
      const user = (text: string) => JSON.stringify({ type: 'user', uuid: text, message: { role: 'user', content: text } })
      const transcript = [user('One'), JSON.stringify({ type: 'assistant', uuid: 'a1', message: { role: 'assistant', content: [{ type: 'text', text: 'ok' }] } }), user('Two')].join('\n') + '\n'
      writeFileSync(path, transcript)
      const second = f.manager.read(f.id).turns![1]
      const result = await f.manager.rewind(f.id, second.id)
      const after = f.manager.read(f.id)
      expect(result.removedTurns).toBe(1)
      expect(after.thread.nativeSessionId).not.toBe(session)
      expect(readFileSync(path, 'utf8')).toBe(transcript)
      expect(readFileSync(claudeTranscriptPath('/project-A', after.thread.nativeSessionId!), 'utf8')).toBe(transcript.split('\n').slice(0, 2).join('\n') + '\n')
      expect(after.turns).toHaveLength(1)
      await f.manager.stop()
    } finally {
      if (previous === undefined) delete process.env.CLAUDE_CONFIG_DIR; else process.env.CLAUDE_CONFIG_DIR = previous
      rmSync(home, { recursive: true, force: true })
    }
  })
})
