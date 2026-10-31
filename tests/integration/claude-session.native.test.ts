import { randomUUID } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { expect, it } from 'vitest'
import { ClaudeConversationAdapter } from '../../electron/main/services/conversation/claude-conversation'
import { AgentProcessTransport } from '../../electron/main/services/conversation/process-transport'
import type { ThreadEvent } from '../../shared/types/thread'

// Explicit opt-in: two real model turns, using the installed account. Only a
// synthetic native transcript is persisted; no account configuration is changed.
it.skipIf(process.env.OXESPACE_CLAUDE_SESSION_SMOKE !== '1')('Claude resumes a synthetic conversation through the production adapter', async () => {
  const rootPath = await mkdtemp(path.join(tmpdir(), 'oxespace-claude-session-'))
  const resolved = path.resolve(rootPath)
  if (path.dirname(resolved) !== path.resolve(tmpdir()) || !path.basename(resolved).startsWith('oxespace-claude-session-')) throw Error('Unexpected fixture cleanup path')
  const marker = `OXE-${randomUUID()}`
  const launches: string[][] = []
  const adapters: ClaudeConversationAdapter[] = []
  async function turn(nativeSessionId: string | null, prompt: string) {
    const events: ThreadEvent[] = []
    const adapter = new ClaudeConversationAdapter((args, cwd) => {
      launches.push(args)
      return new AgentProcessTransport('claude', args, cwd)
    })
    adapters.push(adapter)
    let finish!: () => void
    const completion = new Promise<void>(resolve => { finish = resolve })
    const timer = setTimeout(finish, 60_000)
    try {
      await adapter.start({ rootPath, nativeSessionId, access: 'read-only' }, event => {
        events.push(event)
        if (event.type === 'completed') finish()
      })
      await adapter.send(prompt)
      await completion
      expect(events.find(event => event.type === 'completed')).toMatchObject({ status: 'completed' })
      expect(events.filter(event => event.type === 'message' && event.role === 'assistant')
        .map(event => event.type === 'message' ? event.text : '').join('\n')).toContain(marker)
      return events.find(event => event.type === 'session')
    } finally {
      clearTimeout(timer)
      await adapter.dispose()
    }
  }
  try {
    const first = await turn(null, `This is a synthetic continuity test. Remember this marker for the next turn: ${marker}. Reply with only the marker. Do not use tools.`)
    expect(first?.type).toBe('session')
    if (first?.type !== 'session') throw Error('Native session identity missing')
    await turn(first.nativeSessionId, 'Repeat only the marker from my preceding message. Do not use tools.')
    expect(launches).toHaveLength(2)
    expect(launches[0]).toContain('--session-id')
    expect(launches[1]).toEqual(expect.arrayContaining(['--resume', first.nativeSessionId]))
  } finally {
    await Promise.all(adapters.map(adapter => adapter.dispose()))
    await rm(resolved, { recursive: true, force: true })
  }
}, 140_000)
