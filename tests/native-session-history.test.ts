import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { NativeSessionReader } from '../electron/main/services/conversation/native-session-history'
import type { ConversationThread } from '../shared/types/thread'
import type { ConversationTransport } from '../electron/main/services/conversation/codex-conversation'

const id = '11111111-1111-4111-8111-111111111111', roots: string[] = []
afterEach(async () => { for (const root of roots.splice(0)) {
  const target = resolve(root)
  if (dirname(target) !== resolve(tmpdir()) || !basename(target).startsWith('oxe-native-history-')) throw Error('Invalid cleanup target')
  await rm(target, { recursive: true, force: true })
} })

describe('native session history import', () => {
  it('imports public Claude text and names, excludes thinking, tools, meta instructions and subagents, and validates project identity', async () => {
    const root = await mkdtemp(join(tmpdir(), 'oxe-native-history-')); roots.push(root)
    const thread = { provider: 'claude', rootPath: join(root, 'repo') } as ConversationThread
    const folder = join(root, 'claude', 'projects', thread.rootPath.replace(/[^a-zA-Z0-9]/g, '-'))
    await mkdir(folder, { recursive: true })
    const path = join(folder, `${id}.jsonl`)
    const entry = (type: string, uuid: string, content: unknown, extra = {}) => ({ type, uuid, sessionId: id, cwd: thread.rootPath, message: { content }, ...extra })
    const values = [entry('user', 'question', 'Implement it'), entry('assistant', 'answer', [
      { type: 'thinking', thinking: 'private reasoning' }, { type: 'tool_use', input: { token: 'private tool data' } }, { type: 'text', text: 'Implemented the change.' }
    ]), entry('user', 'hidden', 'private internal instructions', { isMeta: true }), entry('assistant', 'child', 'private child answer', { isSidechain: true }),
      { type: 'custom-title', customTitle: 'Native session title' }]
    await writeFile(path, values.map(value => JSON.stringify(value)).join('\n'))
    const reader = new NativeSessionReader(() => 'unused', { claudeHome: join(root, 'claude') })
    const history = await reader.read(thread, id)
    expect(history).toEqual({ title: 'Native session title', events: [
      { type: 'message', id: 'native:question', role: 'user', text: 'Implement it' },
      { type: 'message', id: 'native:answer', role: 'assistant', text: 'Implemented the change.' }
    ] })
    expect(JSON.stringify(history)).not.toContain('private')
    await writeFile(path, [entry('user', 'question', 'Original', { parentUuid: null }), entry('assistant', 'obsolete', 'Rewound answer', { parentUuid: 'question' }),
      entry('user', 'new-question', 'New direction', { parentUuid: 'question' }), entry('assistant', 'new-answer', 'Current answer', { parentUuid: 'new-question' })].map(value => JSON.stringify(value)).join('\n'))
    const rewound = await reader.read(thread, id)
    expect(JSON.stringify(rewound)).not.toContain('Rewound answer')
    expect(rewound.events.filter(event => event.type === 'message').map(event => 'text' in event ? event.text : '')).toEqual(['Original', 'New direction', 'Current answer'])
    await writeFile(path, JSON.stringify(entry('user', 'question', 'Wrong root', { cwd: '/another/project' })))
    await expect(reader.read(thread, id)).rejects.toThrow('different project')
    await expect(reader.read(thread, '../credentials')).rejects.toThrow('identifier')
  })
  it('uses Codex thread/read without thread creation or model execution and rejects a session in a different worktree', async () => {
    const requests: string[] = []
    let cwd = process.cwd(), receive: (chunk: Uint8Array) => void = () => {}
    const transport: ConversationTransport = { onData: listener => { receive = listener }, onClose: () => {}, close: vi.fn(async () => {}), write: line => {
      const request = JSON.parse(line); requests.push(request.method)
      if (request.id === undefined) return
      const result = request.method === 'thread/read' ? { thread: { id, cwd, name: 'Codex title', turns: [{ status: 'completed', items: [
        { id: 'u', type: 'userMessage', content: [{ type: 'text', text: 'Review this' }] },
        { id: 'r', type: 'reasoning', text: 'private reasoning' }, { id: 'a', type: 'agentMessage', text: 'Public answer' },
        { id: 't', type: 'commandExecution', command: 'private command' }
      ] }] } } : {}
      queueMicrotask(() => receive(Buffer.from(JSON.stringify({ id: request.id, result }) + '\n')))
    } }
    const reader = new NativeSessionReader(() => 'codex', { transport: () => transport })
    const thread = { provider: 'codex', rootPath: process.cwd() } as ConversationThread
    const history = await reader.read(thread, id)
    expect(history.events).toHaveLength(3)
    expect(history.title).toBe('Codex title')
    expect(JSON.stringify(history)).not.toContain('private')
    expect(requests).toEqual(['initialize', 'initialized', 'thread/read'])
    cwd = '/another/worktree'
    await expect(reader.read(thread, id)).rejects.toThrow('different project')
    expect(transport.close).toHaveBeenCalledTimes(2)
  })
})
