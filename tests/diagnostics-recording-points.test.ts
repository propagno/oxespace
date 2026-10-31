// @vitest-environment node
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { AgentProcessTransport } from '../electron/main/services/conversation/process-transport'
import { connectIncidentJournal, incidentSubject, recordInteractionOverBudget } from '../electron/main/services/diagnostics/incident-sink'
import { OxeQueryWorkerClient } from '../electron/main/services/oxequery/worker-client'
import type { ResolvedConnection } from '../electron/main/services/oxequery/oxequery-errors'

// Recording points of the incident journal (B8.3) outside the IPC wrapper; each passes a code and an id of ours.
const recorded: Array<[string, string | undefined]> = []
beforeEach(() => { recorded.splice(0); connectIncidentJournal(async () => ({ record: (code, subject) => { recorded.push([code, subject]) }, flush: () => undefined })) })
afterEach(() => connectIncidentJournal(null))

let dir: string
beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'oxe-incident-points-'))
  writeFileSync(join(dir, 'timeout.cjs'), `
const { parentPort } = require('node:worker_threads')
parentPort.on('message', ({ requestId, op }) => {
  if (op === 'ping') return parentPort.postMessage({ requestId, result: { ok: true } })
  if (op === 'slow') return
  parentPort.postMessage({ requestId, error: { code: 'timeout', message: 'statement timeout on SELECT salary FROM people' } })
})`)
})
afterAll(() => rmSync(dir, { recursive: true, force: true }))

describe('incident recording points', () => {
  it('OxeQuery: a statement the server stopped and a request the worker never answered', async () => {
    const client = new OxeQueryWorkerClient(join(dir, 'timeout.cjs'), 300)
    const connection = { id: 'conn-1' } as ResolvedConnection
    try {
      await expect(client.call('sql.query', connection, {})).rejects.toThrow('statement timeout')
      await expect(client.call('slow', connection, {})).rejects.toThrow('did not answer in time')
      await vi.waitFor(() => expect(recorded).toEqual([
        ['incident.oxequery.timeout', incidentSubject('conn-1')],
        ['incident.oxequery.timeout', incidentSubject('conn-1')]
      ]))
    } finally { await client.close().catch(() => undefined) }
  })

  it('a Thread agent whose CLI cannot be started', async () => {
    expect(() => new AgentProcessTransport('/home/person/bin/oxespace-no-such-cli-b83', [], dir)).toThrow('not found')
    await vi.waitFor(() => expect(recorded).toEqual([['incident.agent.startFailed', incidentSubject('oxespace-no-such-cli-b83')]]))
  })

  it('an interaction over its budget, through the narrow entry point for F7', async () => {
    recordInteractionOverBudget('thread.send')
    await vi.waitFor(() => expect(recorded).toEqual([['incident.interaction.overBudget', incidentSubject('thread.send')]]))
  })
})
