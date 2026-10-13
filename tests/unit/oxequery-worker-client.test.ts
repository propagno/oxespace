// @vitest-environment node
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { OxeQueryWorkerClient } from '../../electron/main/services/oxequery/worker-client'
import type { ResolvedConnection } from '../../electron/main/services/oxequery/oxequery-errors'

// A worker that answers after the delay given as input, standing in for a slow statement.
const CRASHING_WORKER = `
const { parentPort } = require('node:worker_threads')
parentPort.on('message', () => { throw new Error('boom while talking to postgres://app:s3cr3t@db/app') })
`

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
    writeFileSync(join(dir, 'crash.cjs'), CRASHING_WORKER)
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

  it('names what the worker died of, masks credentials and reports it to the log', async () => {
    const faults: string[] = []
    const crashing = new OxeQueryWorkerClient(join(dir, 'crash.cjs'), 5000, detail => faults.push(detail))
    clients.push(crashing)
    const failure = await crashing.call('anything').catch((error: Error) => error)
    expect(failure).toBeInstanceOf(Error)
    expect((failure as Error).message).toMatch(/stopped unexpectedly \(Error: boom while talking to postgres:\/\/app:\*\*\*@db\/app\)/)
    expect((failure as Error).message).not.toContain('s3cr3t')
    expect(faults).toHaveLength(1)
  })
})
