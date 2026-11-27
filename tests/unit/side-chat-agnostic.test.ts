import { mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { openInMemoryDatabase, type AppDatabase } from '../../electron/main/db'
import { AgentStateService } from '../../electron/main/services/agent-state/agent-state.service'
import { AntigravityConversationAdapter } from '../../electron/main/services/conversation/antigravity-conversation'
import { claudeTranscriptPath } from '../../electron/main/services/conversation/claude-transcript-fork'
import type { ConversationTransport } from '../../electron/main/services/conversation/codex-conversation'
import {
  buildSideChatContextBrief,
  buildTerminalSideChatContextBrief,
  readTerminalScreenSnapshot,
  SIDE_CHAT_TERMINAL_BRIEF_MAX_CHARS,
  SIDE_CHAT_THREAD_BRIEF_MAX_CHARS
} from '../../electron/main/services/conversation/side-chat-context'
import { ThreadPermissionStore } from '../../electron/main/services/conversation/thread-permissions'
import { ThreadSideChats, type ThreadSideHost } from '../../electron/main/services/conversation/thread-side-chat'
import type { ThreadManager } from '../../electron/main/services/conversation/thread-manager'
import type { AgentConversationAdapter, ConversationThread, ThreadEvent, ThreadSideEvent } from '../../shared/types/thread'

const hooks = vi.hoisted(() => ({
  launches: [] as {
    command: string
    args: string[]
    cwd: string
    env: Record<string, string>
    writes: Record<string, unknown>[]
    closed: boolean
    emitRaw: (payload: unknown) => void
  }[]
}))

vi.mock('electron', () => ({
  app: { getPath: () => tmpdir(), getAppPath: () => tmpdir(), getVersion: () => '0.0.0', isPackaged: false },
  BrowserWindow: { getAllWindows: () => [] }
}))

vi.mock('../../electron/main/services/conversation/process-transport', () => ({
  AgentProcessTransport: class {
    private data: (chunk: Uint8Array) => void = () => {}
    private readonly launch: (typeof hooks.launches)[number]

    constructor(command: string, args: string[], cwd: string, env: Record<string, string>) {
      this.launch = {
        command,
        args,
        cwd,
        env,
        writes: [],
        closed: false,
        emitRaw: (payload: unknown) => {
          this.data(Buffer.from(JSON.stringify(payload) + '\n'))
        }
      }
      hooks.launches.push(this.launch)
    }

    write(line: string): void {
      const message = JSON.parse(line) as Record<string, unknown>
      this.launch.writes.push(message)
      const reply = (value: unknown) => queueMicrotask(() => this.data(Buffer.from(JSON.stringify(value) + '\n')))
      if (message.request_id === 'initialize') {
        reply({ type: 'control_response', response: { request_id: 'initialize', subtype: 'success', response: {} } })
        return
      }
      if (!message.method || message.id === undefined) return
      const method = String(message.method)
      const params = (message.params ?? {}) as Record<string, unknown>
      const isAcp = this.launch.args[0] === 'acp'
      if (isAcp) {
        if (method === 'initialize') {
          reply({ id: message.id, result: { protocolVersion: 1, agentInfo: { name: 'antigravity', version: '1.5.5' } } })
        } else if (method === 'session/new') {
          reply({ id: message.id, result: { sessionId: 'agy-ephemeral-1', modes: { currentModeId: 'default', availableModes: [{ id: 'default' }, { id: 'auto' }] } } })
        } else if (method === 'session/prompt') {
          reply({
            method: 'session/update',
            params: { sessionId: 'agy-ephemeral-1', update: { sessionUpdate: 'agent_message_chunk', content: { text: 'Antigravity read-only answer.' } } }
          })
          reply({ id: message.id, result: { stopReason: 'end_turn', usage: { inputTokens: 120, outputTokens: 45 } } })
        } else {
          reply({ id: message.id, result: {} })
        }
        return
      }
      // Codex app-server JSON-RPC stand-in
      const answer = method === 'initialize'
        ? { result: { userAgent: 'oxespace/0.166.0 (Linux; x86_64)' } }
        : method === 'config/read'
          ? { result: { config: { mcp_servers: { 'oxespace-delegation': { command: 'node' } } } } }
          : method === 'thread/fork'
            ? { result: { thread: { id: 'codex-fork-1', ephemeral: true }, model: 'o4-mini', approvalPolicy: params.approvalPolicy } }
            : method === 'thread/start'
              ? { result: { thread: { id: 'codex-ephemeral-1', ephemeral: true }, model: 'o4-mini', approvalPolicy: params.approvalPolicy } }
              : method === 'mcpServerStatus/list'
                ? { result: { data: [{ name: 'oxespace-delegation', pluginId: null }], nextCursor: null } }
                : method === 'turn/start'
                  ? { result: { turn: { id: 'codex-turn-1' } } }
                  : { result: {} }
      reply({ id: message.id, result: answer.result })
    }

    onData(listener: (chunk: Uint8Array) => void): void { this.data = listener }
    onDiagnostic(): void {}
    onClose(): void {}
    endInput(): void {}
    async close(): Promise<void> { this.launch.closed = true }
  }
}))

let db: AppDatabase
let root: string
let home: string
const previousHome = process.env.CLAUDE_CONFIG_DIR

beforeEach(async () => {
  hooks.launches.length = 0
  db = openInMemoryDatabase()
  db.prepare("INSERT INTO internal_mcp_meta(id, port, token, generated_at) VALUES('singleton', 4555, 'secret-token', 1)").run()
  root = await mkdtemp(join(tmpdir(), 'oxe-466-root-'))
  home = await mkdtemp(join(tmpdir(), 'oxe-466-home-'))
  process.env.CLAUDE_CONFIG_DIR = home
})

afterEach(async () => {
  db.close()
  if (previousHome === undefined) delete process.env.CLAUDE_CONFIG_DIR
  else process.env.CLAUDE_CONFIG_DIR = previousHome
  await Promise.all([root, home].map(path => rm(path, { recursive: true, force: true })))
})

const dbChanges = (): number => (db.prepare('SELECT total_changes() AS n').get() as { n: number }).n

function seedThread(thread: ConversationThread, events: ThreadEvent[] = []): void {
  db.prepare('INSERT OR IGNORE INTO thread_projects(id, identity, root_path, display_name, created_at, updated_at) VALUES(?, ?, ?, ?, 1, 1)')
    .run(thread.projectId, thread.rootPath, thread.rootPath, 'Project')
  db.prepare('INSERT OR REPLACE INTO conversation_threads(id, workspace_id, thread_project_id, data_json, events_json, history_version) VALUES(?, ?, ?, ?, ?, 1)')
    .run(thread.id, thread.workspaceId, thread.projectId, JSON.stringify(thread), '[]')
  events.forEach((event, index) => {
    db.prepare('INSERT INTO conversation_events(thread_id, seq, rev, data_json) VALUES(?, ?, ?, ?)')
      .run(thread.id, index, index + 1, JSON.stringify(event))
  })
}

function makeThread(overrides: Partial<ConversationThread> = {}): ConversationThread {
  return {
    id: 'thread-agy-1',
    workspaceId: 'thread:proj-1',
    projectId: 'proj-1',
    rootPath: root,
    provider: 'antigravity',
    nativeSessionId: 'agy-main-session',
    title: 'Investigate auth timeout',
    pinned: false,
    status: 'idle',
    generation: 2,
    createdAt: 1,
    updatedAt: 2,
    ...overrides
  }
}

function readonlyManager(thread: ConversationThread) {
  const touched = new Set<string>()
  const value = { readThread: () => thread, subscribe: () => () => {} }
  const proxy = new Proxy(value, {
    get: (target, key) => {
      touched.add(String(key))
      if (!(key in target)) throw Error(`side chat touched manager.${String(key)}`)
      return target[key as keyof typeof target]
    }
  })
  return { manager: proxy as unknown as ThreadManager, touched }
}

describe('OXE-466 · side chat context brief builders', () => {
  it('builds a deterministic, bounded, secret-redacted conversation brief with touched files and errors', () => {
    const events: ThreadEvent[] = [
      { type: 'message', id: 'm1', role: 'user', text: 'Why did login fail? token=ghp_supersecret123456' },
      {
        type: 'tool',
        id: 't1',
        name: 'Edit',
        state: 'failed',
        detail: 'src/auth.ts',
        output: '\x1b[31mError: ECONNREFUSED on /auth\x1b[0m',
        files: [{ path: 'src/auth.ts', kind: 'update', source: 'tool-input', state: 'failed' }]
      },
      { type: 'message', id: 'm2', role: 'assistant', text: 'The auth callback timed out against the staging server.' }
    ]
    const thread = makeThread({ ownedWorktree: { path: root, branch: 'feat/auth-fix', projectRoot: root, baseSha: 'abc', createdAt: 1 } })
    const first = buildSideChatContextBrief({ thread, events })
    const second = buildSideChatContextBrief({ thread, events })

    expect(first).toBe(second)
    expect(first.length).toBeLessThanOrEqual(SIDE_CHAT_THREAD_BRIEF_MAX_CHARS)
    expect(first).toContain('Source provider: Antigravity')
    expect(first).toContain('Active branch: feat/auth-fix')
    expect(first).toContain('Recent touched files: src/auth.ts')
    expect(first).toContain('ECONNREFUSED on /auth')
    expect(first).not.toContain('ghp_supersecret123456')
    expect(first).not.toContain('\x1b[31m')

    // Huge history stays strictly capped within SIDE_CHAT_THREAD_BRIEF_MAX_CHARS.
    const hugeEvents: ThreadEvent[] = Array.from({ length: 40 }, (_, i) => ({
      type: 'message',
      id: `big-${i}`,
      role: i % 2 === 0 ? 'user' : 'assistant',
      text: `Turn ${i}: ${'x'.repeat(2000)}`
    }))
    const bounded = buildSideChatContextBrief({ thread, events: hugeEvents })
    expect(bounded.length).toBeLessThanOrEqual(SIDE_CHAT_THREAD_BRIEF_MAX_CHARS)
    expect(bounded).toContain('Turn 39:')
  })

  it('captures ScreenMirror alt-screen UTF-8 TUI output, masks secrets, and builds a bounded terminal brief', async () => {
    const ansiFrame =
      '\x1b[?1049h' +
      '\x1b[3;1Hpassword=topsecret999' +
      '\x1b[1;1HVitetest Suite' +
      '\x1b[2;1HStatus: FAIL (auth.test.ts)'

    const stateService = new AgentStateService({ manifests: () => new Map(), emit: vi.fn() })
    stateService.start('pane-1', 'ws-1', 80, 24, 'agy')

    const snapshot = await readTerminalScreenSnapshot('pane-1', {
      peek: id => (id === 'pane-1' ? { running: true, altScreen: true, data: ansiFrame } : null),
      readScreen: id => stateService.readScreen(id),
      agentOf: id => stateService.agentOf(id),
      agentState: id => stateService.get(id)
    })

    expect(snapshot).not.toBeNull()
    expect(snapshot!.altScreen).toBe(true)
    expect(snapshot!.screenText).toContain('Vitetest Suite')
    expect(snapshot!.screenText).toContain('Status: FAIL (auth.test.ts)')
    expect(snapshot!.screenText).not.toContain('topsecret999')

    const brief = buildTerminalSideChatContextBrief({
      paneId: 'pane-1',
      workspaceName: 'oxespace',
      paneTitle: 'Runner',
      rootPath: root,
      branch: 'feat/oxe-466',
      agent: 'antigravity',
      agentState: 'working',
      altScreen: snapshot!.altScreen,
      screenText: snapshot!.screenText,
      truncated: snapshot!.truncated
    })
    expect(brief.length).toBeLessThanOrEqual(SIDE_CHAT_TERMINAL_BRIEF_MAX_CHARS)
    expect(brief).toContain('Capture mode: screen (ScreenMirror)')
    expect(brief).toContain('Active branch: feat/oxe-466')
    expect(brief).toContain('Status: FAIL (auth.test.ts)')
    expect(brief).not.toContain('topsecret999')
  })
})

describe('OXE-466 · Antigravity strict read-only side-chat mode', () => {
  it('sets capabilities.permissions=false, opens fresh session/new in sandbox, auto-declines all host requests, and persists zero rules', async () => {
    const sent: Record<string, unknown>[] = []
    let onData: (chunk: Uint8Array) => void = () => {}
    const transport: ConversationTransport = {
      write: line => {
        const msg = JSON.parse(line) as Record<string, unknown>
        sent.push(msg)
        if (!msg.method || msg.id === undefined) return
        const reply = (value: unknown) => queueMicrotask(() => onData(Buffer.from(JSON.stringify(value) + '\n')))
        if (msg.method === 'initialize') reply({ id: msg.id, result: { protocolVersion: 1, agentInfo: { version: '1.5.5' } } })
        else if (msg.method === 'session/new') reply({ id: msg.id, result: { sessionId: 'agy-side-only', modes: { currentModeId: 'default', availableModes: [{ id: 'default' }] } } })
        else if (msg.method === 'session/prompt') reply({ id: msg.id, result: { stopReason: 'end_turn', usage: { inputTokens: 80, outputTokens: 20 } } })
        else reply({ id: msg.id, result: {} })
      },
      onData: cb => { onData = cb },
      onClose: () => {},
      close: vi.fn(async () => {})
    }

    const permissionStore = new ThreadPermissionStore(db)
    const addSpy = vi.spyOn(permissionStore, 'add')
    const launchArgs: string[][] = []
    const adapter = new AntigravityConversationAdapter(args => {
      launchArgs.push(args)
      return transport
    }, { sideChat: true, permissions: permissionStore })

    expect(adapter.capabilities.permissions).toBe(false)
    expect(adapter.capabilities.approvals).toBe(false)

    const events: ThreadEvent[] = []
    await adapter.start({ rootPath: root, nativeSessionId: 'should-never-be-resumed', access: 'full-access', approvalPolicy: 'never' }, event => events.push(event))

    expect(launchArgs[0]).toEqual(['acp', '--sandbox'])
    expect(sent.map(m => m.method)).toContain('session/new')
    expect(sent.map(m => m.method)).not.toContain('session/resume')
    expect(sent.map(m => m.method)).not.toContain('session/load')

    // Host sends a write permission request and a question request — BOTH must be auto-declined/cancelled and never emitted.
    onData(Buffer.from(JSON.stringify({
      id: 701,
      method: 'session/request_permission',
      params: {
        sessionId: 'agy-side-only',
        toolCall: { toolCallId: 'tc-1', kind: 'edit', title: 'Edit README.md', rawInput: { path: 'README.md' } },
        options: [{ optionId: 'allow-1', kind: 'allow_once' }, { optionId: 'reject-1', kind: 'reject_once' }]
      }
    }) + '\n'))
    onData(Buffer.from(JSON.stringify({
      id: 702,
      method: 'session/ask_question',
      params: { sessionId: 'agy-side-only', questions: [{ id: 'q1', question: 'Proceed?' }] }
    }) + '\n'))

    await vi.waitFor(() => {
      expect(sent.some(m => m.id === 701)).toBe(true)
      expect(sent.some(m => m.id === 702)).toBe(true)
    })

    expect(sent.find(m => m.id === 701)?.result).toEqual({ outcome: { outcome: 'selected', optionId: 'reject-1' } })
    expect(sent.find(m => m.id === 702)?.result).toEqual({ cancelled: true, answers: {} })
    expect(events.some(e => e.type === 'request' || e.type === 'approval')).toBe(false)
    expect(addSpy).not.toHaveBeenCalled()

    await adapter.dispose()
    expect(transport.close).toHaveBeenCalled()
  })
})

describe('OXE-466 · provider-agnostic, cross-provider & terminal runtime', () => {
  it('opens an Antigravity read-only side chat with context brief, forwards answer + tokens, and mutates zero DB rows', async () => {
    const { createThreadSideChats } = await import('../../electron/main/services/conversation/thread-side-runtime')
    const thread = makeThread({ provider: 'antigravity', nativeSessionId: 'agy-main-1' })
    seedThread(thread, [
      { type: 'message', id: 'u1', role: 'user', text: 'Check the build failure.' },
      { type: 'message', id: 'a1', role: 'assistant', text: 'Found a missing import in src/app.ts.' }
    ])
    const host = readonlyManager(thread)
    const before = dbChanges()
    const events: ThreadSideEvent[] = []
    const chats = createThreadSideChats(db, '/bin/oxespace-mcp.cjs', host.manager, 'linux')

    const opened = await chats.open(thread.id, event => events.push(event))
    expect(opened.ok).toBe(true)
    if (!opened.ok) return
    expect(opened.side).toMatchObject({ threadId: thread.id, provider: 'antigravity', readOnly: true, mode: 'ephemeral-context', source: 'thread', sourceProvider: 'antigravity' })

    await chats.send(opened.side.sideId, 'Which file was missing the import?')
    await vi.waitFor(() => expect(events.some(e => e.event.type === 'completed')).toBe(true))

    const promptReq = hooks.launches[0].writes.find(w => w.method === 'session/prompt')
    const sentText = (((promptReq?.params as { prompt?: { text?: string }[] })?.prompt ?? [])[0]?.text) ?? ''
    expect(sentText).toContain('[OXESpace Read-Only Side Chat Context]')
    expect(sentText).toContain('Found a missing import in src/app.ts.')
    expect(sentText).toContain('Which file was missing the import?')

    // Second turn sends only the follow-up without duplicating the preamble.
    await chats.send(opened.side.sideId, 'Any other files?')
    const prompts = hooks.launches[0].writes.filter(w => w.method === 'session/prompt')
    expect((((prompts[1].params as { prompt?: { text?: string }[] }).prompt ?? [])[0]?.text)).toBe('Any other files?')

    expect(events.some(e => e.event.type === 'turn-cost' && e.event.inputTokens === 120 && e.event.outputTokens === 45)).toBe(true)
    expect(dbChanges()).toBe(before)
    expect([...host.touched].every(key => ['readThread', 'subscribe'].includes(key))).toBe(true)

    await chats.close(opened.side.sideId)
    expect(hooks.launches[0].closed).toBe(true)
    expect(chats.size).toBe(0)
  })

  it('supports cross-provider side chats across Antigravity <-> Claude <-> Codex without leaking provider models or mutating main sessions', async () => {
    const { createThreadSideChats } = await import('../../electron/main/services/conversation/thread-side-runtime')
    const agyThread = makeThread({ id: 'thread-agy', provider: 'antigravity', model: 'gemini-4-carbon', nativeSessionId: 'agy-main' })
    const claudeThread = makeThread({ id: 'thread-claude', provider: 'claude', model: 'claude-sonnet-4-6', nativeSessionId: '11111111-1111-4111-8111-111111111111' })
    const codexThread = makeThread({ id: 'thread-codex', provider: 'codex', model: 'o4-mini', nativeSessionId: 'codex-main' })
    for (const item of [agyThread, claudeThread, codexThread]) {
      seedThread(item, [{ type: 'message', id: `u-${item.id}`, role: 'user', text: `Question on ${item.provider}` }])
    }

    const byId = new Map([agyThread, claudeThread, codexThread].map(item => [item.id, item]))
    const manager = { readThread: (id: string) => byId.get(id)!, subscribe: () => () => {} } as unknown as ThreadManager
    const chats = createThreadSideChats(db, '/bin/oxespace-mcp.cjs', manager, 'linux')
    const before = dbChanges()

    // 1. Antigravity thread -> Claude side chat (cross-provider ephemeral context, cleans up Claude fork file on close)
    const agyToClaude = await chats.open(agyThread.id, () => {}, { provider: 'claude' })
    expect(agyToClaude.ok).toBe(true)
    if (!agyToClaude.ok) return
    expect(agyToClaude.side).toMatchObject({ provider: 'claude', mode: 'ephemeral-context', sourceProvider: 'antigravity' })
    await chats.send(agyToClaude.side.sideId, 'Summarize in one line')
    const claudeLaunch = hooks.launches[0]
    expect(claudeLaunch.args).not.toContain('--resume')
    expect(claudeLaunch.args).not.toContain('--fork-session')
    expect(claudeLaunch.args).not.toContain('gemini-4-carbon')
    expect(claudeLaunch.args.join(' ')).toContain('--disallowedTools Bash Edit Write NotebookEdit')
    const forkId = claudeLaunch.args[claudeLaunch.args.indexOf('--session-id') + 1]
    const forkFile = claudeTranscriptPath(root, forkId)
    await mkdir(dirname(forkFile), { recursive: true })
    await writeFile(forkFile, '{"type":"user"}\n')
    await chats.close(agyToClaude.side.sideId)
    expect(await readdir(dirname(forkFile))).toEqual([])

    // 2. Claude thread -> Antigravity side chat (cross-provider ACP session/new, strips Claude model)
    const claudeToAgy = await chats.open(claudeThread.id, () => {}, { provider: 'antigravity' })
    expect(claudeToAgy.ok).toBe(true)
    if (!claudeToAgy.ok) return
    expect(claudeToAgy.side).toMatchObject({ provider: 'antigravity', mode: 'ephemeral-context', sourceProvider: 'claude' })
    expect(hooks.launches[1].args).toEqual(['acp', '--sandbox'])
    expect(hooks.launches[1].writes.some(w => w.method === 'session/set_config_option')).toBe(false)
    await chats.close(claudeToAgy.side.sideId)

    // 3. Codex thread -> Antigravity side chat
    const codexToAgy = await chats.open(codexThread.id, () => {}, { provider: 'antigravity' })
    expect(codexToAgy.ok).toBe(true)
    if (!codexToAgy.ok) return
    expect(codexToAgy.side).toMatchObject({ provider: 'antigravity', mode: 'ephemeral-context', sourceProvider: 'codex' })
    await chats.close(codexToAgy.side.sideId)

    // 4. Antigravity thread -> Codex side chat (uses ephemeral thread/start, NOT thread/fork)
    const agyToCodex = await chats.open(agyThread.id, () => {}, { provider: 'codex' })
    expect(agyToCodex.ok).toBe(true)
    if (!agyToCodex.ok) return
    expect(agyToCodex.side).toMatchObject({ provider: 'codex', mode: 'ephemeral-context', sourceProvider: 'antigravity' })
    const codexLaunch = hooks.launches[3]
    expect(codexLaunch.writes.some(w => w.method === 'thread/start')).toBe(true)
    expect(codexLaunch.writes.some(w => w.method === 'thread/fork')).toBe(false)
    const startParams = codexLaunch.writes.find(w => w.method === 'thread/start')?.params as Record<string, unknown>
    expect(startParams).toMatchObject({ ephemeral: true, sandbox: 'read-only' })
    expect(startParams).not.toHaveProperty('model')
    await chats.stop()

    expect(dbChanges()).toBe(before)
  })

  it('opens an ephemeral side chat even before nativeSessionId exists when persisted messages are present', async () => {
    const { createThreadSideChats } = await import('../../electron/main/services/conversation/thread-side-runtime')
    const thread = makeThread({ id: 'thread-no-native', provider: 'claude', nativeSessionId: null })
    seedThread(thread, [{ type: 'message', id: 'm1', role: 'user', text: 'Imported history turn' }])
    const chats = createThreadSideChats(db, '/bin/oxespace-mcp.cjs', readonlyManager(thread).manager, 'linux')
    const opened = await chats.open(thread.id, () => {})
    expect(opened.ok).toBe(true)
    if (opened.ok) expect(opened.side.mode).toBe('ephemeral-context')
    await chats.stop()
  })

  it('opens an OxeCode terminal side chat powered by ScreenMirror without writing to PTY or DB', async () => {
    const { createThreadSideChats } = await import('../../electron/main/services/conversation/thread-side-runtime')
    db.prepare("INSERT INTO workspaces(id, name, root_path, layout, default_shell_profile_id) VALUES('ws-code', 'OXESpace', ?, '1x1', 'builtin-claude')").run(root)
    db.prepare("INSERT INTO panes(id, workspace_id, type, row_index, column_index, display_name, agent_name, root_path) VALUES('pane-term-1', 'ws-code', 'terminal', 0, 0, 'Tests', 'antigravity', ?)").run(root)

    const before = dbChanges()
    const chats = createThreadSideChats(
      db,
      '/bin/oxespace-mcp.cjs',
      { readThread: () => { throw Error('should not read thread') }, subscribe: () => () => {} } as unknown as ThreadManager,
      'linux',
      {
        peek: () => ({ running: true, altScreen: true, data: '\x1b[?1049h\x1b[1;1HFAIL tests/auth.test.ts\x1b[2;1Hapi_key=secret_xyz_123' }),
        shellCwd: () => root,
        status: () => ({ launchDirectory: root, branch: 'feat/oxe-466' }),
        readScreen: () => null,
        agentOf: () => 'antigravity',
        agentState: () => ({ agent: 'antigravity', state: 'idle' })
      }
    )

    const opened = await chats.open('terminal:pane-term-1', () => {}, {
      source: 'terminal',
      paneId: 'pane-term-1',
      workspaceId: 'ws-code',
      rootPath: root,
      provider: 'antigravity'
    })
    expect(opened.ok).toBe(true)
    if (!opened.ok) return
    expect(opened.side).toMatchObject({ provider: 'antigravity', readOnly: true, mode: 'terminal-context', source: 'terminal', paneId: 'pane-term-1' })

    await chats.send(opened.side.sideId, 'Why did tests fail?')
    const promptReq = hooks.launches[0].writes.find(w => w.method === 'session/prompt')
    const sentText = (((promptReq?.params as { prompt?: { text?: string }[] })?.prompt ?? [])[0]?.text) ?? ''
    expect(sentText).toContain('[OXESpace Read-Only Terminal Side Chat Context]')
    expect(sentText).toContain('FAIL tests/auth.test.ts')
    expect(sentText).not.toContain('secret_xyz_123')
    expect(sentText).toContain('Why did tests fail?')
    expect(dbChanges()).toBe(before)

    await chats.close(opened.side.sideId)
    expect(hooks.launches[0].closed).toBe(true)
  })

  it('suppresses echoed wrapped context-brief user messages in forward()', async () => {
    let emitFromAdapter: (event: ThreadEvent) => void = () => {}
    const sent: string[] = []
    const adapter = {
      capabilities: {},
      start: vi.fn(async (_ctx: unknown, emit: (event: ThreadEvent) => void) => { emitFromAdapter = emit }),
      send: vi.fn(async (text: string) => {
        sent.push(text)
        emitFromAdapter({ type: 'message', id: 'echo-1', role: 'user', text })
        emitFromAdapter({ type: 'message', id: 'ans-1', role: 'assistant', text: 'Clean answer.' })
      }),
      interrupt: vi.fn(async () => {}),
      approve: vi.fn(async () => {}),
      respondRequest: vi.fn(async () => {}),
      dispose: vi.fn(async () => {})
    } as unknown as AgentConversationAdapter

    const host: ThreadSideHost = {
      readThread: () => makeThread({ provider: 'antigravity' }),
      readThreadContext: () => ({ events: [{ type: 'message', id: 'm1', role: 'user', text: 'Original context' }] }),
      subscribe: () => () => {},
      connect: vi.fn(async () => adapter),
      unavailable: () => false,
      discard: vi.fn(async () => {})
    }
    const events: ThreadSideEvent[] = []
    const chats = new ThreadSideChats(host)
    const opened = await chats.open('thread-agy-1', e => events.push(e))
    expect(opened.ok).toBe(true)
    if (!opened.ok) return
    await chats.send(opened.side.sideId, 'Explain')
    expect(sent[0]).toContain('[OXESpace Read-Only Side Chat Context]')
    expect(events.map(e => e.event)).toEqual([{ type: 'message', id: 'ans-1', role: 'assistant', text: 'Clean answer.' }])
    await chats.stop()
  })
})
