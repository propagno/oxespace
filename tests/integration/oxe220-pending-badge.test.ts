// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest'

// OXE-220 (PQ-07·7): the OxeQuery badge knows a connection has an approval waiting, from the broker (by connection id),
// and main pushes the change as soon as the request is asked, on the existing audit channel.
vi.mock('electron', () => ({ app: { isReady: () => true, getLocale: () => 'en', isPackaged: false, getAppPath: () => '.' }, BrowserWindow: { getAllWindows: () => [], getFocusedWindow: () => null }, dialog: { showMessageBox: vi.fn() }, nativeImage: { createFromPath: () => ({ isEmpty: () => true }) } }))
vi.mock('electron-log/main.js', () => ({ default: { warn: vi.fn(), error: vi.fn(), info: vi.fn() } }))
process.env.OXESPACE_LOCALE = 'en'
const { ApprovalBroker } = await import('../../electron/main/services/agent-actions/approval-broker')
const { AgentGateway } = await import('../../electron/main/services/oxequery/agent-gateway')
const { auditWritten } = await import('../../electron/main/services/oxequery/audit-log')
const { AgentActivity } = await import('../../electron/main/services/agent-activity/read-model')

/** A person who sees the request and has not answered yet. */
const waitingPerson = { ask: (_request: unknown, _signal: AbortSignal, asked?: (id: string) => void) => { asked?.('approval-1'); return new Promise<never>(() => undefined) } }

function gateway(broker: InstanceType<typeof ApprovalBroker>) {
  return new AgentGateway({
    list: () => [{ id: 'c1', name: 'shop', engine: 'postgres', environment: 'dev', readOnly: false, agentAccess: 'read' } as never],
    resolve: id => ({ id, engine: 'postgres', host: 'h', port: 1, database: 'd', username: 'u', password: 'p', sslMode: 'disable', readOnly: true }) as never,
    call: async () => ({ columns: [{ name: 'id' }], rows: [[1]], truncated: false, durationMs: 1 }) as never,
    containers: { list: async () => ({ containers: [] }), logsTail: async () => '', action: async () => undefined },
    broker,
    audit: { record: vi.fn(), list: () => [] } as never
  })
}
const read = (g: ReturnType<typeof gateway>) => g.handle('oxespace_db_query', { connection: 'shop', sql: 'SELECT 1' }, { key: 'exec-1', label: 'thread:t1' }).catch((error: unknown) => error)

afterEach(() => { auditWritten.notify = undefined })

describe('OXE-220 · an approval waiting for a connection', () => {
  it('ApprovalBroker.hasPending answers per connection, and only while the request waits', async () => {
    const broker = new ApprovalBroker(waitingPerson, Date.now, 20)
    expect(broker.hasPending('c1')).toBe(false)
    const state = await broker.require('exec-1', 'c1', { actor: 'thread:t1', tool: 'oxespace_db_query', risk: 'read', text: 'SELECT 1', kind: 'oxequery', title: { code: 'approvals.title.oxequery', params: {} }, summary: { code: 'approvals.summary.oxequery.read', params: {} }, appNotes: [], options: [], defaultOptionId: 'deny' } as never)
    expect(state.state).toBe('pending')
    expect(broker.hasPending('c1')).toBe(true)
    expect(broker.hasPending('c2')).toBe(false)
    broker.endExecution('exec-1')
    expect(broker.hasPending('c1')).toBe(false)
  })

  it('the badge reads waiting while the broker holds a request for that connection', async () => {
    const broker = new ApprovalBroker(waitingPerson, Date.now, 20)
    const g = gateway(broker)
    const db = { prepare: () => { throw new Error('no audit table in this test') } }
    const activity = new AgentActivity(db as never, { pendingFor: connectionId => g.hasPending(connectionId) })
    expect(activity.badge({ connectionId: 'c1' }).waiting).toBe(false)
    await read(g)
    expect(activity.badge({ connectionId: 'c1' })).toEqual({ today: 0, waiting: true })
    expect(activity.badge({ connectionId: 'c2' }).waiting).toBe(false)
  })

  it('main pushes the change as soon as the request is asked, before any decision', async () => {
    const pushed: Array<{ connectionId?: string }> = []
    auditWritten.notify = change => { pushed.push(change) }
    await read(gateway(new ApprovalBroker(waitingPerson, Date.now, 20)))
    expect(pushed).toContainEqual({ connectionId: 'c1' })
  })
})
