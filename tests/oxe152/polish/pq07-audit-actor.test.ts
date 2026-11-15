// Frozen acceptance test for 1.5.2 Polimento · OxeQuery, backend (Jira OXE-229, PQ-07·16, CA-4). Written by the
// planner; the executor must not edit it. Backend gap named by MARCA: the Agent column shows raw ids (thread:abc, pane:p1).
// Contract (agreed in the plan): each audit.list entry carries actorLabel: string | null, the person-readable name of
// who acted (the conversation's title for thread:<id>, the pane's name for pane:<id>), resolved by main through the
// OxeQueryService option actorLabel(actor) => string | null | undefined (main wires it to the thread titles and pane
// names); null when unknown or when the resolver throws; the raw actor stays in `actor`.
import { afterEach, describe, expect, test, vi } from 'vitest'
import { openInMemoryDatabase, type AppDatabase } from '../../../electron/main/db'
import { AuditLog } from '../../../electron/main/services/oxequery/audit-log'
import { OxeQueryService } from '../../../electron/main/services/oxequery/service'

const databases: AppDatabase[] = []
afterEach(() => { for (const db of databases.splice(0)) db.close() })
const cipher = { available: () => true, encrypt: (value: string) => Buffer.from(value), decrypt: (value: Buffer) => value.toString() }

function service(actorLabel?: (actor: string) => string | null | undefined) {
  const db = openInMemoryDatabase(); databases.push(db)
  const log = new AuditLog(db)
  for (const actor of ['thread:abc', 'pane:p1', 'thread:gone']) log.record({ actor, connectionId: 'c1', tool: 'oxespace_db_query', decision: 'auto', outcome: 'ok' })
  return new OxeQueryService({ db, worker: { call: vi.fn() }, cipher, emit: () => undefined, actorLabel } as unknown as ConstructorParameters<typeof OxeQueryService>[0])
}
async function entries(svc: OxeQueryService): Promise<Array<{ actor: string; actorLabel: string | null }>> {
  const response = await svc.call('audit.list', { limit: 50 } as never)
  if (!response.ok) throw new Error(response.error.message)
  return (response.value as unknown as { entries: Array<{ actor: string; actorLabel: string | null }> }).entries
}

describe('PQ-07·16 backend · the audit entry names who acted', () => {
  test('a conversation reads as its title and a pane as its name; the raw actor stays', async () => {
    const names: Record<string, string> = { 'thread:abc': 'Fix the invoice totals', 'pane:p1': 'Claude · 2' }
    const list = await entries(service(actor => names[actor]))
    expect(list.map(entry => [entry.actor, entry.actorLabel])).toEqual([['thread:gone', null], ['pane:p1', 'Claude · 2'], ['thread:abc', 'Fix the invoice totals']])
  })

  test('without a resolver, or when it throws, actorLabel is null and the list still answers', async () => {
    expect((await entries(service())).every(entry => entry.actorLabel === null)).toBe(true)
    const list = await entries(service(() => { throw new Error('store closed') }))
    expect(list).toHaveLength(3)
    expect(list.every(entry => entry.actorLabel === null)).toBe(true)
  })
})
