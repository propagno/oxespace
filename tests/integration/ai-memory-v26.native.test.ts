// @vitest-environment node
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { spawn, execFile, type ChildProcess } from 'node:child_process'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { createServer } from 'node:net'
import { randomUUID } from 'node:crypto'
import { promisify } from 'node:util'
import Database from 'better-sqlite3'
import { AiMemoryClient } from '../../electron/main/services/memory/ai-memory.client'
import { AiMemoryProvider } from '../../electron/main/services/memory/ai-memory.provider'
import { MemoryOutbox } from '../../electron/main/services/memory/memory-outbox'
import { MemoryDeliveryWorker } from '../../electron/main/services/memory/memory-delivery'

// Separate opt-in: these assertions require the fixed 2.6.2 binary, not the
// production pin. The certification runner must supply it, never accept skips.
const binary = process.env.OXESPACE_AI_MEMORY_V26_TEST_BINARY
const exec = promisify(execFile)
describe.skipIf(!binary)('AI Memory 2.6.2 external lifecycle contract', () => {
  let directory: string
  let cwd: string
  let config: string
  let url: string
  let server: ChildProcess | undefined
  let client: AiMemoryClient
  const token = randomUUID()
  const scope = { workspace: 'contract-v26', project: 'synthetic' }
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.toUpperCase().startsWith('AI_MEMORY_')))

  async function request(path: string, body?: unknown, authorized = true) {
    const response = await fetch(url + path, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { 'Content-Type': 'application/json', ...(authorized ? { Authorization: `Bearer ${token}` } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(3000), redirect: 'error'
    })
    return response
  }
  function item(session: string, event: string, key = randomUUID()) {
    const query = new URLSearchParams({ ...scope, agent: 'codex', event,
      extension: 'oxespace.contract', source_event: event, ingest_key: key })
    return { url: `/hook?${query}`, body: { session_id: session, cwd, prompt: 'Synthetic delivery contract.' } }
  }
  async function hook(event: string, session: string, check = false) {
    return new Promise<string>((resolveHook, reject) => {
      const child = execFile(binary!, ['--data-dir', join(directory, 'data'), '--config', config,
        'hook', '--agent', 'codex', '--event', event, '--server-url', url, '--capture-mode', 'allowlist',
        ...(check ? ['--check-capture'] : [])], {
        cwd, env: { ...env, AI_MEMORY_CAPTURE_OWNER: 'oxespace.contract' }, windowsHide: true,
        timeout: 8000, maxBuffer: 65536
      }, (error, stdout) => error ? reject(error) : resolveHook(stdout))
      child.stdin?.on('error', () => {})
      child.stdin?.end(JSON.stringify({ session_id: session, cwd, prompt: 'Synthetic policy inspection.' }))
    })
  }

  beforeAll(async () => {
    expect((await exec(binary!, ['--version'], { windowsHide: true, timeout: 5000 })).stdout.trim()).toBe('ai-memory 2.6.2')
    directory = await mkdtemp(join(tmpdir(), 'oxe-memory-v26-'))
    cwd = join(directory, 'project')
    await mkdir(cwd)
    await mkdir(join(directory, 'data'))
    await writeFile(join(cwd, '.ai-memory.toml'), `workspace = "${scope.workspace}"\nproject = "${scope.project}"\n`)
    const port = await new Promise<number>((resolvePort, reject) => {
      const socket = createServer()
      socket.on('error', reject)
      socket.listen(0, '127.0.0.1', () => {
        const address = socket.address() as { port: number }
        socket.close(() => resolvePort(address.port))
      })
    })
    url = `http://127.0.0.1:${port}`
    config = join(directory, 'config.toml')
    await writeFile(config, `embedding_provider = "none"\nserver_url = "${url}"\ncapture_assistant = true\n[profile]\nenabled = false\n[handoff]\nclaim_on_session_start = false\n[auto_improve.scheduler]\nenabled = false\n`)
    await writeFile(join(directory, 'data', 'auth-token'), token)
    server = spawn(binary!, ['--data-dir', join(directory, 'data'), '--config', config, 'serve',
      '--transport', 'http', '--bind', new URL(url).host, '--enable-api'], {
      env: { ...env, AI_MEMORY_AUTH_TOKEN: token }, windowsHide: true, stdio: 'ignore'
    })
    let launchError: Error | undefined
    server.on('error', error => { launchError = error })
    client = new AiMemoryClient(url, token)
    for (let attempt = 0; attempt < 40; attempt++) {
      if (launchError) throw launchError
      if (server.exitCode !== null) throw Error('Fixture server exited before readiness')
      try { await client.initialize(); return } catch { /* bounded fixture startup */ }
      await new Promise(resolveDelay => setTimeout(resolveDelay, 100))
    }
    throw Error('Fixture server did not initialize')
  }, 20000)

  afterAll(async () => {
    if (server?.pid && server.exitCode === null) {
      const child = server
      await new Promise<void>((resolveExit, reject) => {
        const timer = setTimeout(() => reject(Error('Fixture child did not exit')), 5000)
        child.once('exit', () => { clearTimeout(timer); resolveExit() })
        child.kill('SIGKILL')
      })
    }
    if (directory) {
      const target = resolve(directory)
      if (dirname(target) !== resolve(tmpdir()) || !basename(target).startsWith('oxe-memory-v26-')) throw Error('Unsafe fixture cleanup')
      await rm(target, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
    }
  }, 10000)

  test('API-only supports authenticated identity and advertises exact handoff selection', async () => {
    expect((await request('/identity')).status).toBe(200)
    expect((await request('/identity', undefined, false)).status).toBe(401)
    const listing = await client.request('/mcp', { jsonrpc: '2.0', id: 100, method: 'tools/list', params: {} }) as {
      result: { tools: { name: string; inputSchema: { properties: Record<string, unknown> } }[] }
    }
    const accept = listing.result.tools.find(tool => tool.name === 'memory_handoff_accept')
    expect(accept?.inputSchema.properties).toHaveProperty('handoff_id')
    expect(listing.result.tools.some(tool => tool.name === 'memory_handoff_begin')).toBe(true)
  })

  test('external owner suppresses native ingestion while preserving policy inspection', async () => {
    await client.tool('memory_write_page', { ...scope, path: 'notes/policy.md', body: 'Synthetic scope for capture policy checks.' })
    const session = randomUUID()
    const policy = JSON.parse(await hook('user-prompt-submit', session, true))
    expect(policy).toMatchObject({ external_capture: true, admits_capture: false, policy_admits_capture: true })
    await hook('user-prompt-submit', session)
    const sessions = await client.request(`/api/v1/workspaces/${scope.workspace}/projects/${scope.project}/sessions?include_open=true`) as { sessions?: { session_id: string }[] }
    expect(sessions.sessions?.some(row => row.session_id === session) ?? false).toBe(false)
  }, 15000)

  test('batch acknowledgements distinguish persistence, replay and invalid event drops', async () => {
    const session = randomUUID()
    const event = item(session, 'user-prompt-submit')
    const first = await (await request('/hook/batch', [event])).json()
    expect(first).toMatchObject({ accepted: 1, results: [{ index: 0, outcome: 'stored' }] })
    const replay = await (await request('/hook/batch', [event])).json()
    expect(replay).toMatchObject({ accepted: 1, results: [{ index: 0, outcome: 'replayed' }] })
    const invalid = { ...item(randomUUID(), 'user-prompt-submit'), body: { cwd, prompt: 'No session id.' } }
    const dropped = await (await request('/hook/batch', [invalid])).json()
    expect(dropped).toMatchObject({ accepted: 1, results: [{ index: 0, outcome: 'dropped_invalid' }] })
  })

  test('durable producer replays the same key after reopening without a second observation', async () => {
    const session = randomUUID()
    const key = MemoryOutbox.ingestKey([scope.project, 'codex', session, 'user-prompt-submit', 'turn-1'])
    const outbox = new MemoryOutbox(join(directory, 'external-outbox'))
    const event = item(session, 'user-prompt-submit', key)
    expect(await outbox.admit({ key, projectId: scope.project, sessionId: session, createdAt: Date.now(), policy: 'keep', item: event })).toBe(true)
    const reopened = new MemoryOutbox(outbox.directory)
    const worker = new MemoryDeliveryWorker(reopened, () => client)
    expect(await worker.flush()).toBe(true)
    expect(worker.stats().stored).toBe(1)
    expect(await reopened.pending()).toEqual([])
    expect(await reopened.admit({ key, projectId: scope.project, sessionId: session, createdAt: Date.now(), policy: 'keep', item: event })).toBe(true)
    expect(await worker.flush()).toBe(true)
    expect(worker.stats().replayed).toBe(1)
    await worker.stop()
  })

  test('external Stop accepts the versioned, capped assistant excerpt without a raw field', async () => {
    const session = randomUUID()
    const start = item(session, 'session-start')
    const prompt = item(session, 'user-prompt-submit')
    const stop = item(session, 'stop')
    stop.url += '&capture_assistant=1'
    const body = { session_id: session, cwd, _ai_memory_assistant: { version: 1, excerpt: 'Synthetic completion for the contract.' } }
    const result = await (await request('/hook/batch', [start, prompt, { ...stop, body }])).json()
    expect(result).toMatchObject({ accepted: 3 })
    expect(result.results.map((row: { outcome: string }) => row.outcome)).toEqual(['stored', 'stored', 'stored'])
    const persisted = new Database(join(directory, 'data', 'db', 'memory.sqlite'), { readonly: true })
    try {
      const rows = persisted.prepare('SELECT body FROM observations WHERE kind = ?').all('stop') as { body: string }[]
      expect(rows.some(row => row.body.includes(body._ai_memory_assistant.excerpt))).toBe(true)
    } finally { persisted.close() }
  })

  test('API-only returns an incremental page envelope', async () => {
    await client.tool('memory_write_page', { ...scope, path: 'notes/contract.md', body: 'IncrementalContractCanary for a synthetic project.' })
    const response = await client.request(`/api/v1/workspaces/${scope.workspace}/projects/${scope.project}/recent?updated_since=2020-01-01T00%3A00%3A00Z&limit=10`) as { pages: unknown[]; next_cursor: unknown }
    expect(Array.isArray(response.pages)).toBe(true)
    expect(JSON.stringify(response.pages)).toContain('contract.md')
    expect(response).toHaveProperty('next_cursor')
  })

  test('opening a session leaves offers unclaimed and exact acceptance chooses the requested ID', async () => {
    await client.tool('memory_handoff_begin', { ...scope, cwd, summary: 'FirstContractOffer', next_steps: ['Verify first offer.'] })
    await client.tool('memory_handoff_begin', { ...scope, cwd, summary: 'SecondContractOffer', next_steps: ['Verify second offer.'] })
    const route = `/api/v1/workspaces/${scope.workspace}/projects/${scope.project}/handoffs?limit=20`
    type Handoffs = { handoffs: { id: string; summary: string; state: string }[] }
    const before = await client.request(route) as Handoffs
    const selected = before.handoffs.find(row => row.summary === 'FirstContractOffer')!
    expect(selected).toBeDefined()
    await hook('session-start', randomUUID())
    expect(await client.request(route)).toEqual(before)
    await client.tool('memory_handoff_accept', { ...scope, cwd, handoff_id: selected.id })
    const after = await client.request(route) as Handoffs
    expect(after.handoffs.find(row => row.id === selected.id)?.state).toBe('accepted')
    expect(after.handoffs.find(row => row.summary === 'SecondContractOffer')?.state).not.toBe('accepted')
  }, 15000)

  test('typed notes are idempotent per wording and a superseding note keeps the old page readable', async () => {
    const provider = new AiMemoryProvider(client)
    const ctx = { projectId: 'synthetic-note', ...scope, cwd }
    const original = 'NoteContractLimit is 128 MiB per queue.'
    await provider.remember(ctx, { text: original, kind: 'decision' })
    await provider.remember(ctx, { text: original, kind: 'decision' })
    const first = (await provider.search(ctx, 'NoteContractLimit')).filter(hit => hit.path?.startsWith('decisions/oxe-'))
    expect(first).toHaveLength(1)
    await provider.remember(ctx, { text: 'NoteContractLimit is now 64 MiB per queue.', kind: 'decision', supersedes: first[0].path })
    const all = (await provider.search(ctx, 'NoteContractLimit')).filter(hit => hit.path?.startsWith('decisions/oxe-'))
    expect(all).toHaveLength(2)
    expect(all.find(hit => hit.text.includes('128 MiB'))).toBeDefined()
    expect(all.find(hit => hit.text.includes(first[0].path!) && hit.text.includes('64 MiB'))).toBeDefined()
  }, 15000)

  test('the provider accepts only the requested offer and rejects a second attempt', async () => {
    const provider = new AiMemoryProvider(client)
    const ctx = { projectId: 'synthetic-handoff', ...scope, cwd }
    await client.tool('memory_handoff_begin', { ...scope, cwd, summary: 'ProviderOfferOne', next_steps: ['One.'] })
    await client.tool('memory_handoff_begin', { ...scope, cwd, summary: 'ProviderOfferTwo', next_steps: ['Two.'] })
    const offers = await provider.listHandoffs(ctx)
    const one = offers.find(offer => offer.summary === 'ProviderOfferOne')!
    const two = offers.find(offer => offer.summary === 'ProviderOfferTwo')!
    await provider.acceptHandoff(ctx, one.id)
    const after = await provider.listHandoffs(ctx)
    expect(after.find(offer => offer.id === one.id)?.state).toBe('accepted')
    expect(after.find(offer => offer.id === two.id)?.state).not.toBe('accepted')
    await expect(provider.acceptHandoff(ctx, one.id)).rejects.toThrow('already accepted')
    await expect(provider.acceptHandoff(ctx, 'does-not-exist')).rejects.toThrow('not found')
  }, 15000)
})
