import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { openDatabase, type AppDatabase } from '../../electron/main/db'
import { ThreadHistory } from '../../electron/main/services/conversation/thread-history'
import { settleVolatileThreadSnapshot } from '../../electron/main/services/conversation/thread-recovery.service'
import { INTERRUPTED_TOOL_NOTE, pendingInterruptedTools, runCrashRecoveryCommand } from '../../electron/main/services/conversation/thread-crash-recovery'
import type { ThreadSnapshot } from '../../shared/types/thread'

const dirs: string[] = []
const open: AppDatabase[] = []
afterEach(() => { for (const db of open.splice(0)) try { db.close() } catch { /* already closed */ } for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }) })

function seed(db: AppDatabase): ThreadSnapshot {
  db.prepare("INSERT INTO workspaces (id, name, root_path, layout, default_shell_profile_id) VALUES ('ws', 'Repo', '/repo', '1x1', 'builtin-claude')").run()
  db.prepare("INSERT INTO thread_projects (id, identity, root_path, display_name, created_at, updated_at) VALUES ('project', '/repo', '/repo', 'Repo', 1, 1)").run()
  const snapshot: ThreadSnapshot = {
    thread: { id: 'thread', workspaceId: 'ws', projectId: 'project', rootPath: '/repo', provider: 'claude', nativeSessionId: 'native', title: 'Crash', pinned: false, status: 'running', createdAt: 1, updatedAt: 1 },
    events: [
      { type: 'message', id: 'u1', role: 'user', text: 'Deploy it' },
      { type: 'tool', id: 'done', name: 'Read', state: 'completed', detail: 'a.ts', output: 'ok' },
      { type: 'tool', id: 'rm', name: 'Bash', state: 'running', detail: 'rm -rf build', startedAt: 5 }
    ]
  }
  db.prepare('INSERT INTO conversation_threads (id, workspace_id, thread_project_id, data_json, events_json) VALUES (?, ?, ?, ?, ?)').run('thread', 'ws', 'project', JSON.stringify(snapshot.thread), JSON.stringify(snapshot.events))
  return snapshot
}

describe('crash between a tool start and its finish', () => {
  it('marks the running tool interrupted on the next launch, never completed, and never re-runs it', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'oxe-a8-')); dirs.push(dir)
    const path = join(dir, 'oxespace.db')
    const first = openDatabase(path); open.push(first)
    const snapshot = seed(first)
    const history = new ThreadHistory(first)
    history.read('thread')
    const operation = history.beginOperation({ threadId: 'thread', generation: 1, kind: 'turn', state: 'running' })
    history.write(snapshot, { operationId: operation.id } as never)
    first.close() // the process is killed here: the tool started, nothing finished

    const second = openDatabase(path); open.push(second)
    const reopened = new ThreadHistory(second)
    const loaded = reopened.read('thread')
    expect(loaded.events.find(event => event.type === 'tool' && event.id === 'rm')).toMatchObject({ state: 'running' })
    settleVolatileThreadSnapshot(loaded, 'restart')
    expect(reopened.settleOpenOperations('thread', 'unknown', 'OXESpace restarted before the provider result was confirmed.')).toBe(1)
    reopened.write(loaded)

    const after = new ThreadHistory(second).read('thread')
    const tool = after.events.find(event => event.type === 'tool' && event.id === 'rm')
    expect(tool).toMatchObject({ state: 'unknown', interrupted: true })
    expect(tool && tool.type === 'tool' && tool.output).toContain(INTERRUPTED_TOOL_NOTE)
    expect(after.events.find(event => event.type === 'tool' && event.id === 'done')).toMatchObject({ state: 'completed' })
    expect(reopened.operations('thread')[0].state).toBe('unknown')
    expect(pendingInterruptedTools(after).map(event => event.id)).toEqual(['rm'])

    // Continue sends one explicit note and persists the choice; nothing else is executed.
    const sent: string[] = []
    const host = { read: () => new ThreadHistory(second).read('thread'), save: (value: ThreadSnapshot) => new ThreadHistory(second).write(value), send: async (_id: string, text: string) => { sent.push(text) } }
    await runCrashRecoveryCommand(host, 'thread', '/continue-interrupted rm')
    expect(sent).toHaveLength(1)
    expect(sent[0]).toMatch(/may or may not have taken effect/)
    expect(sent[0]).toMatch(/check the current state/)
    expect(sent[0]).toContain('rm -rf build')
    await runCrashRecoveryCommand(host, 'thread', '/continue-interrupted rm')
    expect(sent).toHaveLength(1)
    expect(new ThreadHistory(second).read('thread').events.find(event => event.type === 'tool' && event.id === 'rm')).toMatchObject({ interruptedHandled: 'continued' })
  })

  it('dismiss keeps the interrupted record without sending anything', async () => {
    const db = openDatabase(join(mkdtempSync(join(tmpdir(), 'oxe-a8-')), 'x.db')); open.push(db)
    const snapshot = seed(db)
    const history = new ThreadHistory(db); history.read('thread')
    settleVolatileThreadSnapshot(snapshot, 'restart'); history.write(snapshot)
    const sent: string[] = []
    const host = { read: () => history.read('thread'), save: (value: ThreadSnapshot) => history.write(value), send: async (_id: string, text: string) => { sent.push(text) } }
    await runCrashRecoveryCommand(host, 'thread', '/dismiss-interrupted')
    expect(sent).toEqual([])
    expect(history.read('thread').events.find(event => event.type === 'tool' && event.id === 'rm')).toMatchObject({ state: 'unknown', interrupted: true, interruptedHandled: 'dismissed' })
  })
})
