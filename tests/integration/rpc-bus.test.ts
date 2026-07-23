import { connect, type Socket } from 'node:net'
import { randomBytes } from 'node:crypto'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { RpcDispatcher, RpcInvalidParams, RPC_ERRORS } from '../../electron/main/runtime/rpc/dispatcher'
import { defaultRpcEndpoint, RpcTransport } from '../../electron/main/runtime/rpc/transport'
import { buildRpcMethods } from '../../electron/main/runtime/rpc/methods'
import { LocalExecutionHost } from '../../electron/main/runtime/execution-host'
import type { AppDatabase } from '../../electron/main/db/index'
import type { GitHubService } from '../../electron/main/services/github.service'

describe('RpcDispatcher', () => {
  it('rejects a request without a method', async () => {
    const dispatcher = new RpcDispatcher()
    const response = await dispatcher.dispatch({ id: 1 } as never)
    expect(response).toMatchObject({ id: 1, error: { code: RPC_ERRORS.invalidRequest } })
  })

  it('returns -32601 for an unknown method', async () => {
    const dispatcher = new RpcDispatcher()
    const response = await dispatcher.dispatch({ id: 2, method: 'nope' })
    expect(response).toMatchObject({ error: { code: RPC_ERRORS.methodNotFound } })
  })

  it('maps invalid params to -32602 and other throws to -32603', async () => {
    const dispatcher = new RpcDispatcher()
      .register('bad-params', () => {
        throw new RpcInvalidParams('workspaceId must be a non-empty string')
      })
      .register('boom', () => {
        throw new Error('exploded')
      })

    await expect(dispatcher.dispatch({ id: 3, method: 'bad-params' })).resolves.toMatchObject({
      error: { code: RPC_ERRORS.invalidParams, message: 'workspaceId must be a non-empty string' }
    })
    await expect(dispatcher.dispatch({ id: 4, method: 'boom' })).resolves.toMatchObject({
      error: { code: RPC_ERRORS.internalError, message: 'exploded' }
    })
  })

  it('refuses duplicate registrations', () => {
    const dispatcher = new RpcDispatcher().register('ping', () => ({}))
    expect(() => dispatcher.register('ping', () => ({}))).toThrow(/already registered/)
  })
})

describe('RPC methods', () => {
  const db = {
    prepare: (sql: string) => ({
      all: () => [{ id: 'ws-1', name: 'repo', root_path: 'C:/repo', is_active: 1 }],
      get: (id: string) => (id === 'ws-1' ? { root_path: 'C:/repo' } : undefined)
    })
  } as unknown as AppDatabase

  it('creates a worktree through the existing git service', async () => {
    const createWorktree = vi.fn(async () => ({ ok: true, message: 'created' }))
    const methods = buildRpcMethods({
      db,
      gitHubService: { createWorktree, listWorktrees: vi.fn(async () => []) } as unknown as GitHubService,
      executionHost: new LocalExecutionHost(),
      appVersion: '0.4.0',
      listMethods: () => []
    })

    const result = await methods['worktree.create']({ workspaceId: 'ws-1', branch: 'feat/x', path: 'wt-x', createBranch: true })

    expect(createWorktree).toHaveBeenCalledWith({ rootPath: 'C:/repo', branch: 'feat/x', path: 'wt-x', createBranch: true })
    expect(result).toMatchObject({ ok: true, branch: 'feat/x' })
  })

  it('rejects an unknown workspace with invalid params', async () => {
    const methods = buildRpcMethods({
      db,
      gitHubService: {} as GitHubService,
      executionHost: new LocalExecutionHost(),
      appVersion: '0.4.0',
      listMethods: () => []
    })

    await expect(methods['worktree.create']({ workspaceId: 'ghost', branch: 'b', path: 'p' })).rejects.toBeInstanceOf(
      RpcInvalidParams
    )
  })
})

describe('RpcTransport', () => {
  let transport: RpcTransport | null = null
  const openSockets: Socket[] = []

  afterEach(async () => {
    for (const socket of openSockets) socket.destroy()
    openSockets.length = 0
    await transport?.stop()
    transport = null
  })

  async function startTransport(token: string): Promise<string> {
    const dispatcher = new RpcDispatcher().register('ping', () => ({ ok: true }))
    const endpoint = defaultRpcEndpoint(randomBytes(4).toString('hex'), tmpdir())
    transport = new RpcTransport({ dispatcher, token, endpoint })
    await transport.start()
    return endpoint
  }

  function call(endpoint: string, lines: string[]): Promise<string[]> {
    return new Promise((resolve, reject) => {
      const socket = connect(endpoint)
      openSockets.push(socket)
      const received: string[] = []
      socket.setEncoding('utf8')
      socket.on('connect', () => socket.write(lines.map((line) => `${line}\n`).join('')))
      socket.on('data', (chunk: string) => {
        received.push(...chunk.split('\n').filter(Boolean))
        resolve(received)
      })
      socket.on('close', () => resolve(received))
      socket.on('error', reject)
      setTimeout(() => resolve(received), 3000)
    })
  }

  it('answers a request over the local socket after the token line', async () => {
    const endpoint = await startTransport('secret-token')
    const [response] = await call(endpoint, ['secret-token', JSON.stringify({ jsonrpc: '2.0', id: 7, method: 'ping' })])
    expect(JSON.parse(response)).toEqual({ jsonrpc: '2.0', id: 7, result: { ok: true } })
  })

  it('closes the connection when the token is wrong', async () => {
    const endpoint = await startTransport('secret-token')
    const responses = await call(endpoint, ['wrong-token', JSON.stringify({ id: 1, method: 'ping' })])
    expect(JSON.parse(responses[0])).toMatchObject({ error: { message: 'Unauthorized' } })
    expect(responses).toHaveLength(1)
  })

  it('reports malformed JSON without dropping the connection', async () => {
    const endpoint = await startTransport('secret-token')
    const [response] = await call(endpoint, ['secret-token', '{not json'])
    expect(JSON.parse(response)).toMatchObject({ error: { code: -32700 } })
  })
})

describe('LocalExecutionHost', () => {
  it('runs a command and captures stdout', async () => {
    const host = new LocalExecutionHost()
    const result = await host.exec(process.execPath, ['-e', 'process.stdout.write("hello")'], { cwd: process.cwd() })
    expect(result).toMatchObject({ code: 0, stdout: 'hello', timedOut: false })
  })

  it('reports a non-zero exit instead of throwing', async () => {
    const host = new LocalExecutionHost()
    const result = await host.exec(process.execPath, ['-e', 'process.exit(3)'], { cwd: process.cwd() })
    expect(result.code).toBe(3)
  })

  it('kills a command that exceeds its timeout', async () => {
    const host = new LocalExecutionHost()
    const result = await host.exec(process.execPath, ['-e', 'setTimeout(() => {}, 10000)'], {
      cwd: process.cwd(),
      timeoutMs: 300
    })
    expect(result.timedOut).toBe(true)
  })
})
