// @vitest-environment node
import { mkdtempSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { IncidentJournal, type JournalIo } from '../electron/main/services/diagnostics/incident-journal'
import { connectIncidentJournal, flushIncidents, incidentRecorder, incidentSubject, recordIncident } from '../electron/main/services/diagnostics/incident-sink'
import { DIAGNOSTICS_LIMITS } from '../shared/types/diagnostics'

const roots: string[] = []
function journalFile(): string { const root = mkdtempSync(join(tmpdir(), 'oxe-journal-')); roots.push(root); return join(root, 'diagnostics', 'incidents.json') }
afterEach(() => {
  connectIncidentJournal(null)
  for (const root of roots.splice(0)) {
    if (dirname(resolve(root)) !== resolve(tmpdir())) throw Error('Unsafe cleanup')
    rmSync(root, { recursive: true, force: true })
  }
})
const DAY = 86_400_000

describe('incident journal', () => {
  it('groups by code and subject, and survives a restart', () => {
    const file = journalFile()
    let now = 1_000_000
    const journal = new IncidentJournal(file, { now: () => now, writeDelayMs: 0 })
    journal.record('incident.mcp.quarantined', incidentSubject('server-1'))
    now += 5
    journal.record('incident.mcp.quarantined', incidentSubject('server-1'))
    journal.record('incident.mcp.quarantined', incidentSubject('server-2'))
    journal.record('incident.oxequery.timeout')
    const reopened = new IncidentJournal(file, { now: () => now })
    const list = reopened.list()
    expect(list).toHaveLength(3)
    const first = list.find(item => item.subject === incidentSubject('server-1'))!
    expect(first).toMatchObject({ code: 'incident.mcp.quarantined', area: 'mcp', count: 2, firstAt: 1_000_000, lastAt: 1_000_005 })
    expect(list.find(item => item.code === 'incident.oxequery.timeout')).toMatchObject({ area: 'oxequery', count: 1 })
    expect(list.find(item => item.code === 'incident.oxequery.timeout')!.subject).toBeUndefined()
    expect(reopened.list({ limit: 1 })).toHaveLength(1)
    expect(reopened.list({ since: 1_000_005 }).every(item => item.lastAt >= 1_000_005)).toBe(true)
  })

  it('keeps 30 days, 500 kinds and 256 KiB at most', () => {
    const file = journalFile()
    let now = 100 * DAY
    const journal = new IncidentJournal(file, { now: () => now, writeDelayMs: 0 })
    journal.record('incident.updater.failed', incidentSubject('old'))
    now += DIAGNOSTICS_LIMITS.incidentRetentionMs + 1
    journal.record('incident.updater.failed', incidentSubject('new'))
    expect(journal.list().map(item => item.subject)).toEqual([incidentSubject('new')])

    for (let index = 0; index < 600; index++) { now++; journal.record('incident.ipc.handlerFailed', incidentSubject(`channel-${index}`)) }
    expect(journal.count).toBe(DIAGNOSTICS_LIMITS.maxIncidents)
    // The newest are kept.
    expect(journal.list({ limit: 1 })[0].subject).toBe(incidentSubject('channel-599'))
    expect(Buffer.byteLength(readFileSync(file, 'utf8'))).toBeLessThanOrEqual(DIAGNOSTICS_LIMITS.maxJournalBytes)

    const small = new IncidentJournal(journalFile(), { now: () => now, writeDelayMs: 0, maxBytes: 2048 })
    for (let index = 0; index < 50; index++) { now++; small.record('incident.ipc.handlerFailed', incidentSubject(`c-${index}`)) }
    expect(small.count).toBeGreaterThan(0)
    expect(small.count).toBeLessThan(50)
    expect(Buffer.byteLength(JSON.stringify({ version: 1, incidents: small.list() }))).toBeLessThanOrEqual(2048)
  })

  it('starts over from a corrupt file and records journalReset, without throwing', () => {
    for (const content of ['{not json', JSON.stringify({ version: 1, incidents: [{ id: 'x', code: 'made.up' }] }), JSON.stringify({ version: 2, incidents: [] }), JSON.stringify({ version: 1, incidents: [{ id: '12345678', code: 'incident.ipc.handlerFailed', area: 'ipc', firstAt: 1, lastAt: 1, count: 1, subject: 'raw text here' }] })]) {
      const file = journalFile()
      mkdirSync(dirname(file), { recursive: true })
      writeFileSync(file, content)
      const journal = new IncidentJournal(file, { writeDelayMs: 0 })
      expect(journal.list().map(item => item.code), content).toEqual(['incident.app.journalReset'])
      expect(JSON.parse(readFileSync(file, 'utf8')).incidents[0].code).toBe('incident.app.journalReset')
    }
  })

  it('writes atomically: a failed write leaves the previous journal whole and no temporary file', () => {
    const file = journalFile()
    const journal = new IncidentJournal(file, { writeDelayMs: 0 })
    journal.record('incident.database.busy')
    const before = readFileSync(file, 'utf8')
    const failing: JournalIo = {
      readFileSync: (path, encoding) => readFileSync(path, encoding),
      // Half the bytes reach the disk, then the disk is full.
      writeFileSync: (path, data, options) => { writeFileSync(path, data.slice(0, data.length / 2), options); throw Object.assign(new Error('ENOSPC'), { code: 'ENOSPC' }) },
      renameSync, rmSync, mkdirSync
    }
    const broken = new IncidentJournal(file, { writeDelayMs: 0, io: failing })
    expect(() => broken.record('incident.updater.failed')).not.toThrow()
    expect(readFileSync(file, 'utf8')).toBe(before)
    expect(readdirSync(dirname(file))).toEqual(['incidents.json'])
  })

  it('stores no raw text: only codes and 8-hex subjects', async () => {
    const file = journalFile()
    connectIncidentJournal(async () => new IncidentJournal(file, { writeDelayMs: 0 }))
    recordIncident('incident.agent.startFailed', 'C:/Users/person/secret-agent.exe with a prompt about payroll')
    recordIncident('incident.ipc.handlerFailed', 'thread:send')
    await incidentRecorder()
    flushIncidents()
    const text = readFileSync(file, 'utf8')
    for (const raw of ['person', 'secret-agent', 'payroll', 'thread:send', 'prompt']) expect(text).not.toContain(raw)
    const stored = JSON.parse(text).incidents as Array<{ subject?: string }>
    expect(stored.map(item => item.subject)).toEqual([incidentSubject('C:/Users/person/secret-agent.exe with a prompt about payroll'), incidentSubject('thread:send')])
    expect(stored.every(item => /^[0-9a-f]{8}$/.test(item.subject!))).toBe(true)
  })

  it('journal subjects that are not hashes are dropped, and clearing empties it', () => {
    const journal = new IncidentJournal(journalFile(), { writeDelayMs: 0 })
    journal.record('incident.mcp.quarantined', 'not a hash')
    expect(journal.list()[0].subject).toBeUndefined()
    journal.clear()
    expect(journal.list()).toEqual([])
  })
})
