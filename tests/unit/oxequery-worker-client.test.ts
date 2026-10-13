// @vitest-environment node
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { OxeQueryWorkerClient } from '../../electron/main/services/oxequery/worker-client'
import type { ResolvedConnection } from '../../electron/main/services/oxequery/oxequery-errors'

// A worker that answers after the delay given as input, standing in for a slow statement.
const WORKER = `
const { parentPort } = require('node:worker_threads')
parentPort.on('message', ({ requestId, input }) => {
  setTimeout(() => parentPort.postMessage({ requestId, result: { done: true } }), input?.delayMs ?? 0)
})
`

describe('OxeQueryWorkerClient time budget', () => {
  let dir: string
  let workerPath: string
  const clients: OxeQueryWorkerClient[] = []
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'oxequery-worker-'))
    workerPath = join(dir, 'worker.cjs')
    writeFileSync(workerPath, WORKER)
  })
  afterAll(async () => {
    await Promise.all(clients.map(client => client.close().catch(() => undefined)))
    rmSync(dir, { recursive: true, force: true })
  })
  const client = (timeoutMs: number): OxeQueryWorkerClient => {
    const created = new OxeQueryWorkerClient(workerPath, timeoutMs)
    clients.push(created)
    return created
  }

  it('restarts the worker when a request without a statement timeout overruns the base budget', async () => {
    await expect(client(80).call('slow', undefined, { delayMs: 600 })).rejects.toThrow(/timed out/)
  })

  it('waits for a statement the connection allows to run longer than the base budget', async () => {
    const connection = { statementTimeoutMs: 600_000 } as unknown as ResolvedConnection
    await expect(client(80).call('slow', connection, { delayMs: 600 })).resolves.toEqual({ done: true })
  })
})
