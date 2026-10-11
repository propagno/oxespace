// @vitest-environment node
import { expect, test, vi } from 'vitest'
import { mkdtemp, mkdir, rm } from 'node:fs/promises'
import { basename, dirname, join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { createServer } from 'node:net'
import { randomUUID } from 'node:crypto'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import Database from 'better-sqlite3'
import { openInMemoryDatabase } from '../../electron/main/db'
import { WorkspaceService } from '../../electron/main/services/workspace.service'
import { ThreadManager } from '../../electron/main/services/conversation/thread-manager'
import { AgentProcessTransport } from '../../electron/main/services/conversation/process-transport'
import { CodexConversationAdapter } from '../../electron/main/services/conversation/codex-conversation'
import { ClaudeConversationAdapter } from '../../electron/main/services/conversation/claude-conversation'
import { MemoryService } from '../../electron/main/services/memory/memory.service'
import { AiMemoryProvider } from '../../electron/main/services/memory/ai-memory.provider'
import type { MemoryOutboxRecord } from '../../electron/main/services/memory/memory-outbox'
import type { AgentConversationAdapter } from '../../shared/types/thread'

vi.mock('electron', () => ({ safeStorage: { isEncryptionAvailable: () => true,
  encryptString: (text: string) => Buffer.from(text), decryptString: (value: Buffer) => value.toString() } }))

// Explicit opt-in: real account inference, real policy checks, real HTTP server
// and outbox. Only OS credential encryption is replaced for the synthetic DB.
const providers = (process.env.OXESPACE_NATIVE_PROVIDERS ?? '').split(',')
const binary = process.env.OXESPACE_AI_MEMORY_V26_TEST_BINARY
for (const provider of ['codex', 'claude'] as const) {
  test.skipIf(!providers.includes(provider))(`${provider}: Thread orchestrator captures native turns and resumes without double persistence`, async () => {
    if (!binary) throw Error('OXESPACE_AI_MEMORY_V26_TEST_BINARY is required for the authenticated memory campaign')
    const directory = await mkdtemp(join(tmpdir(), 'oxe-memory-thread-native-'))
    const target = resolve(directory)
    if (dirname(target) !== resolve(tmpdir()) || !basename(target).startsWith('oxe-memory-thread-native-')) throw Error('Unsafe fixture cleanup')
    const rootPath = join(directory, 'project')
    const db = openInMemoryDatabase()
    let memory = new MemoryService(db, join(directory, 'memory'))
    let manager: ThreadManager | undefined
    let failure: unknown
    let stage = 'setup'
    const adapters: AgentConversationAdapter[] = []
    const records = new Map<string, MemoryOutboxRecord>()
    const deliveries: { stored: number; replayed: number; dropped: number }[] = []
    const observeAdmissions = () => {
      const admit = memory.outbox.admit.bind(memory.outbox)
      vi.spyOn(memory.outbox, 'admit').mockImplementation(async value => {
        const accepted = await admit(value)
        if (accepted) records.set(value.key, value)
        return accepted
      })
    }
    const buildManager = () => new ThreadManager(db, async thread => {
      const env = await memory.prepareLaunch({ paneId: `thread:${thread.id}`, workspaceId: thread.workspaceId!, cwd: rootPath,
        captureOwner: 'external', expectedAgent: provider === 'claude' ? 'claude-code' : 'codex' })
      expect(env.AI_MEMORY_CAPTURE_OWNER).toBe('oxespace.thread')
      expect(env.OXESPACE_MEMORY_RUN).toBeUndefined()
      const adapter = provider === 'codex'
        ? new CodexConversationAdapter(new AgentProcessTransport('codex', ['-c', 'mcp_servers={}', 'app-server', '--listen', 'stdio://'], rootPath, env))
        : new ClaudeConversationAdapter((args, cwd) => new AgentProcessTransport('claude', args, cwd, env))
      adapters.push(adapter)
      return adapter
    }, () => {}, undefined, undefined, undefined, undefined, undefined, undefined,
    (snapshot, event) => memory.observeThread(snapshot, event))
    const eventName = (row: MemoryOutboxRecord) => new URL(row.item.url, 'http://localhost').searchParams.get('event')
    const waitForDelivery = async (stops: number) => {
      await vi.waitFor(async () => {
        expect([...records.values()].filter(row => eventName(row) === 'stop')).toHaveLength(stops)
        expect(await memory.outbox.pending()).toHaveLength(0)
      }, { timeout: 15000, interval: 100 })
    }
    try {
      await mkdir(rootPath)
      await promisify(execFile)('git', ['init', '--quiet', rootPath], { windowsHide: true, timeout: 10000 })
      const workspace = new WorkspaceService(db).create({ rootPath, layout: '1x1', autoStart: false })
      db.prepare('INSERT INTO internal_mcp_meta (id, port, token, generated_at) VALUES (?, ?, ?, ?)').run('singleton', 12345, 'synthetic-only', Date.now())
      const port = await new Promise<number>((resolvePort, reject) => {
        const socket = createServer()
        socket.once('error', reject)
        socket.listen(0, '127.0.0.1', () => { const address = socket.address() as { port: number }; socket.close(() => resolvePort(address.port)) })
      })
      await memory.configure({ workspaceId: workspace.id, runtime: { mode: 'managed', executable: binary!, url: `http://127.0.0.1:${port}` },
        settings: { enabled: true, automaticCapture: true, automaticContext: false } })
      expect(await memory.runtime.version(binary!)).toBe('2.6.2')
      observeAdmissions()
      manager = buildManager()
      const context = await memory.projects.workspace(workspace.id)
      const id = manager.create({ workspaceId: workspace.id, projectId: context.projectId, rootPath, provider }).thread.id
      const marker = `OXE_${randomUUID().replaceAll('-', '')}`
      const turn = async (prompt: string, interrupted = false) => {
        const sequence = (manager!.read(id).turns?.length ?? 0) + 1
        stage = `turn ${sequence}${interrupted ? ' interruption' : ''}`
        console.info(`[memory-native] ${provider}: ${stage}`)
        await manager!.send(id, prompt)
        if (interrupted) {
          // send() may queue behind the previous turn's checkpoint finalizer.
          // Interrupt only the requested native turn, never the preceding one.
          await vi.waitFor(() => {
            const active = manager!.read(id).turns!.at(-1)
            expect(active?.sequence).toBe(sequence)
            expect(active?.status).toBe('running')
            if (provider === 'codex') expect(active?.nativeId).toBeTruthy()
          }, { timeout: 15000, interval: 25 })
          await manager!.interrupt(id)
        }
        await vi.waitFor(() => {
          const snapshot = manager!.read(id)
          const turn = snapshot.turns!.at(-1)
          if (turn?.status === 'failed') throw Error(`Native turn failed: ${snapshot.thread.lastTurnStatus}`)
          expect(turn?.sequence).toBe(sequence)
          expect(turn?.status).toBe(interrupted ? 'interrupted' : 'completed')
          expect(snapshot.thread.status).toBe(interrupted ? 'interrupted' : 'idle')
        }, { timeout: 90000, interval: 100 })
      }
      await turn(`Synthetic continuity test. Remember ${marker} and reply only with that marker. Do not use tools.`)
      await waitForDelivery(1)
      const sessionId = manager.read(id).thread.nativeSessionId
      expect(sessionId).toBeTruthy()
      // Same live transport: Claude need not emit another session-start here.
      await turn('Repeat the preceding marker. Do not use tools.')
      await waitForDelivery(2)
      await turn('Explain all sorting algorithms at great length. Do not use tools.', true)
      stage = 'shutdown and resume'
      await manager.stop()
      await memory.stop()
      deliveries.push(memory.delivery.stats())
      memory = new MemoryService(db, join(directory, 'memory'))
      observeAdmissions()
      await memory.init()
      manager = buildManager()
      await turn('Repeat only the original marker from our first turn. Do not use tools.')
      await waitForDelivery(3)
      expect(manager.read(id).thread.nativeSessionId).toBe(sessionId)
      const captured = [...records.values()]
      expect(new Set(captured.map(row => row.sessionId))).toEqual(new Set([sessionId]))
      expect(captured.filter(row => eventName(row) === 'session-start')).toHaveLength(1)
      expect(captured.some(row => eventName(row) === 'session-end')).toBe(false)
      const stops = captured.filter(row => eventName(row) === 'stop')
      expect(stops).toHaveLength(3)
      for (const row of stops) expect(row.item.body._ai_memory_assistant?.excerpt).toContain(marker)
      expect(captured.filter(row => eventName(row) === 'user-prompt-submit').length).toBeGreaterThanOrEqual(3)
      const sessions = await new AiMemoryProvider(memory.runtime.client()).getRecentSessions(context)
      expect(sessions.filter(session => session.sessionId === sessionId)).toMatchObject([{ ended: false }])
      deliveries.push(memory.delivery.stats())
      expect(deliveries.reduce((sum, stats) => sum + stats.stored, 0)).toBe(records.size)
      expect(deliveries.reduce((sum, stats) => sum + stats.dropped, 0)).toBe(0)
      expect(deliveries.reduce((sum, stats) => sum + stats.replayed, 0)).toBeGreaterThanOrEqual(1)
      const persisted = new Database(join(memory.runtime.dataDir, 'db', 'memory.sqlite'), { readonly: true })
      try {
        const observations = persisted.prepare('SELECT source_event, body FROM observations').all() as { source_event: string; body: string }[]
        expect(observations).toHaveLength(records.size)
        expect(observations.filter(row => row.source_event === 'session-start')).toHaveLength(1)
        const answers = observations.filter(row => row.source_event === 'stop')
        expect(answers).toHaveLength(3)
        for (const answer of answers) expect(answer.body).toContain(marker)
      } finally { persisted.close() }
    } catch (error) { failure = error }
    finally {
      await manager?.stop().catch(error => { failure ??= error })
      await Promise.allSettled(adapters.map(adapter => adapter.dispose()))
      await memory.stop().catch(error => { failure ??= error })
      db.close()
      await rm(target, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }).catch(error => {
        // Preserve a provider/protocol failure instead of replacing it with a
        // secondary Windows handle error. Only this synthetic fixture remains.
        console.warn(`Native memory fixture cleanup: ${(error as NodeJS.ErrnoException).code}; ${target}`)
      })
    }
    if (failure) {
      const detail = (failure as { failure?: { detail?: string } }).failure?.detail
      throw new Error(`${provider} ${stage}: ${detail ?? (failure instanceof Error ? failure.message : 'failed')}`, { cause: failure })
    }
  }, 420000)
}
