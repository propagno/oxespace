// Frozen acceptance test for 1.5.2 Polimento · OxeQuery, backend (Jira OXE-229, PQ-07·16, CA-3). Written by the
// planner; the executor must not edit it. Backend gap named by MARCA: audit.list cut at 200 with no paging.
// Contract (agreed in the plan): OxeQueryOps['audit.list'] input { connectionId?, limit?, cursor? } answers
// { entries, hasMore, cursor }: entries newest first (ts, then id, descending), at most `limit` (1..500); hasMore says
// whether older entries exist; cursor (a string, null on the last page) asks for the next page with nothing repeated
// and nothing skipped, also among entries written in the same millisecond; connectionId still filters. AuditLog.list,
// which the agent gateway reads, keeps its array answer.
import { afterEach, describe, expect, test, vi } from 'vitest'
import { openInMemoryDatabase, type AppDatabase } from '../../../electron/main/db'
import { AuditLog } from '../../../electron/main/services/oxequery/audit-log'
import { OxeQueryService } from '../../../electron/main/services/oxequery/service'

const databases: AppDatabase[] = []
afterEach(() => { for (const db of databases.splice(0)) db.close() })
const cipher = { available: () => true, encrypt: (value: string) => Buffer.from(value), decrypt: (value: Buffer) => value.toString() }

function seeded(count: number, connectionOf: (index: number) => string = () => 'c1') {
  const db = openInMemoryDatabase(); databases.push(db)
  let clock = 1_700_000_000_000
  const log = new AuditLog(db, () => (clock += 1) - (clock % 3)) // runs of entries share a millisecond
  for (let index = 0; index < count; index++) log.record({ actor: 'pane:p1', connectionId: connectionOf(index), tool: 'oxespace_db_query', text: `SELECT ${index}`, decision: 'auto', outcome: 'ok' })
  const service = new OxeQueryService({ db, worker: { call: vi.fn() }, cipher, emit: () => undefined } as unknown as ConstructorParameters<typeof OxeQueryService>[0])
  return { db, service }
}
interface Page { entries: Array<{ id: number; ts: number; text: string | null; connectionId: string | null }>; hasMore: boolean; cursor: string | null }
async function page(service: OxeQueryService, input: Record<string, unknown>): Promise<Page> {
  const response = await service.call('audit.list', input as never)
  if (!response.ok) throw new Error(response.error.message)
  return response.value as unknown as Page
}

describe('PQ-07·16 backend · audit.list pages with hasMore and a cursor', () => {
  test('250 entries: the first page has 200 newest first and says there is more', async () => {
    const { service } = seeded(250)
    const first = await page(service, { limit: 200 })
    expect(first.entries).toHaveLength(200)
    expect(first.hasMore).toBe(true)
    expect(typeof first.cursor).toBe('string')
    const keys = first.entries.map(entry => [entry.ts, entry.id])
    expect(keys).toEqual([...keys].sort((a, b) => b[0] - a[0] || b[1] - a[1]))
    expect(first.entries[0].text).toBe('SELECT 249')
  })

  test('the cursor brings the other 50, nothing repeated or skipped, and the last page ends', async () => {
    const { service } = seeded(250)
    const first = await page(service, { limit: 200 })
    const second = await page(service, { limit: 200, cursor: first.cursor })
    expect(second.entries).toHaveLength(50)
    expect(second.hasMore).toBe(false)
    expect(second.cursor).toBeNull()
    const ids = [...first.entries, ...second.entries].map(entry => entry.id)
    expect(new Set(ids).size).toBe(250)
  })

  test('exactly one page: hasMore is false', async () => {
    const { service } = seeded(200)
    const only = await page(service, { limit: 200 })
    expect(only.entries).toHaveLength(200)
    expect(only.hasMore).toBe(false)
    expect(only.cursor).toBeNull()
  })

  test('connectionId still filters, across pages', async () => {
    const { service } = seeded(30, index => (index % 2 ? 'c2' : 'c1'))
    const first = await page(service, { connectionId: 'c2', limit: 10 })
    const second = await page(service, { connectionId: 'c2', limit: 10, cursor: first.cursor })
    expect([...first.entries, ...second.entries].every(entry => entry.connectionId === 'c2')).toBe(true)
    expect(first.entries.length + second.entries.length).toBe(15)
    expect(second.hasMore).toBe(false)
  })
})
