import { mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { openInMemoryDatabase, type AppDatabase } from '../../electron/main/db'
import { claudeTranscriptPath } from '../../electron/main/services/conversation/claude-transcript-fork'
import { THREAD_READ_ONLY_MCP_TOOLS } from '../../electron/main/services/conversation/thread-mcp'
import type { ThreadManager } from '../../electron/main/services/conversation/thread-manager'
import type { ConversationThread, ThreadSideEvent } from '../../shared/types/thread'

const hooks = vi.hoisted(() => ({
  launches: [] as { command: string; args: string[]; cwd: string; env: Record<string, string>; writes: Record<string, unknown>[]; closed: boolean }[],
  codexFork: (params: Record<string, unknown>): { result?: unknown; error?: string } => ({ result: { thread: { id: 'fork-codex', ephemeral: true }, model: 'gpt', approvalPolicy: params.approvalPolicy } })
}))
vi.mock('electron', () => ({ app: { getPath: () => tmpdir(), getAppPath: () => tmpdir(), getVersion: () => '0.0.0', isPackaged: false }, BrowserWindow: { getAllWindows: () => [] } }))
vi.mock('../../electron/main/services/conversation/process-transport', () => ({
  AgentProcessTransport: class {
    private data: (chunk: Uint8Array) => void = () => {}
    private readonly launch: (typeof hooks.launches)[number]
    constructor(command: string, args: string[], cwd: string, env: Record<string, string>) {
      this.launch = { command, args, cwd, env, writes: [], closed: false }
      hooks.launches.push(this.launch)
    }
    write(line: string): void {
      const message = JSON.parse(line) as Record<string, unknown>
      this.launch.writes.push(message)
      const reply = (value: unknown) => queueMicrotask(() => this.data(Buffer.from(JSON.stringify(value) + '\n')))
      if (message.request_id === 'initialize') reply({ type: 'control_response', response: { request_id: 'initialize', subtype: 'success', response: {} } })
      else if (message.method && message.id !== undefined) {
        const answer = message.method === 'thread/fork' ? hooks.codexFork(message.params as Record<string, unknown>)
          : message.method === 'initialize' ? { result: { userAgent: 'oxespace/0.166.0 (Windows; x86_64)' } }
          : message.method === 'config/read' ? { result: { config: { mcp_servers: { 'oxespace-delegation': { command: 'node' } } } } }
          : message.method === 'mcpServerStatus/list' ? { result: { data: [{ name: 'oxespace-delegation', pluginId: null }], nextCursor: null } }
          : { result: {} }
        reply(answer.error ? { id: message.id, error: { code: -32601, message: answer.error } } : { id: message.id, result: answer.result })
      }
    }
    onData(listener: (chunk: Uint8Array) => void): void { this.data = listener }
    onDiagnostic(): void {}
    onClose(): void {}
    endInput(): void {}
    async close(): Promise<void> { this.launch.closed = true }
  }
}))

const MAIN = '11111111-1111-4111-8111-111111111111'
let db: AppDatabase, root: string, home: string
const previousHome = process.env.CLAUDE_CONFIG_DIR

beforeEach(async () => {
  hooks.launches.length = 0
  hooks.codexFork = params => ({ result: { thread: { id: 'fork-codex', ephemeral: true }, model: 'gpt', approvalPolicy: params.approvalPolicy } })
  db = openInMemoryDatabase()
  db.prepare("INSERT INTO internal_mcp_meta(id, port, token, generated_at) VALUES('singleton', 4555, 'secret-token', 1)").run()
  root = await mkdtemp(join(tmpdir(), 'oxe-side-root-'))
  home = await mkdtemp(join(tmpdir(), 'oxe-side-home-'))
  process.env.CLAUDE_CONFIG_DIR = home
})
afterEach(async () => {
  db.close()
  if (previousHome === undefined) delete process.env.CLAUDE_CONFIG_DIR; else process.env.CLAUDE_CONFIG_DIR = previousHome
  await Promise.all([root, home].map(path => rm(path, { recursive: true, force: true })))
})

function main(provider: 'claude' | 'codex', overrides: Partial<ConversationThread> = {}): ConversationThread {
  return { id: 'thread-A', provider, rootPath: root, workspaceId: 'thread:p', nativeSessionId: provider === 'claude' ? MAIN : 'native-codex', status: 'running', generation: 3, title: 'Main', createdAt: 1, updatedAt: 1, ...overrides } as ConversationThread
}

/** Only these two calls exist on the manager the side chats get; anything else would write to the main conversation. */
function manager(thread: ConversationThread) {
  const touched = new Set<string>()
  const value = { readThread: () => thread, subscribe: () => () => {} }
  const proxy = new Proxy(value, { get: (target, key) => {
    touched.add(String(key))
    if (!(key in target)) throw Error(`side chat touched manager.${String(key)}`)
    return target[key as keyof typeof target]
  } })
  return { manager: proxy as unknown as ThreadManager, touched }
}

const changes = () => (db.prepare('SELECT total_changes() AS n').get() as { n: number }).n

describe('side chat runtime (B1.2)', () => {
  it('launches Claude as a read-only fork with the OXESpace MCP limited to lookups, without writing anything', async () => {
    const { createThreadSideChats } = await import('../../electron/main/services/conversation/thread-side-runtime')
    const thread = main('claude'), host = manager(thread), before = changes(), events: ThreadSideEvent[] = []
    const chats = createThreadSideChats(db, '/bin/oxespace-mcp.cjs', host.manager)
    const opened = await chats.open(thread.id, event => events.push(event))
    if (!opened.ok) throw Error('expected a side chat')
    await chats.send(opened.side.sideId, 'What changed?')
    const { args, env, cwd } = hooks.launches[0]
    const line = args.join(' ')
    expect(cwd).toBe(root)
    expect(line).toContain('--permission-mode plan')
    expect(line).toContain('--disallowedTools Bash Edit Write NotebookEdit')
    expect(line).toMatch(new RegExp(`--resume ${MAIN} --fork-session --session-id [0-9a-f-]{36}`))
    expect(args).toContain('--strict-mcp-config')
    const config = JSON.parse(args[args.indexOf('--mcp-config') + 1]) as { mcpServers: Record<string, { args: string[] }> }
    expect(Object.keys(config.mcpServers)).toEqual(['oxespace-delegation'])
    const bridge = config.mcpServers['oxespace-delegation'].args
    const allowed = JSON.parse(bridge[bridge.indexOf('--allowed-tools') + 1]) as string[]
    expect(allowed.length).toBeGreaterThan(0)
    expect(allowed.every(tool => THREAD_READ_ONLY_MCP_TOOLS.includes(tool))).toBe(true)
    for (const write of ['oxespace_memory_remember', 'oxespace_thread_send', 'oxespace_delegate_task', 'oxespace_db_execute']) expect(allowed).not.toContain(write)
    // No execution lease, memory run or hooks of the main conversation.
    expect(env).toMatchObject({ OXESPACE_MCP_PORT: '4555', OXESPACE_WORKSPACE_ID: 'thread:p' })
    expect(Object.keys(env).filter(key => /EXECUTION|MEMORY/.test(key))).toEqual([])
    expect(changes()).toBe(before)
    expect([...host.touched].every(key => ['readThread', 'subscribe'].includes(key))).toBe(true)
    await chats.stop()
    expect(hooks.launches[0].closed).toBe(true)
  })

  it('on close deletes only the fork session file, with the main one beside it', async () => {
    const { createThreadSideChats } = await import('../../electron/main/services/conversation/thread-side-runtime')
    const thread = main('claude')
    const chats = createThreadSideChats(db, '/bin/oxespace-mcp.cjs', manager(thread).manager)
    const opened = await chats.open(thread.id, () => {})
    if (!opened.ok) throw Error('expected a side chat')
    await chats.send(opened.side.sideId, 'Hi')
    const args = hooks.launches[0].args, forkId = args[args.indexOf('--fork-session') + 2]
    const mainFile = claudeTranscriptPath(root, MAIN), forkFile = claudeTranscriptPath(root, forkId)
    expect(dirname(forkFile)).toBe(dirname(mainFile))
    await mkdir(dirname(mainFile), { recursive: true })
    await writeFile(mainFile, '{"type":"user"}\n'); await writeFile(forkFile, '{"type":"user"}\n')
    await chats.close(opened.side.sideId)
    expect(await readdir(dirname(mainFile))).toEqual([`${MAIN}.jsonl`])
    expect(chats.size).toBe(0)
  })

  it('forks Codex as an ephemeral copy with the read-only lookups and never resumes the main thread', async () => {
    const { createThreadSideChats } = await import('../../electron/main/services/conversation/thread-side-runtime')
    const thread = main('codex'), before = changes()
    hooks.codexFork = params => ({ result: { thread: { id: 'fork-codex', ephemeral: true }, model: 'gpt', approvalPolicy: params.approvalPolicy } })
    // The platform is injected: a Linux host here, Windows in the next test.
    const chats = createThreadSideChats(db, '/bin/oxespace-mcp.cjs', manager(thread).manager, 'linux')
    const opened = await chats.open(thread.id, () => {})
    expect(opened.ok).toBe(true)
    const launch = hooks.launches[0]
    const methods = launch.writes.map(write => write.method)
    expect(methods).toContain('thread/fork')
    expect(methods).not.toContain('thread/resume')
    expect(launch.writes.find(write => write.method === 'thread/fork')?.params).toMatchObject({ threadId: 'native-codex', ephemeral: true, sandbox: 'read-only', approvalPolicy: 'on-request',
      config: { 'mcp_servers.oxespace-delegation.default_tools_approval_mode': 'prompt' } })
    expect((launch.writes.find(write => write.method === 'thread/fork')!.params as { config: Record<string, unknown> }).config).not.toHaveProperty('approval_policy')
    // Only the read-only lookups this conversation has are approved, each by name; the bridge itself still asks.
    const forkConfig = launch.writes.find(write => write.method === 'thread/fork')!.params as { config: Record<string, unknown> }
    const approved = Object.entries(forkConfig.config).filter(([, value]) => value === 'approve').map(([key]) => key.split('.')[3])
    expect(approved).toContain('oxespace_code_search')
    expect(approved.every(tool => THREAD_READ_ONLY_MCP_TOOLS.includes(tool))).toBe(true)
    expect(approved).not.toContain('oxespace_memory_remember')
    const bridgeArg = launch.args.find(arg => arg.startsWith('mcp_servers.oxespace-delegation.args='))!
    const bridge = JSON.parse(bridgeArg.slice(bridgeArg.indexOf('=') + 1)) as string[]
    expect((JSON.parse(bridge[bridge.indexOf('--allowed-tools') + 1]) as string[]).every(tool => THREAD_READ_ONLY_MCP_TOOLS.includes(tool))).toBe(true)
    expect(changes()).toBe(before)
    await chats.stop()
    expect(launch.closed).toBe(true)
  })

  it('on Windows forks Codex with the untrusted policy, and refuses when the app-server does not report it back', async () => {
    const { createThreadSideChats } = await import('../../electron/main/services/conversation/thread-side-runtime')
    const thread = main('codex')
    const chats = createThreadSideChats(db, '/bin/oxespace-mcp.cjs', manager(thread).manager, 'win32')
    expect((await chats.open(thread.id, () => {})).ok).toBe(true)
    const fork = hooks.launches[0].writes.find(write => write.method === 'thread/fork')!.params as { approvalPolicy: string; config: Record<string, unknown> }
    expect(fork.approvalPolicy).toBe('untrusted')
    expect(fork.config.approval_policy).toBe('untrusted')
    await chats.stop()
    // A version that answers with another policy cannot be made to ask before every command: unavailable, and the copy is closed.
    hooks.codexFork = () => ({ result: { thread: { id: 'fork-codex', ephemeral: true }, model: 'gpt', approvalPolicy: 'on-request' } })
    const strict = createThreadSideChats(db, '/bin/oxespace-mcp.cjs', manager(thread).manager, 'win32')
    expect(await strict.open(thread.id, () => {})).toEqual({ ok: false, message: { code: 'thread.side.unavailable', params: {} } })
    expect(hooks.launches[1].closed).toBe(true)
  })

  it('answers unavailable when the installed Codex cannot fork, and noSession before the first message', async () => {
    const { createThreadSideChats } = await import('../../electron/main/services/conversation/thread-side-runtime')
    hooks.codexFork = () => ({ error: 'Method not found' })
    const chats = createThreadSideChats(db, '/bin/oxespace-mcp.cjs', manager(main('codex')).manager, 'linux')
    expect(await chats.open('thread-A', () => {})).toEqual({ ok: false, message: { code: 'thread.side.unavailable', params: {} } })
    expect(hooks.launches[0].closed).toBe(true)
    const fresh = createThreadSideChats(db, '/bin/oxespace-mcp.cjs', manager(main('codex', { nativeSessionId: null })).manager)
    expect(await fresh.open('thread-A', () => {})).toEqual({ ok: false, message: { code: 'thread.side.noSession', params: {} } })
    expect(hooks.launches).toHaveLength(1)
  })
})
