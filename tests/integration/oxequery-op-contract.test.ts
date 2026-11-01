/**
 * The contract of OxeQuery's channel, `oxeQuery:call`, after OxePod got its own (`oxePod:call`): databases only. The
 * container and resource operations are gone from it; a database in a container is reached through the two seam
 * operations, `connections.fromContainer` and `connections.createInContainer`, which call OxePod in process.
 */
import { readFileSync } from 'node:fs'
import { describe, expect, test, vi } from 'vitest'
import { createFakeIpcMain, type FakeIpcMain } from '../helpers/fake-ipc-main'
import { IPC_CHANNELS } from '../../shared/types/ipc'

const ipcMain: FakeIpcMain = createFakeIpcMain()
vi.mock('electron', () => ({ ipcMain, BrowserWindow: { getAllWindows: () => [], fromWebContents: () => ({}) } }))

const { OXEQUERY_OPS, registerOxeQueryIpc } = await import('../../electron/main/ipc/oxequery.ipc')
const { OXEPOD_OPS } = await import('../../electron/main/ipc/oxepod.ipc')

function declaredOps(file: string, name: string): string[] {
  const text = readFileSync(file, 'utf8')
  const start = text.indexOf(`export interface ${name} {`)
  return [...text.slice(start, text.indexOf('\n}\n', start)).matchAll(/^ {2}'([a-zA-Z.]+)':/gm)].map(match => match[1])
}

/** The operations the service's dispatch has a case for. */
function handledOps(): string[] {
  const text = readFileSync('electron/main/services/oxequery/service.ts', 'utf8')
  const start = text.indexOf('private async dispatch(')
  const body = text.slice(start, text.indexOf("default: throw new OxeQueryError('invalid', 'Unknown OxeQuery operation.')", start))
  return [...body.matchAll(/case '([a-zA-Z.]+)':/g)].map(match => match[1])
}

const MOVED_TO_OXEPOD = [
  'containers.engines', 'containers.candidates', 'containers.useCandidate', 'containers.list', 'containers.inspect', 'containers.stats', 'containers.action', 'containers.remove',
  'containers.compose', 'containers.exec', 'containers.logsStart', 'containers.logsStop', 'containers.shell', 'containers.suggestConnection',
  'resources.images', 'resources.volumes', 'resources.networks', 'resources.usage', 'resources.remove', 'resources.prune'
]

const service = { call: vi.fn(async (op: string, input: unknown) => ({ ok: true as const, value: { op, input } })) }
registerOxeQueryIpc(service)

describe('OxeQuery op contract', () => {
  test('lists exactly the operations the types declare and the service handles', () => {
    expect(IPC_CHANNELS.oxeQuery).toEqual({ call: 'oxeQuery:call', onEvent: 'oxeQuery:event' })
    expect(new Set(OXEQUERY_OPS).size).toBe(OXEQUERY_OPS.length)
    expect([...declaredOps('shared/types/oxequery.ts', 'OxeQueryOps')].sort()).toEqual([...OXEQUERY_OPS].sort())
    expect([...new Set(handledOps())].sort()).toEqual([...OXEQUERY_OPS].sort())
  })

  test('no longer carries a container or resource operation; they are OxePod\'s', () => {
    expect(OXEQUERY_OPS.filter(op => /^(containers|resources)\./.test(op))).toEqual([])
    expect([...OXEPOD_OPS].sort()).toEqual([...MOVED_TO_OXEPOD].sort())
    expect(OXEQUERY_OPS).toEqual(expect.arrayContaining(['connections.fromContainer', 'connections.createInContainer']))
  })

  test('refuses a moved operation, an unknown one and a malformed request before the service sees it', async () => {
    for (const request of [...MOVED_TO_OXEPOD.map(op => ({ op, input: {} })), { op: 'containers.createDatabase' }, { op: 'nope' }, { op: 7 }, {}, null, 'sql.run', { op: '__proto__' }]) {
      await expect(ipcMain.invoke('oxeQuery:call', request), JSON.stringify(request)).rejects.toThrow('Unknown OxeQuery operation')
    }
    expect(service.call).not.toHaveBeenCalled()
  })

  test('forwards a listed operation, the seam ones included', async () => {
    await expect(ipcMain.invoke('oxeQuery:call', { op: 'connections.createInContainer', input: { engine: 'postgres', name: 'db', tag: '17' } }))
      .resolves.toEqual({ ok: true, value: { op: 'connections.createInContainer', input: { engine: 'postgres', name: 'db', tag: '17' } } })
    await expect(ipcMain.invoke('oxeQuery:call', { op: 'connections.fromContainer', input: { id: 'pg-dev' } })).resolves.toMatchObject({ ok: true })
  })

})
