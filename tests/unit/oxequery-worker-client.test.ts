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
parentPort.on('message', ({ requestId, op, input }) => {
  if (op === 'ping') return parentPort.postMessage({ requestId, result: { ok: true } })
  setTimeout(() => parentPort.postMessage({ requestId, result: { done: true, op } }), input?.delayMs ?? 0)
})
`

// A worker stuck in a loop after its first request: it never answers again, not even a ping.
const STUCK_WORKER = `
const { parentPort } = require('node:worker_threads')
parentPort.on('message', () => { const end = Date.now() + 60000; while (Date.now() < end) {} })
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
    writeFileSync(join(dir, 'stuck.cjs'), STUCK_WORKER)
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

  it('fails only the request that overran its budget; the worker and other requests carry on', async () => {
    const shared = client(400)
    const slow = shared.call('slow', undefined, { delayMs: 800 })
    const quick = shared.call('quick', undefined, { delayMs: 100 })
    await expect(slow).rejects.toThrow(/did not answer in time/)
    await expect(quick).resolves.toEqual({ done: true, op: 'quick' })
    await expect(shared.call('after', undefined, { delayMs: 0 })).resolves.toEqual({ done: true, op: 'after' })
  })

  it('restarts a worker that no longer answers a ping after a timeout', async () => {
    const stuck = new OxeQueryWorkerClient(join(dir, 'stuck.cjs'), 100, undefined, 200)
    clients.push(stuck)
    await expect(stuck.call('anything')).rejects.toThrow(/did not answer in time/)
    const worker = () => (stuck as unknown as { worker?: unknown }).worker
    await new Promise(resolve => setTimeout(resolve, 600))
    expect(worker()).toBeUndefined()
  })

  it('waits for a statement the connection allows to run longer than the base budget', async () => {
    const connection = { statementTimeoutMs: 600_000 } as unknown as ResolvedConnection
    await expect(client(80).call('slow', connection, { delayMs: 600 })).resolves.toEqual({ done: true, op: 'slow' })
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
