import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { spawn, type ChildProcess } from 'node:child_process'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createServer } from 'node:net'
import { randomUUID } from 'node:crypto'
import { AiMemoryClient } from '../../electron/main/services/memory/ai-memory.client'
import { AiMemoryProvider } from '../../electron/main/services/memory/ai-memory.provider'
import type { MemoryContext } from '../../shared/types/memory'

// Opt-in contract test against the actual, checksum-verified native executable.
// No agent model/API calls, user transcripts, home configuration or cloud models.
const binary = process.env.OXESPACE_AI_MEMORY_TEST_BINARY
describe.skipIf(!binary)('AI Memory native contract', () => {
  let directory: string
  let config: string
  let url: string
  let server: ChildProcess
  let client: AiMemoryClient
  let provider: AiMemoryProvider
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('AI_MEMORY_')))
  const token = randomUUID()
  const context = async (project: string, agentId: string): Promise<MemoryContext> => {
    const cwd = join(directory, `${project}-${agentId}-${randomUUID()}`)
    await mkdir(cwd)
    await writeFile(join(cwd, '.ai-memory.toml'), `workspace = "contract"\nproject = "${project}"\n[briefing]\ninject_on_session_start = true\nmax_chars = 2000\n`)
    return { cwd, workspace: 'contract', project, projectId: project, agentId, sessionId: randomUUID() }
  }
  async function hook(ctx: MemoryContext, event: string, extra = {}) {
    return new Promise<string>((resolve, reject) => {
      const child = spawn(binary!, ['--data-dir', join(directory, 'data'), '--config', config, 'hook', '--agent', ctx.agentId!,
        '--event', event, '--server-url', url, '--capture-mode', 'allowlist'], { env, cwd: ctx.cwd, windowsHide: true, stdio: 'pipe' })
      let output = ''
      let error = ''
      const timer = setTimeout(() => { child.kill(); reject(new Error('Native hook timed out')) }, 10000)
      child.stdout.on('data', chunk => { output += chunk })
      child.stderr.on('data', chunk => { error += chunk })
      child.stdin.on('error', () => {})
      child.on('error', reject)
      child.on('close', code => {
        clearTimeout(timer)
        if (code === 0) resolve(output)
        else reject(new Error(`Native hook ${event}: ${error.slice(0, 1000)}`))
      })
      child.stdin.end(JSON.stringify({ session_id: ctx.sessionId, cwd: ctx.cwd, ...extra }))
    })
  }
  async function eventually(check: () => Promise<boolean>) {
    for (let attempt = 0; attempt < 40; attempt++) {
      try { if (await check()) return } catch { /* Server/session may be admitting a queued hook. */ }
      await new Promise(resolve => setTimeout(resolve, 100))
    }
    throw new Error('Native contract condition did not converge')
  }
  beforeAll(async () => {
    directory = await mkdtemp(join(tmpdir(), 'oxespace-memory-native-test-'))
    await mkdir(join(directory, 'data'))
    const port = await new Promise<number>(resolve => {
      const socket = createServer()
      socket.listen(0, '127.0.0.1', () => {
        const address = socket.address() as { port: number }
        socket.close(() => resolve(address.port))
      })
    })
    url = `http://127.0.0.1:${port}`
    config = join(directory, 'local.toml')
    await writeFile(config, `embedding_provider = "none"\nserver_url = "${url}"\n[auto_improve.scheduler]\nenabled = false\n`)
    await writeFile(join(directory, 'data', 'auth-token'), token)
    server = spawn(binary!, ['--data-dir', join(directory, 'data'), '--config', config, 'serve', '--transport', 'http', '--bind', `127.0.0.1:${port}`, '--enable-web'],
      { env: { ...env, AI_MEMORY_AUTH_TOKEN: token }, windowsHide: true, stdio: 'ignore' })
    client = new AiMemoryClient(url, token)
    provider = new AiMemoryProvider(client)
    await eventually(async () => (await provider.health()).status === 'ready')
    await provider.start()
  }, 20000)
  afterAll(async () => {
    if (server && server.exitCode === null) {
      await new Promise<void>(resolve => { server.once('exit', () => resolve()); server.kill() })
    }
    if (directory) await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
  })
  test('Claude ends; independent Codex session retrieves JWT decision from persistent project memory', async () => {
    const claude = await context('continuity', 'claude-code')
    const codex = await context('continuity', 'codex')
    await hook(claude, 'session-start')
    await hook(claude, 'user-prompt-submit', { prompt: 'Test JWT authentication decisions.' })
    await provider.remember(claude, { text: 'Authentication uses JWT HttpOnly.' })
    await hook(claude, 'session-end')
    await hook(codex, 'session-start')
    await hook(codex, 'user-prompt-submit', { prompt: 'Continue authentication work.' })
    expect(codex.sessionId).not.toBe(claude.sessionId)
    expect(JSON.stringify(await provider.search(codex, 'JWT'))).toContain('JWT HttpOnly')
    await eventually(async () => (await provider.getRecentSessions(claude)).some(s => s.sessionId === claude.sessionId && s.ended))
    await hook(codex, 'session-end')
  }, 30000)
  test('concurrent native sessions write independently; ending Claude leaves Codex open', async () => {
    const claude = await context('concurrent', 'claude-code')
    const codex = await context('concurrent', 'codex')
    await Promise.all([hook(claude, 'session-start'), hook(codex, 'session-start')])
    await Promise.all([hook(claude, 'user-prompt-submit', { prompt: 'Work on ConcurrencyAlpha.' }), hook(codex, 'user-prompt-submit', { prompt: 'Work on ConcurrencyBeta.' })])
    await Promise.all([
      provider.remember(claude, { text: 'ConcurrencyAlpha uses isolated transactions.' }),
      provider.remember(codex, { text: 'ConcurrencyBeta uses idempotent retries.' })
    ])
    await hook(claude, 'session-end')
    await hook(codex, 'stop') // Native spool drain boundary, not a session end.
    await eventually(async () => {
      const sessions = await provider.getRecentSessions(codex)
      return sessions.some(s => s.sessionId === claude.sessionId && s.ended) && sessions.some(s => s.sessionId === codex.sessionId && !s.ended)
    })
    expect(JSON.stringify(await provider.search(codex, 'ConcurrencyAlpha'))).toContain('isolated transactions')
    expect(JSON.stringify(await provider.search(claude, 'ConcurrencyBeta'))).toContain('idempotent retries')
    await hook(codex, 'session-end')
  }, 30000)
  test('explicit project scope never returns another project decision or global memories', async () => {
    const a = await context('isolation-a', 'claude-code')
    const b = await context('isolation-b', 'codex')
    await provider.remember(a, { text: 'IsolationCanaryA belongs exclusively to project A.' })
    await provider.remember(b, { text: 'IsolationCanaryB belongs exclusively to project B.' })
    await client.tool('memory_write_page', { workspace: 'contract', project: '_global', path: 'canary.md', body: 'IsolationCanaryGlobal must not appear.' })
    expect(await provider.search(b, 'IsolationCanaryA')).toEqual([])
    expect(await provider.search(a, 'IsolationCanaryB')).toEqual([])
    expect(await provider.search(a, 'IsolationCanaryGlobal')).toEqual([])
  })
  test('native prompt capture persists without terminal scraping or manual memory writes', async () => {
    const ctx = await context('capture', 'claude-code')
    await hook(ctx, 'session-start')
    await hook(ctx, 'user-prompt-submit', { prompt: 'CaptureCanary: authentication uses JWT HttpOnly cookies.' })
    await hook(ctx, 'session-end')
    await eventually(async () => JSON.stringify(await provider.search(ctx, 'CaptureCanary')).includes('CaptureCanary'))
  }, 30000)
  test('context reads handoff history without consuming it', async () => {
    const ctx = await context('handoff', 'claude-code')
    await hook(ctx, 'session-start')
    await hook(ctx, 'user-prompt-submit', { prompt: 'HandoffCanary: JWT implemented; TODO test token rotation.' })
    await hook(ctx, 'session-end')
    await eventually(async () => (await provider.listHandoffs(ctx)).length > 0)
    const before = await provider.listHandoffs(ctx)
    const brief = await provider.getRelevantContext(ctx, 'HandoffCanary')
    expect(brief.text.length).toBeLessThanOrEqual(4000)
    expect(await provider.listHandoffs(ctx)).toEqual(before)
    await provider.acceptHandoff(ctx)
    await eventually(async () => (await provider.listHandoffs(ctx)).some(h => h.state === 'accepted'))
  }, 30000)
  test('concurrent automatic capture respects project scope even when actor activity switches', async () => {
    const a = await context('capture-a', 'claude-code')
    const b = await context('capture-b', 'codex')
    await Promise.all([hook(a, 'session-start'), hook(b, 'session-start')])
    await Promise.all([
      hook(a, 'user-prompt-submit', { prompt: 'ScopedCaptureAlpha must stay in project A.' }),
      hook(b, 'user-prompt-submit', { prompt: 'ScopedCaptureBeta must stay in project B.' })
    ])
    await Promise.all([hook(a, 'session-end'), hook(b, 'session-end')])
    await eventually(async () => JSON.stringify(await provider.search(a, 'ScopedCaptureAlpha')).includes('ScopedCaptureAlpha'))
    await eventually(async () => JSON.stringify(await provider.search(b, 'ScopedCaptureBeta')).includes('ScopedCaptureBeta'))
    expect(await provider.search(a, 'ScopedCaptureBeta')).toEqual([])
    expect(await provider.search(b, 'ScopedCaptureAlpha')).toEqual([])
  }, 30000)
  test('project knowledge survives a native server restart', async () => {
    const ctx = await context('durability', 'codex')
    await provider.remember(ctx, { text: 'DurableCanary: authentication uses JWT HttpOnly.' })
    await new Promise<void>(resolve => { server.once('exit', () => resolve()); server.kill() })
    server = spawn(binary!, ['--data-dir', join(directory, 'data'), '--config', config, 'serve', '--transport', 'http', '--bind', new URL(url).host, '--enable-web'],
      { env: { ...env, AI_MEMORY_AUTH_TOKEN: token }, windowsHide: true, stdio: 'ignore' })
    await eventually(async () => (await provider.health()).status === 'ready')
    await provider.start()
    expect(JSON.stringify(await provider.search(ctx, 'DurableCanary'))).toContain('JWT HttpOnly')
  }, 20000)
})
