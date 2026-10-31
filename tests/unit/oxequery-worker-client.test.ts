// @vitest-environment node
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { OxeQueryWorkerClient } from '../../electron/main/services/oxequery/worker-client'
import { connectIncidentJournal, incidentSubject } from '../../electron/main/services/diagnostics/incident-sink'
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

// B14: a worker that reports the person's sessions at risk as the real one does. 'begin' leaves a person transaction
// open, 'commit' ends it, '…slow' never answers, 'hang' blocks the worker for good, and 'stops' lists the cancel and
// close requests it received, with the role they were for.
const ROLE_WORKER = `
const { parentPort } = require('node:worker_threads')
let atRisk = 0
const stops = []
parentPort.on('message', ({ requestId, op, connection }) => {
  const reply = result => parentPort.postMessage({ requestId, result, personAtRisk: atRisk })
  if (op === 'ping') return reply({ ok: true })
  if (op === 'begin') { atRisk = 1; return reply({ state: 'open' }) }
  if (op === 'commit') { atRisk = 0; return reply({ state: 'none' }) }
  if (op === 'sql.cancel' || op === 'mongo.cancel' || op === 'close') { stops.push({ op, id: connection.id, role: connection.role }); return reply({ cancelled: true }) }
  if (op === 'stops') return reply(stops)
  if (op.endsWith('slow')) return
  if (op === 'hang') { const end = Date.now() + 60000; while (Date.now() < end) {} }
  reply({ done: true })
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
    writeFileSync(join(dir, 'stuck.cjs'), STUCK_WORKER)
    writeFileSync(join(dir, 'roles.cjs'), ROLE_WORKER)
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

  const person = { id: 'c1', engine: 'postgres' } as unknown as ResolvedConnection
  const agent = { id: 'c1', engine: 'postgres', role: 'agent' } as unknown as ResolvedConnection
  const roles = (timeoutMs: number, faults: string[] = []): OxeQueryWorkerClient => {
    const created = new OxeQueryWorkerClient(join(dir, 'roles.cjs'), timeoutMs, detail => faults.push(detail), 200)
    clients.push(created)
    return created
  }
  const workerOf = (target: OxeQueryWorkerClient): unknown => (target as unknown as { worker?: unknown }).worker

  it("an agent's timeout with a person transaction open cancels only the agent's statement", async () => {
    const shared = roles(150)
    await shared.call('begin', person)
    await expect(shared.call('sql.run', agent)).resolves.toEqual({ done: true })
    await expect(shared.call('slow', agent)).rejects.toThrow(/did not answer in time/)
    await new Promise(resolve => setTimeout(resolve, 100))
    expect(await shared.call('stops')).toEqual([{ op: 'close', id: 'c1', role: 'agent' }])
    await expect(shared.call('sql.slow', agent).catch(() => 'timed out')).resolves.toBe('timed out')
    await new Promise(resolve => setTimeout(resolve, 100))
    const stops = await shared.call<{ op: string; role: string }[]>('stops')
    expect(stops.every(stop => stop.role === 'agent')).toBe(true)
    expect(stops.map(stop => stop.op)).toEqual(['close', 'sql.cancel'])
    // The person's transaction is still there, on the same worker.
    expect(await shared.call('commit', person)).toEqual({ state: 'none' })
  })

  it("does not restart a stuck worker while a person session has a transaction open, and journals the deferral", async () => {
    const recorded: Array<[string, string | undefined]> = []
    connectIncidentJournal(async () => ({ record: (code, subject) => { recorded.push([code, subject]) }, flush: () => undefined }))
    try {
      const faults: string[] = []
      const stuck = roles(100, faults)
      await stuck.call('begin', person)
      const worker = workerOf(stuck)
      await expect(stuck.call('hang', agent)).rejects.toThrow(/did not answer in time/)
      await new Promise(resolve => setTimeout(resolve, 600))
      expect(workerOf(stuck)).toBe(worker)
      expect(faults.some(fault => /restart put off while a person session is at risk/.test(fault))).toBe(true)
      // The deferral is visible in the diagnostics journal, with the connection whose timeout asked (hashed, as every subject).
      await vi.waitFor(() => expect(recorded).toContainEqual(['incident.oxequery.restartDeferred', incidentSubject('c1')]))
      expect(recorded.filter(([code]) => code === 'incident.oxequery.restartDeferred')).toHaveLength(1)
    } finally { connectIncidentJournal(null) }
  })

  it("does not restart a stuck worker while a request of the person's is waiting", async () => {
    const stuck = roles(100)
    await stuck.call('ping')
    const worker = workerOf(stuck)
    await expect(stuck.call('hang', agent)).rejects.toThrow(/did not answer in time/)
    // Sent after the agent's request, so the worker never reads it; its own budget is long.
    const waiting = stuck.call('sql.run', { ...person, statementTimeoutMs: 600_000 } as ResolvedConnection).catch(() => undefined)
    await new Promise(resolve => setTimeout(resolve, 600))
    expect(workerOf(stuck)).toBe(worker)
    await stuck.close()
    await waiting
  })

  it('restarts a stuck worker as the last resort when no person session is at risk', async () => {
    const stuck = roles(100)
    await stuck.call('begin', person)
    await stuck.call('commit', person)
    await expect(stuck.call('hang', agent)).rejects.toThrow(/did not answer in time/)
    await new Promise(resolve => setTimeout(resolve, 600))
    expect(workerOf(stuck)).toBeUndefined()
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
