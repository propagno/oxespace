import { describe, expect, test, vi } from 'vitest'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createServer } from 'node:net'
import { createServer as createHttpServer } from 'node:http'
import { randomUUID } from 'node:crypto'
import { spawn } from 'node:child_process'
import { openInMemoryDatabase } from '../../electron/main/db'
import { MemoryRuntime } from '../../electron/main/services/memory/memory-runtime'
import { AgentMemoryAdapters } from '../../electron/main/services/memory/agent-memory-adapter'
import { AiMemoryProvider } from '../../electron/main/services/memory/ai-memory.provider'

vi.mock('electron', () => ({ safeStorage: { isEncryptionAvailable: () => true,
  encryptString: (text: string) => Buffer.from(text), decryptString: (value: Buffer) => value.toString() } }))

describe.skipIf(!process.env.OXESPACE_AI_MEMORY_TEST_BINARY)('managed native runtime', () => {
  test('owns only its child, prepares connected hooks credentials, and finalizes exactly one native session', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'oxespace-memory-runtime-test-'))
    const db = openInMemoryDatabase()
    const otherDb = openInMemoryDatabase()
    const runtime = new MemoryRuntime(db, join(directory, 'managed'))
    const connected = new MemoryRuntime(otherDb, join(directory, 'connected'))
    try {
      const port = await new Promise<number>(resolve => {
        const server = createServer()
        server.listen(0, '127.0.0.1', () => { const port = (server.address() as { port: number }).port; server.close(() => resolve(port)) })
      })
      const settings = { mode: 'managed' as const, executable: process.env.OXESPACE_AI_MEMORY_TEST_BINARY!, url: `http://127.0.0.1:${port}` }
      await runtime.configure(settings)
      await Promise.all([runtime.start(), runtime.start()])
      const provider = new AiMemoryProvider(runtime.client())
      expect((await provider.health()).status).toBe('ready')
      const config = await readFile(runtime.configPath, 'utf8')
      expect(config).toContain('embedding_provider = "none"')
      expect(config).not.toContain('openai')
      await connected.configure({ ...settings, mode: 'connected' }, runtime.token())
      await connected.start()
      expect(await readFile(join(connected.dataDir, 'auth-token'), 'utf8')).toBe(runtime.token())
      await connected.stop()
      expect((await provider.health()).status).toBe('ready')

      const cwd = join(directory, 'project')
      await mkdir(cwd)
      const ctx = { projectId: 'finalize', workspace: 'native', project: 'finalize', cwd }
      await writeFile(join(cwd, '.ai-memory.toml'), 'workspace = "native"\nproject = "finalize"\n')
      const a = randomUUID()
      const b = randomUUID()
      for (const id of [a, b]) {
        const response = await fetch(`${settings.url}/hook?event=user-prompt-submit&agent=codex&workspace=native&project=finalize`, {
          method: 'POST', headers: { Authorization: `Bearer ${runtime.token()}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ session_id: id, cwd, prompt: 'Synthetic concurrent task.' })
        })
        expect(response.ok).toBe(true)
      }
      await vi.waitFor(async () => expect(await provider.getRecentSessions(ctx)).toHaveLength(2), { timeout: 3000 })
      await new AgentMemoryAdapters(runtime).finalize(ctx, { sessionId: a, agentId: 'codex', cwd, ended: false })
      await vi.waitFor(async () => expect(await provider.getRecentSessions(ctx)).toEqual(expect.arrayContaining([
        expect.objectContaining({ sessionId: a, ended: true }), expect.objectContaining({ sessionId: b, ended: false })
      ])), { timeout: 3000 })

      // Execute the shipped wrapper, not just the provider, with an explicitly denied gate.
      const wrapper = join(process.cwd(), 'resources', 'memory', 'agent-hook.cjs')
      const output = await new Promise<string>((resolve, reject) => {
        const env = { ...process.env }; delete env.OXESPACE_MEMORY_RUN
        const child = spawn(process.execPath, [wrapper, 'session-start', 'codex'], { env, stdio: 'pipe', windowsHide: true })
        let text = ''
        child.stdout.on('data', chunk => { text += chunk })
        child.on('error', reject)
        child.on('close', () => resolve(text))
        child.stdin.end(JSON.stringify({ session_id: b, cwd }))
      })
      expect(JSON.parse(output)).toEqual({})

      const metadata = createHttpServer((req, res) => {
        req.resume()
        req.on('end', () => {
          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ jsonrpc: '2.0', id: 1, result: { allowed: true, capture: true, context: true, brief: 'Synthetic project context.' } }))
        })
      })
      await new Promise<void>(resolve => metadata.listen(0, '127.0.0.1', resolve))
      try {
        const runFile = join(directory, 'synthetic-run.json')
        await writeFile(runFile, JSON.stringify({ runId: randomUUID(), token: 'synthetic-metadata-token',
          port: (metadata.address() as { port: number }).port, executable: settings.executable, url: settings.url,
          dataDir: runtime.dataDir, configPath: runtime.configPath }))
        const sessionId = randomUUID()
        const invoke = async (event: string, extra = {}) => new Promise<string>((resolve, reject) => {
          const child = spawn(process.execPath, [wrapper, event, 'codex'], { env: { ...process.env, OXESPACE_MEMORY_RUN: runFile }, stdio: 'pipe', windowsHide: true })
          let text = ''
          child.stdout.on('data', chunk => { text += chunk })
          child.on('error', reject)
          child.on('close', () => resolve(text))
          child.stdin.end(JSON.stringify({ sessionId, cwd, ...extra }))
        })
        const startup = JSON.parse(await invoke('session-start'))
        expect(startup.hookSpecificOutput.additionalContext).toContain('Synthetic project context.')
        await invoke('user-prompt-submit', { prompt: 'WrapperCanary: official native capture via OXESpace wrapper.' })
        await invoke('session-end')
        await vi.waitFor(async () => expect(JSON.stringify(await provider.search(ctx, 'WrapperCanary'))).toContain('WrapperCanary'), { timeout: 3000 })
      } finally { await new Promise<void>(resolve => metadata.close(() => resolve())) }
      await runtime.stop()
      expect((await provider.health()).status).toBe('unavailable')
    } finally {
      await connected.stop(); await runtime.stop()
      db.close(); otherDb.close()
      await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
    }
  }, 30000)
})
