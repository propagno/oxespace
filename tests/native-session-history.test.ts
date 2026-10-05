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
  it('opens a large Claude history from its recent public messages without buffering tool output', async () => {
    const root = await mkdtemp(join(tmpdir(), 'oxe-native-history-')); roots.push(root)
    const thread = { provider: 'claude', rootPath: join(root, 'repo') } as ConversationThread
    const folder = join(root, 'claude', 'projects', thread.rootPath.replace(/[^a-zA-Z0-9]/g, '-'))
    await mkdir(folder, { recursive: true })
    const entries = [
      JSON.stringify({ type: 'tool-result', sessionId: id, cwd: thread.rootPath, content: 'x'.repeat(3 * 1024 * 1024) }),
      JSON.stringify({ type: 'tool-result', sessionId: id, cwd: thread.rootPath, content: 'y'.repeat(3 * 1024 * 1024) }),
      ...Array.from({ length: 1200 }, (_, index) => JSON.stringify({ type: 'user', uuid: `message-${index}`, sessionId: id, cwd: thread.rootPath, message: { content: `Question ${index}` } }))
    ]
    await writeFile(join(folder, `${id}.jsonl`), entries.join('\n'))
    const reader = new NativeSessionReader(() => 'unused', { claudeHome: join(root, 'claude') })
    const history = await reader.read(thread, id)
    expect(history.truncated).toBe(true)
    expect(history.events.length).toBe(1000)
    expect(history.events.at(-1)).toMatchObject({ text: 'Question 1199' })
    expect(JSON.stringify(history)).not.toContain('Question 0')
    const earlier = await reader.read(thread, id, history.cursor)
    expect(earlier.events).toHaveLength(200)
    expect(earlier.events[0]).toMatchObject({ text: 'Question 0' })
    expect(earlier.cursor).toBeUndefined()
  })
  it('paginates Claude ancestry across metadata pages, excluding abandoned branches after reopening the reader', async () => {
    const root = await mkdtemp(join(tmpdir(), 'oxe-native-history-')); roots.push(root)
    const thread = { provider: 'claude', rootPath: join(root, 'repo') } as ConversationThread
    const folder = join(root, 'claude', 'projects', thread.rootPath.replace(/[^a-zA-Z0-9]/g, '-'))
    await mkdir(folder, { recursive: true })
    const entry = (uuid: string, parentUuid: string | null, text?: string) => JSON.stringify({ type: text ? 'user' : 'progress', uuid, parentUuid, sessionId: id, cwd: thread.rootPath, ...(text ? { message: { content: text } } : {}) })
    const lines = [entry('root', null, 'Original question'), entry('abandoned', 'root', 'Abandoned answer')]
    for (let index = 0; index < 26000; index++) lines.push(entry(`progress-${index}`, index ? `progress-${index - 1}` : 'root'))
    lines.push(entry('latest', 'progress-25999', 'Current branch'))
    await writeFile(join(folder, `${id}.jsonl`), lines.join('\n'))
    let cursor: import('../electron/main/services/conversation/native-history-page').NativeHistoryCursor | undefined
    let events: import('../shared/types/thread').ThreadEvent[] = [], pages = 0
    do {
      const reader = new NativeSessionReader(() => 'unused', { claudeHome: join(root, 'claude') })
      const page = await reader.read(thread, id, cursor)
      events = [...page.events, ...events]; cursor = page.cursor
      expect(++pages).toBeLessThan(40)
    } while (cursor)
    expect(events).toMatchObject([{ text: 'Original question' }, { text: 'Current branch' }])
    expect(pages).toBeGreaterThan(20)
  })
  it('reads a large Codex rollout locally without sending it through the RPC size limit', async () => {
    const root = await mkdtemp(join(tmpdir(), 'oxe-native-history-')); roots.push(root)
    const thread = { provider: 'codex', rootPath: join(root, 'repo') } as ConversationThread
    const folder = join(root, 'codex', 'sessions', '2026', '09', '24')
    await mkdir(folder, { recursive: true })
    const entries = [
      JSON.stringify({ type: 'session_meta', payload: { id, cwd: process.platform === 'win32' ? '\\\\?\\' + thread.rootPath : thread.rootPath } }),
      JSON.stringify({ type: 'response_item', payload: { type: 'message', role: 'developer', content: [{ type: 'input_text', text: 'private instructions' }] } }),
      JSON.stringify({ type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'Earlier outside the initial window' }] } }),
      JSON.stringify({ type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: '<environment_context><current_date>2026-09-24</current_date><root>private path</root></environment_context>' }] } }),
      JSON.stringify({ type: 'response_item', payload: { type: 'function_call_output', content: 'private tool output'.repeat(700_000) } }),
      ...Array.from({ length: 1200 }, (_, index) => JSON.stringify({ type: 'response_item', payload: { type: 'message', role: index % 2 ? 'assistant' : 'user', id: `msg-${index}`, content: [{ type: index % 2 ? 'output_text' : 'input_text', text: `Public ${index}` }] } }))
    ]
    await writeFile(join(folder, `rollout-2026-09-24T12-00-00-${id}.jsonl`), entries.join('\n'))
    const reader = new NativeSessionReader(() => 'codex', { codexHome: join(root, 'codex'), transport: () => { throw Error('RPC should not start') } })
    const history = await reader.read(thread, id)
    expect(history.truncated).toBe(true)
    expect(history.events).toHaveLength(1000)
    expect(history.events.at(-1)).toMatchObject({ role: 'assistant', text: 'Public 1199' })
    expect(JSON.stringify(history)).not.toContain('private')
    expect(history.title).toBe('Public 200')
    expect(JSON.stringify(history)).not.toContain('Earlier outside the initial window')
    await expect(reader.read({ ...thread, rootPath: join(root, 'other') }, id)).rejects.toThrow('different project')
  })
})
