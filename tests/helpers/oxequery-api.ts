import { vi } from 'vitest'
import type { OxeQueryConnection } from '../../shared/types/oxequery'

type Handler = (input: Record<string, unknown>) => unknown

export interface FakeOxeQuery {
  /** Every call, in order, with the channel it came through. */
  calls: { op: string; input: Record<string, unknown>; channel: 'oxeQuery' | 'oxePod' }[]
  /** Answers for one operation; a function sees the input. A thrown value becomes an error response. */
  on(op: string, handler: Handler | unknown): void
  callsOf(op: string): Record<string, unknown>[]
}

/** OxePod's operations; every other one is OxeQuery's. Asked on the wrong channel, an operation is refused as the main process would. */
const POD_OP = /^(containers|resources)\./

/**
 * A stand-in for `window.oxe.oxeQuery` and `window.oxe.oxePod`: the page's doors to the main process, scripted per
 * test. Each channel answers only its own operations.
 */
export function installFakeOxeQuery(): FakeOxeQuery {
  const handlers = new Map<string, Handler>()
  const calls: FakeOxeQuery['calls'] = []
  const through = (channel: 'oxeQuery' | 'oxePod') => vi.fn(async (op: string, input: Record<string, unknown> = {}) => {
    if (POD_OP.test(op) !== (channel === 'oxePod')) throw new Error(`Unknown ${channel === 'oxePod' ? 'OxePod' : 'OxeQuery'} operation`)
    calls.push({ op, input, channel })
    const handler = handlers.get(op)
    if (!handler) return { ok: false, error: { code: 'failed', message: `No answer scripted for ${op}.` } }
    try { return { ok: true, value: handler(input) } } catch (error) {
      const info = error as { code?: string; message?: string; reasons?: string[] }
      return { ok: false, error: { code: info.code ?? 'failed', message: info.message ?? 'failed', ...(info.reasons ? { reasons: info.reasons } : {}) } }
    }
  })
  const target = window as unknown as { oxe?: Record<string, unknown> }
  target.oxe = { ...(target.oxe ?? {}), oxeQuery: { call: through('oxeQuery'), onEvent: () => () => undefined }, oxePod: { call: through('oxePod'), onEvent: () => () => undefined }, clipboard: { writeText: vi.fn(async () => undefined) } }
  return {
    calls,
    on: (op, handler) => { handlers.set(op, typeof handler === 'function' ? handler as Handler : () => handler) },
    callsOf: op => calls.filter(entry => entry.op === op).map(entry => entry.input)
  }
}

export const refusal = (code: string, message: string, reasons: string[] = []): { code: string; message: string; reasons: string[] } => ({ code, message, reasons })

export function connection(change: Partial<OxeQueryConnection> = {}): OxeQueryConnection {
  return {
    id: 'c1', name: 'shop', engine: 'postgres', host: 'db.local', port: 5432, database: 'app', username: 'me', sslMode: 'disable', readOnly: false, environment: 'dev',
    hasPassword: true, hasCa: false, hasClientCert: false, mongo: { authSource: '', replicaSet: '', directConnection: true, srv: false, extraHosts: [] },
    statementTimeoutMs: 60_000, maxRows: 500, agentAccess: 'off', group: '', favorite: false, color: '', maskPatterns: [], lastUsedAt: 0, keepaliveSeconds: 30,
    createdAt: 1, updatedAt: 1, ...change
  }
}
